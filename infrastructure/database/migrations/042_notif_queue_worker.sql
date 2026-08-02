-- ============================================================================
-- 042_notif_queue_worker.sql
-- Correction du drain des notifications sous rôle NOBYPASSRLS : le worker
-- (sans tenant) ne voyait AUCUNE ligne de notification_queue (RLS tenant) —
-- les notifications n'étaient donc JAMAIS envoyées en production.
-- Fonctions SECURITY DEFINER (pattern jobs 024/026-028) pour le cycle de vie
-- de la file. Les données métier (destinataires) restent lues DANS une
-- transaction avec SET LOCAL app.tenant_id côté worker.
-- ============================================================================

-- Claim : réclame jusqu'à 25 notifications dues (verrou SKIP LOCKED).
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
      SET status = 'processing', attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM notification_queue
        WHERE status = 'pending' AND scheduled_at <= NOW()
        ORDER BY created_at
        LIMIT GREATEST(1, LEAST(p_limit, 100))
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, organization_id, user_id, channel::text,
                title_fr, title_ar, body_fr, body_ar, data;
END $$;

-- Terminaison : succès ou échec (retry exponentiel, plafond 3 essais).
CREATE OR REPLACE FUNCTION notif_queue_finish(
  p_id uuid,
  p_success boolean,
  p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_success THEN
    UPDATE notification_queue SET status = 'sent', sent_at = NOW(), failure_reason = NULL
      WHERE id = p_id;
  ELSE
    UPDATE notification_queue
      SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
          failed_at = NOW(),
          failure_reason = p_failure_reason,
          scheduled_at = NOW() + (INTERVAL '1 minute' * POWER(2, attempts))
      WHERE id = p_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION notif_queue_claim(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION notif_queue_finish(uuid, boolean, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION notif_queue_claim(integer) TO creche_app;
    GRANT EXECUTE ON FUNCTION notif_queue_finish(uuid, boolean, text) TO creche_app;
  END IF;
END $$;
