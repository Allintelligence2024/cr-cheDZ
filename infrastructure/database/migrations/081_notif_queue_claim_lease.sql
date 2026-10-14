-- ============================================================================
-- 081_notif_queue_claim_lease.sql
-- P0 (remédiation 2026-10-03, phase 1.4) — complément de 080.
--
-- notif_queue_claim (recréée en 065) ne retournait PAS claimed_at : le worker
-- ne pouvait donc pas prouver au finish qu'il était encore le propriétaire du
-- bail. On ajoute claimed_at à la signature de retour (dernière colonne) pour
-- que le worker le passe à notif_queue_finish(p_claimed_at) → fencing complet.
--
-- Rétro-compatible : les anciens appelants ignorent la colonne supplémentaire
-- (SELECT explicite des colonnes en TS, pas de SELECT *).
-- ============================================================================

-- PostgreSQL interdit de changer le type de retour d'une fonction existante
-- avec CREATE OR REPLACE (42P13 « cannot change return type of existing
-- function »). On DROP donc la signature précédente avant de la recréer.
-- La file n'est jamais vide en production → aucun message en attente perdu.
DROP FUNCTION IF EXISTS notif_queue_claim(integer);

CREATE OR REPLACE FUNCTION notif_queue_claim(p_limit integer DEFAULT 25)
RETURNS TABLE (
  id uuid, organization_id uuid, user_id uuid, channel text,
  title_fr text, title_ar text, body_fr text, body_ar text, data jsonb,
  claimed_at timestamptz
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
                notification_queue.claimed_at;
END $$;

REVOKE ALL ON FUNCTION notif_queue_claim(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION notif_queue_claim(integer) TO creche_app;
  END IF;
END $$;
