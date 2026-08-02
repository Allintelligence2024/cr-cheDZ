-- ============================================================================
-- 039_fix_webhook_confirm_pending.sql
-- Correction de billing_webhook_apply() (migration 024) : l'idempotence
-- retournait TOUT paiement existant avec le même external_reference — y
-- compris un paiement 'pending' créé par l'init en ligne (qui n'était donc
-- JAMAIS confirmé). Désormais :
--   - paiement existant 'confirmed' → retourné tel quel (rejeu idempotent) ;
--   - paiement existant 'pending'/'failed' → confirmé et alloué (flux en
--     ligne : init pending → webhook confirme) ;
--   - sinon → nouveau paiement confirmé (flux espèces/externe).
-- CREATE OR REPLACE — migrations immuables (ADR-007).
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

  -- Paiement pending (init en ligne) → on le confirme avec son montant.
  SELECT * INTO v_payment FROM payments
    WHERE external_reference = p_external_reference AND status IN ('pending', 'failed')
    FOR UPDATE;
  IF FOUND THEN
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
      received_at, confirmed_at, notes, created_by
    ) VALUES (
      v_invoice.organization_id, 'WEB-' || v_seq,
      'REC-' || v_seq || '-' || substr(v_invoice.organization_id::text, 1, 8),
      v_invoice.child_id, p_amount, v_method, 'confirmed',
      p_external_reference, p_gateway, jsonb_build_object('source', 'webhook'),
      COALESCE(p_paid_at, NOW()), COALESCE(p_paid_at, NOW()), p_notes,
      v_invoice.created_by
    ) RETURNING * INTO v_payment;
  ELSE
    -- Confirmation du paiement pending (méthode du gateway, horodatage reçu).
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
