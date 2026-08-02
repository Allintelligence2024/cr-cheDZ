-- ============================================================================
-- 043_fix_notif_queue_claim.sql
-- Correction de notif_queue_claim() (migration 042) : « column reference id
-- is ambiguous » — les colonnes OUT (id, organization_id, …) entrent en
-- collision avec les colonnes de notification_queue dans le UPDATE/RETURNING.
-- Toutes les références du corps sont qualifiées (notification_queue.*).
-- CREATE OR REPLACE — migrations immuables (ADR-007).
-- ============================================================================

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
          attempts = notification_queue.attempts + 1
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

REVOKE ALL ON FUNCTION notif_queue_claim(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION notif_queue_claim(integer) TO creche_app;
  END IF;
END $$;
