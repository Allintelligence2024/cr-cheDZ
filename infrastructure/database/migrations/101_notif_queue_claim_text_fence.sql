-- ============================================================================
-- 101_notif_queue_claim_text_fence.sql
-- P0 (batterie d'isolation 2026-10-11, phase 6/16/27/28/36) — fence
-- 080 jamais satisfaite : notif_queue_claim retournait claimed_at en
-- timestamptz, mais le pilote pg sérialise un Date JS en MILLISECONDES
-- alors que PostgreSQL stocke des MICROSECONDES. Le worker renvoyait
-- donc au finish une valeur tronquée (…753 au lieu de …753456) : la
-- clause de fencing « claimed_at = p_claimed_at » (migration 080)
-- échouait SILENCIEUSEMENT, notif_queue_finish était un no-op, et la
-- ligne restait 'processing' pour toujours — la file n'était jamais
-- drainée (statut 'processing' au lieu de 'sent').
--
-- Correction : le claim retourne claimed_at::text (précision complète) ;
-- le worker le renvoie tel quel, pg le parse en timestamptz sans perte,
-- et la comparaison de fencing est exacte. Rétro-compatible : les
-- appels sans p_claimed_at (NULL) conservent le comportement 080.
-- (Pattern DROP+CREATE de 081 : PostgreSQL interdit de changer le type
-- d'une colonne de retour par CREATE OR REPLACE — 42P13.)
-- ============================================================================

DROP FUNCTION IF EXISTS notif_queue_claim(integer);

CREATE OR REPLACE FUNCTION notif_queue_claim(p_limit integer DEFAULT 25)
RETURNS TABLE (
  id uuid, organization_id uuid, user_id uuid, channel text,
  title_fr text, title_ar text, body_fr text, body_ar text, data jsonb,
  claimed_at text
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
                notification_queue.data,
                notification_queue.claimed_at::text;
END $$;

REVOKE ALL ON FUNCTION notif_queue_claim(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION notif_queue_claim(integer) TO creche_app;
  END IF;
END $$;
