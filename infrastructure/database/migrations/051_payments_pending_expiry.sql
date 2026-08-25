-- ============================================================================
-- 051_payments_pending_expiry.sql
-- MISSION P1 — expiration des paiements en ligne SATIM restés 'pending'
-- (jamais de suppression : traçabilité compta) + supersede à l'init.
--
-- 1. payments.invoice_id : lien facture (nullable, FK ON DELETE SET NULL pour
--    ne pas bloquer la suppression d'une facture). L'init en ligne (phase 8)
--    renseigne ce lien, ce qui permet de n'avoir QU'UN seul pending SATIM par
--    facture : à chaque init, les pending antérieurs de la même facture
--    passent en 'failed' (reason SUPERSEDED_BY_NEW_INIT).
-- 2. payments_expire_pending() : fonction SECURITY DEFINER (le worker tourne
--    NOBYPASSRLS, pattern purge vidéo 047) qui passe en 'failed' les pending
--    SATIM plus vieux que 72 h, avec gateway_response || {"expired": true,
--    "reason": "PENDING_EXPIRED_72H"}. Idempotente (status != pending après
--    traitement) ; toute erreur SQL fait échouer le job (jamais de faux
--    « expiré »).
-- 3. Index partiels ciblant précisément les pending SATIM (worker + supersede
--    init) — la file des pending est naturellement courte.
-- ============================================================================

ALTER TABLE payments ADD COLUMN invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- Worker : balayage des pending SATIM à expirer (status, created_at).
CREATE INDEX idx_payments_pending_expiry
  ON payments (status, created_at)
  WHERE status = 'pending' AND payment_gateway = 'satim';

-- Init (withTenantConnection) : supersede des pending SATIM d'une facture.
CREATE INDEX idx_payments_invoice_pending
  ON payments (invoice_id, status, created_at)
  WHERE status = 'pending' AND payment_gateway = 'satim';

CREATE OR REPLACE FUNCTION payments_expire_pending(
  p_age_hours integer DEFAULT 72,
  p_limit integer DEFAULT 500
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE payments
     SET status = 'failed',
         gateway_response =
           COALESCE(gateway_response, '{}'::jsonb)
           || jsonb_build_object('expired', true, 'reason', 'PENDING_EXPIRED_72H')
   WHERE id IN (
     SELECT id
       FROM payments
      WHERE status = 'pending'
        AND payment_gateway = 'satim'
        AND created_at < NOW() - make_interval(hours => p_age_hours)
      ORDER BY created_at
      LIMIT p_limit
   );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION payments_expire_pending(integer, integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION payments_expire_pending(integer, integer) TO creche_app;
  END IF;
END $$;
