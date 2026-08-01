-- ============================================================================
-- 024_phase8_webhook_jobs.sql
-- Phase 8 : webhook de paiement signé (SECURITY DEFINER, idempotent par
-- external_reference) + fonctions de claim/terminaison de jobs pour le worker
-- sous rôle NOBYPASSRLS + index de consultation parent des paiements.
--
-- RLS : les fonctions suivent le pattern bootstrap des migrations 015/016/017
-- (SECURITY DEFINER = seule exception documentée à la RLS ; le code applicatif
-- ne contourne jamais RLS). Le webhook n'a pas de JWT (donc pas de tenant
-- injectable) : la fonction retrouve l'organisation à partir de la facture.
-- ============================================================================

-- ── Webhook de paiement (idempotent) ────────────────────────────────────────
-- Un même external_reference (3 envois du même webhook) ne produit qu'un seul
-- paiement confirmé : le second appel retourne le paiement existant sans rien
-- écrire. Contraintes financières C04 respectées (solde, immuabilité).
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
BEGIN
  -- Idempotence : webhook déjà appliqué → même paiement, aucune écriture.
  SELECT * INTO v_payment FROM payments WHERE external_reference = p_external_reference;
  IF FOUND THEN RETURN v_payment; END IF;

  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVOICE_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF v_invoice.status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount <= 0 OR p_amount > v_invoice.total_amount - v_invoice.paid_amount THEN
    RAISE EXCEPTION 'PAYMENT_EXCEEDS_BALANCE' USING ERRCODE = 'P0001';
  END IF;

  v_method := CASE p_gateway
    WHEN 'cib' THEN 'cib'::payment_method
    WHEN 'edahabia' THEN 'edahabia'::payment_method
    ELSE 'bank_transfer'::payment_method
  END;

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

  INSERT INTO payment_allocations (
    organization_id, payment_id, invoice_id, amount_allocated, allocated_by
  ) VALUES (
    v_invoice.organization_id, v_payment.id, v_invoice.id, p_amount,
    v_invoice.created_by
  );

  v_status := CASE
    WHEN v_invoice.paid_amount + p_amount = v_invoice.total_amount
      THEN 'paid'::invoice_status
    ELSE 'partially_paid'::invoice_status
  END;
  UPDATE invoices SET paid_amount = paid_amount + p_amount, status = v_status,
    updated_at = NOW() WHERE id = v_invoice.id;

  RETURN v_payment;
END $$;

-- ── Worker : claim de job dans la transaction du worker ─────────────────────
-- Le worker tourne avec le rôle applicatif NOBYPASSRLS. La table
-- background_jobs est RLS (org IS NULL OR org = tenant) : sans tenant posé, un
-- job rattaché à une organisation est invisible. Ces deux fonctions sont
-- l'équivalent worker du bootstrap auth (015) : elles réclament/terminent les
-- jobs ; TOUT accès aux données métier (invoices, children…) reste dans une
-- transaction avec SET LOCAL app.tenant_id via le rôle NOBYPASSRLS.
CREATE OR REPLACE FUNCTION jobs_claim_next()
RETURNS TABLE (
  id uuid, job_type text, payload jsonb, organization_id uuid,
  attempts integer, max_attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_job background_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM background_jobs
    WHERE status = 'pending' AND scheduled_at <= NOW() AND attempts < max_attempts
    ORDER BY priority DESC, scheduled_at
    LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE background_jobs
    SET status = 'processing', started_at = NOW(), attempts = attempts + 1
    WHERE id = v_job.id;
  RETURN QUERY SELECT v_job.id, v_job.job_type, v_job.payload,
    v_job.organization_id, v_job.attempts, v_job.max_attempts;
END $$;

CREATE OR REPLACE FUNCTION jobs_finish(
  p_id uuid, p_success boolean, p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_success THEN
    UPDATE background_jobs SET status = 'done', completed_at = NOW(),
      failure_reason = NULL WHERE id = p_id;
  ELSE
    UPDATE background_jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
          failed_at = CASE WHEN attempts >= max_attempts THEN NOW() END,
          failure_reason = p_failure_reason,
          scheduled_at = NOW() + (INTERVAL '1 minute' * POWER(2, attempts))
      WHERE id = p_id;
  END IF;
END $$;

-- ── Index : consultation parent des paiements (factures + reçus) ────────────
CREATE INDEX idx_payments_child ON payments (child_id);

-- ── Droits (même pattern conditionnel que 015-018) ──────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION billing_webhook_apply(uuid, text, numeric, text, timestamptz, text) TO creche_app;
    GRANT EXECUTE ON FUNCTION jobs_claim_next() TO creche_app;
    GRANT EXECUTE ON FUNCTION jobs_finish(uuid, boolean, text) TO creche_app;
  END IF;
END $$;

REVOKE ALL ON FUNCTION billing_webhook_apply(uuid, text, numeric, text, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs_claim_next() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs_finish(uuid, boolean, text) FROM PUBLIC;
