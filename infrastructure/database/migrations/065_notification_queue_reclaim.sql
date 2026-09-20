-- ============================================================================
-- 065 — Reclaim des notifications orphelines (rapport 2026-09-19, analyse 5,
-- O4) : une ligne claimée (status 'processing') dont le worker crashe avant
-- notif_queue_finish restait 'processing' POUR TOUJOURS — notif_queue_claim ne
-- reprend que les 'pending', aucune équivalence de reaper pour cette file
-- (contrairement à background_jobs, jobs_reap_stale).
-- Correction : claimed_at horodate le claim ; notif_queue_reclaim renvoie les
-- lignes 'processing' stale à 'pending' (retry exponentiel, même plafond 3
-- essais que notif_queue_finish) ou à 'failed' avec motif explicite.
-- ============================================================================
BEGIN;

ALTER TABLE notification_queue ADD COLUMN claimed_at TIMESTAMPTZ;

-- Le reclaim scanne les lignes processing stale.
CREATE INDEX IF NOT EXISTS idx_notif_queue_processing
  ON notification_queue (claimed_at)
  WHERE status = 'processing';

-- Claim : horodate le claim (claimed_at). Format canonique de 043 : TOUTES
-- les références du corps sont qualifiées — sinon en PostgreSQL 18 (corrélation
-- du cible UPDATE dans les sous-requêtes) « column reference id is ambiguous ».
CREATE OR REPLACE FUNCTION notif_queue_claim(p_limit integer DEFAULT 25)
RETURNS TABLE (
  id uuid, organization_id uuid, user_id uuid, channel text,
  title_fr text, title_ar text, body_fr text, body_ar text, data jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    UPDATE notification_queue
      SET status = 'processing',
          attempts = notification_queue.attempts + 1,
          claimed_at = NOW()
      WHERE notification_queue.id IN (
        SELECT q.id FROM notification_queue q
        WHERE q.status = 'pending' AND q.scheduled_at <= NOW()
        ORDER BY q.created_at
        LIMIT GREATEST(1, LEAST(p_limit, 100))
        FOR UPDATE SKIP LOCKED
      )
      RETURNING notification_queue.id, notification_queue.organization_id,
                notification_queue.user_id, notification_queue.channel::text,
                notification_queue.title_fr, notification_queue.title_ar,
                notification_queue.body_fr, notification_queue.body_ar,
                notification_queue.data;
END $$;

-- Reclaim : les lignes 'processing' dont le claim a plus de p_timeout sont
-- traitées comme un échec de livraison (crash du worker) :
--   attempts < 3 → 'pending' avec backoff exponentiel (idéal 2^attempts min) ;
--   attempts >= 3 → 'failed' avec motif explicite (jamais de file fantôme).
CREATE OR REPLACE FUNCTION notif_queue_reclaim(p_timeout interval DEFAULT interval '5 minutes')
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE notification_queue
    SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
        failed_at = CASE WHEN attempts >= 3 THEN NOW() ELSE NULL END,
        failure_reason = CASE WHEN attempts >= 3
          THEN 'RECLAIM_ABANDONED_AFTER_3_ATTEMPTS' ELSE NULL END,
        scheduled_at = CASE WHEN attempts >= 3 THEN scheduled_at
          ELSE NOW() + (INTERVAL '1 minute' * POWER(2, GREATEST(attempts, 1))) END,
        claimed_at = NULL
    WHERE status = 'processing'
      AND claimed_at IS NOT NULL
      AND claimed_at < NOW() - p_timeout;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION notif_queue_claim(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION notif_queue_reclaim(interval) FROM PUBLIC;

-- ── Droits (même pattern conditionnel que 015-042 : creche_app n'existe
-- que dans les déploiements à rôles de production) ─────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION notif_queue_claim(integer) TO creche_app;
    GRANT EXECUTE ON FUNCTION notif_queue_reclaim(interval) TO creche_app;
  END IF;
END $$;

COMMIT;
