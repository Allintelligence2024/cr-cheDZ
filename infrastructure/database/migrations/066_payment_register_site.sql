-- ============================================================================
-- 066 — Site d'encaissement figé sur le paiement (B1, audit 2026-09-19)
-- ----------------------------------------------------------------------------
-- B1 : les clôtures de caisse agrégeaient le site COURANT de l'enfant
--      (JOIN children) : un enfant muté entre l'encaissement et la clôture
--      faisait basculer le flux d'espèces d'un site à l'autre.
--      → le site d'encaissement devient un attribut figé du paiement, posé à
--        l'enregistrement ; les totaux de caisse agrègent p.site_id.
-- B4 : le fallback webhook (webhook sans init en ligne) ne génère plus de
--      numéro de reçu contenant un fragment d'UUID tenant : sel court =
--      SHA-256 tronqué (pgcrypto, activé en 001).
-- ============================================================================
BEGIN;

ALTER TABLE payments ADD COLUMN site_id UUID REFERENCES sites(id);

-- Rétroaction : site courant de l'enfant (meilleure donnée disponible
-- ex-post). Completeness garantie : payments.child_id est une FK dure —
-- un enfant référencé par un paiement ne peut pas être supprimé.
UPDATE payments p SET site_id = ch.site_id
  FROM children ch
  WHERE p.child_id = ch.id;

ALTER TABLE payments ALTER COLUMN site_id SET NOT NULL;

COMMENT ON COLUMN payments.site_id IS
  'Site d''encaissement, figé à l''enregistrement du paiement (B1). Les totaux de caisse agrègent cette colonne, pas le site courant de l''enfant.';
COMMENT ON COLUMN daily_cash_registers.total_cash_out IS
  'Toujours 0 : aucun flux de décaissement n''existe (closing_balance = opening_balance + total_cash_in). Connecter cette colonne si un flux sortant est ajouté.';

-- B1 + B4 (webhook) : le corps est celui de 052 (garde de montant
-- PAYMENT_AMOUNT_MISMATCH — inchangée), avec (1) le site d'encaissement figé
-- sur le paiement fallback, (2) le sel court du numéro de reçu (plus de
-- fragment d'UUID tenant en clair).
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
  IF FOUND THEN RETURN v_payment; END IF;

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

COMMIT;
