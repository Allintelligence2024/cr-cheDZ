-- ============================================================================
-- 082_webhook_tenant_guard.sql
-- P0 (remédiation 2026-10-03, phase 1.2) — webhook de paiement cross-tenant.
--
-- billing_webhook_apply (migration 066) est SECURITY DEFINER et prend
-- p_invoice_id brut : elle verrouille et confirme la facture fournie SANS
-- AUCUN filtre d'organisation. Vérifié en base (rôle creche_app_test
-- NOBYPASSRLS, tenant A posé) : un webhook tenant A confirmait la facture
-- d'une crèche B.
--
-- Comment c'est possible : le webhook arrive sur l'endpoint public
-- (/billing/webhook, HMAC-only) sans contexte session → pas de GUC tenant.
-- La fonction SECURITY DEFINER contourne la RLS. invoice_id + external_reference
-- étant les seules données fournies, RIEN ne liait la confirmation à l'org
-- propriétaire de la facture.
--
-- Correction : la fonction dérive l'organisation de la facture elle-même
-- (invoices.organization_id) et l'utilise comme contexte pour TOUTES les
-- écritures (payment, payment_allocations, next_org_sequence, update invoice).
-- Le paiement hérite déjà de v_invoice.organization_id — la seule voie
-- réellement ouverte était la facture : on exige qu'elle existe ET qu'elle
-- soit cohérente avec le paiement confirmé en cours (même org).
--
-- Cas couvert : un webhook tenant A fournissant l'invoice_id d'une facture B.
-- La facture B existe → la fonction l'aurait confirmée. Désormais, le paiement
-- lié à external_reference (si trouvé) DOIT appartenir à la même organisation
-- que la facture ; sinon PAYMENT_TENANT_MISMATCH (refus explicite, jamais
-- silencieux).
-- ============================================================================

CREATE OR REPLACE FUNCTION billing_webhook_apply(
  p_invoice_id uuid,
  p_external_reference text,
  p_amount numeric,
  p_gateway text,
  p_paid_at timestamptz,
  p_notes text
) RETURNS payments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_invoice invoices%ROWTYPE;
  v_payment payments%ROWTYPE;
  v_seq bigint;
  v_method payment_method;
  v_status invoice_status;
  v_effective_amount numeric;
  v_site uuid;
BEGIN
  -- Rejeu idempotent : paiement DÉJÀ confirmé → retourné sans écriture.
  SELECT * INTO v_payment FROM payments
    WHERE external_reference = p_external_reference AND status = 'confirmed';
  IF FOUND THEN
    -- P0 fencing tenant : le paiement confirmé DOIT appartenir à la même
    -- organisation que la facture ciblée. Un webhook cross-tenant fournissant
    -- l'invoice_id d'une autre crèche est refusé explicitement.
    IF v_payment.organization_id <> (SELECT organization_id FROM invoices WHERE id = p_invoice_id) THEN
      RAISE EXCEPTION 'PAYMENT_TENANT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    RETURN v_payment;
  END IF;

  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_invoice.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  -- B1 : site d'encaissement figé (site de l'enfant au moment du paiement).
  SELECT site_id INTO v_site FROM children WHERE id = v_invoice.child_id;

  -- Paiement pending ou failed (init en ligne, expiré 051 ou supersédé) →
  -- confirmation du LATE webhook : l'argent est réellement arrivé.
  SELECT * INTO v_payment FROM payments
    WHERE external_reference = p_external_reference AND status IN ('pending', 'failed')
    FOR UPDATE;
  IF FOUND THEN
    -- P0 fencing tenant : le paiement pending/failed trouvé par external_reference
    -- doit appartenir à l'organisation de la facture qu'on confirme.
    IF v_payment.organization_id <> v_invoice.organization_id THEN
      RAISE EXCEPTION 'PAYMENT_TENANT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    -- P2 (052) : le montant signalé par le fournisseur DOIT être celui du
    -- paiement. Jamais de « correction » silencieuse (faux statut) : un
    -- écart (paiement partiel, webhook d'une autre transaction…) est un
    -- REFUS EXPLICITE — le paiement reste pending/failed, un humain
    -- rapproche.
    IF v_payment.amount <> p_amount THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH' USING ERRCODE = 'P0001';
    END IF;
    v_effective_amount := v_payment.amount;
  ELSE
    v_effective_amount := p_amount;
  END IF;
  IF v_effective_amount <= 0 OR v_effective_amount > v_invoice.total_amount - v_invoice.paid_amount THEN
    RAISE EXCEPTION 'PAYMENT_EXCEEDS_BALANCE' USING ERRCODE = 'P0001';
  END IF;

  v_method := CASE p_gateway
    WHEN 'cib' THEN 'cib'::payment_method
    WHEN 'edahabia' THEN 'edahabia'::payment_method
    ELSE 'bank_transfer'::payment_method
  END;

  IF NOT FOUND THEN
    SELECT next_org_sequence(v_invoice.organization_id) INTO v_seq;
    INSERT INTO payments (
      organization_id, reference_number, receipt_number, child_id, amount, method,
      status, external_reference, payment_gateway, gateway_response,
      received_at, confirmed_at, notes, created_by, site_id
    ) VALUES (
      v_invoice.organization_id, 'WEB-' || v_seq,
      'REC-' || v_seq || '-' || left(encode(digest(v_invoice.organization_id::text, 'sha256'), 'hex'), 8),
      v_invoice.child_id, p_amount, v_method, 'confirmed',
      p_external_reference, p_gateway, jsonb_build_object('source', 'webhook'),
      COALESCE(p_paid_at, NOW()), COALESCE(p_paid_at, NOW()), p_notes,
      v_invoice.created_by, v_site
    ) RETURNING * INTO v_payment;
  ELSE
    -- Confirmation du paiement pending/failed (méthode du gateway, horodatage
    -- reçu). La réponse passerelle existante est CONSERVÉE (expiration
    -- PENDING_EXPIRED_72H ou SUPERSEDED_BY_NEW_INIT restant auditable).
    UPDATE payments SET status = 'confirmed',
      method = v_method,
      payment_gateway = p_gateway,
      gateway_response = COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('confirmed_by', 'webhook'),
      confirmed_at = COALESCE(p_paid_at, NOW()),
      received_at = COALESCE(p_paid_at, received_at),
      notes = COALESCE(p_notes, notes)
      WHERE id = v_payment.id
      RETURNING * INTO v_payment;
  END IF;

  INSERT INTO payment_allocations (
    organization_id, payment_id, invoice_id, amount_allocated, allocated_by
  ) VALUES (
    v_invoice.organization_id, v_payment.id, v_invoice.id, v_effective_amount,
    v_invoice.created_by
  );

  v_status := CASE
    WHEN v_invoice.paid_amount + v_effective_amount = v_invoice.total_amount
      THEN 'paid'::invoice_status
    ELSE 'partially_paid'::invoice_status
  END;
  UPDATE invoices SET paid_amount = paid_amount + v_effective_amount, status = v_status,
    updated_at = NOW() WHERE id = v_invoice.id;

  RETURN v_payment;
END $$;

REVOKE ALL ON FUNCTION billing_webhook_apply(uuid, text, numeric, text, timestamptz, text) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION billing_webhook_apply(uuid, text, numeric, text, timestamptz, text) TO creche_app;
  END IF;
END $$;
