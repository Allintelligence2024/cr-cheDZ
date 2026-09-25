-- ============================================================================
-- 076_messaging_retention.sql
-- L4 / décision D2 (plan de réparation 2026-09-24, §6) — rétention de la file
-- de notifications et du contenu des messages.
--
-- CONSTAT : la purge livrée en 034 ne couvrait que les journaux
-- (audit_logs, data_access_logs, media_access_logs, 5 ans). `notification_queue`
-- et `messages` croissaient donc SANS BORNE — deux tables qui contiennent du
-- texte destiné aux familles (titres/corps de notification, corps de message).
--
-- DÉCISION (DPO, 2026-09-25) : OPTION (a) — purger avec des seuils dédiés :
--   * notification_queue : lignes TERMINÉES (status sent/failed) au-delà de
--     NOTIFICATION_RETENTION_DAYS (défaut 90 j). L'inbox
--     (`notification_inbox`) reste la voie de lecture durable : la purge de la
--     FILE est opérationnelle, pas historique ;
--   * messages : au-delà de MESSAGES_RETENTION_DAYS (défaut 365 j), le CONTENU
--     expire (corps remplacé par un marqueur, pièce jointe détachée) ; la ligne
--     et ses métadonnées (auteur, date, fil) restent — le fil de conversation
--     ne se troue pas silencieusement, et l'expiration est VISIBLE côté client.
--
-- GARDE-FOUS (le patron de 034 est repris, pas réinventé) :
--   * purge par LOTS de 5000 (aucune transaction longue, aucun verrou de table) ;
--   * `pending`/`processing` JAMAIS touchés : une notification en cours de
--     retry ou en cours de traitement par le worker survit, quel que soit son
--     âge (le worker relance `notif_queue_reclaim` pour les `processing`
--     orphelins — 065) ;
--   * idempotent : ré-exécuter la fonction ne « repurge » pas (le corps déjà
--     expiré n'est plus candidat) et ne détache plus la pièce jointe ;
--   * SECURITY DEFINER, propriétaire = rôle de migration BYPASSRLS : le worker
--     tourne NOBYPASSRLS sans contexte tenant et ne peut pas écrire dans ces
--     tables FORCE RLS (034, 042, 047 suivent le même patron) ;
--   * aucun accès ouvert : REVOKE ALL puis GRANT explicite à creche_app.
--
-- HORS PÉRIMÈTRE (écrit noir sur blanc) : le cycle de vie des FICHIERS joints
-- (`media_assets` + objet de stockage) n'est pas modifié ici — il relève de la
-- politique média (DPO), pas de cette migration.
-- ============================================================================

-- Marqueur stable du contenu expiré (constante partagée avec le worker et les
-- tests : ne pas reformuler sans mettre à jour les trois).
-- Aucun nombre de jours dans le texte : le seuil est CONFIGURABLE
-- (MESSAGES_RETENTION_DAYS) — un marqueur qui citerait « 365 jours » mentirait
-- dès que l'exploitant change la valeur.
CREATE OR REPLACE FUNCTION retention_expired_body_marker()
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$ SELECT '[contenu expiré — rétention du contenu des messages]'::text $$;

CREATE OR REPLACE FUNCTION retention_purge_messaging(
  p_notification_cutoff timestamptz,
  p_messages_cutoff timestamptz
)
RETURNS TABLE(notifications_purged bigint, messages_expired bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_notifications bigint := 0;
  v_messages      bigint := 0;
  v_batch         bigint;
BEGIN
  -- ── 1. File de notifications : uniquement des lignes TERMINÉES ───────────
  -- Liste blanche explicite (sent/failed) : tout autre statut — `pending`,
  -- `processing` — est laissé intact, même très ancien.
  LOOP
    DELETE FROM notification_queue
     WHERE id IN (
       SELECT id FROM notification_queue
        WHERE status IN ('sent', 'failed')
          AND created_at < p_notification_cutoff
        LIMIT 5000
     );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_notifications := v_notifications + v_batch;
    EXIT WHEN v_batch < 5000;
  END LOOP;

  -- ── 2. Messages : expiration du CONTENU (la ligne et ses métadonnées restent)
  LOOP
    UPDATE messages
       SET body = retention_expired_body_marker(),
           attachment_id = NULL
     WHERE id IN (
       SELECT id FROM messages
        WHERE sent_at < p_messages_cutoff
          AND body <> retention_expired_body_marker()
        LIMIT 5000
     );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_messages := v_messages + v_batch;
    EXIT WHEN v_batch < 5000;
  END LOOP;

  RETURN QUERY SELECT v_notifications, v_messages;
END $$;

-- ── Index de purge ──────────────────────────────────────────────────────────
-- La file n'a qu'un index partiel sur `pending` (009) : la sélection des lignes
-- TERMINÉES ferait un scan complet. Idem pour `messages` : l'index existant est
-- (conversation_id, sent_at), inutilisable pour une purge globale par âge.
CREATE INDEX idx_notif_queue_terminal_created
  ON notification_queue (created_at)
  WHERE status IN ('sent', 'failed');

CREATE INDEX idx_messages_sent_at ON messages (sent_at);

-- ── Privilèges ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION retention_purge_messaging(timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION retention_expired_body_marker() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION retention_purge_messaging(timestamptz, timestamptz) TO creche_app;
    GRANT EXECUTE ON FUNCTION retention_expired_body_marker() TO creche_app;
  END IF;
  -- Le rôle de test (bases *_test) suit le même chemin que le worker.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app_test') THEN
    GRANT EXECUTE ON FUNCTION retention_purge_messaging(timestamptz, timestamptz) TO creche_app_test;
    GRANT EXECUTE ON FUNCTION retention_expired_body_marker() TO creche_app_test;
  END IF;
END $$;

COMMENT ON FUNCTION retention_purge_messaging(timestamptz, timestamptz) IS
  'L4/D2 : purge la file de notifications TERMINÉES (sent/failed) et expire le '
  'contenu des messages au-delà des seuils fournis. pending/processing jamais '
  'touchés. Appelée par le job worker retention_purge.';
COMMENT ON FUNCTION retention_expired_body_marker() IS
  'Marqueur de contenu expiré (rétention messages). Partagé : worker, tests.';
