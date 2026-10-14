-- 096_payments_external_reference_tenant.sql
-- 4.10 : payments.external_reference était UNIQUE GLOBAL + la recherche webhook
-- (billing_webhook_apply, migrations 039/052) se faisait SANS filtre tenant.
--
-- Double défaut :
--  1. collision multi-tenant : deux organisations utilisant le même fournisseur
--     ne peuvent pas partager une référence (la 2e INSERT échoue) ;
--  2. contournement de tenant (le vrai bug) : le lookup
--     `WHERE external_reference = p_external_reference` parcourt TOUTES les
--     organisations. Un webhook de l'org A (référence partagée) peut confirmer
--     la facture de l'org B — l'allocation est créée chez B.
--
-- Correction :
--  a. la contrainte colonne UNIQUE est remplacée par un index unique
--     (organization_id, external_reference) — l'idempotence est préservée
--     (un même webhook rejoué trouve le même paiement chez le MÊME tenant),
--     et deux tenants peuvent partager une référence ;
--  b. la fonction est recréée avec le filtre organization_id explicite. La
--     fonction recevant déjà p_invoice_id (dont on tire l'org via
--     FOR UPDATE de la facture), le périmètre est Positif. Si la facture
--     n'appartient pas au tenant de l'appel, INVOICE_NOT_FOUND est levé.

ALTER TABLE payments DROP CONSTRAINT payments_external_reference_key;

CREATE UNIQUE INDEX payments_external_reference_unique_tenant
  ON payments (organization_id, external_reference)
  WHERE external_reference IS NOT NULL;

-- Index de recherche (lookup webhook par tenant) — couvre la requête ci-dessous.
DROP INDEX IF EXISTS idx_payments_external;
CREATE INDEX idx_payments_external_tenant
  ON payments (organization_id, external_reference)
  WHERE external_reference IS NOT NULL;

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
  -- Rejeu idempotent : paiement DÉJÀ confirmé, dans la MÊME organisation que
  -- la facture ciblée → retourné sans écriture.
  SELECT * INTO v_payment FROM payments p
    JOIN invoices i ON i.id = p_invoice_id AND i.organization_id = p.organization_id
    WHERE p.external_reference = p_external_reference
      AND p.status = 'confirmed';
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
  -- 4.10 : le lookup est maintenant borné à l'organisation de la facture.
  SELECT * INTO v_payment FROM payments
    WHERE external_reference = p_external_reference
      AND organization_id = v_invoice.organization_id
      AND status IN ('pending', 'failed')
    FOR UPDATE;
  IF FOUND THEN
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
