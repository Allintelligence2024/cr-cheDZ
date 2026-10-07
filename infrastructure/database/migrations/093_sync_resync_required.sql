-- ============================================================================
-- 093_sync_resync_required.sql
-- 3.5.2 (remédiation 2026-10-05) — détecter la perte d'événements après purge.
--
-- Constat : la purge cursor-aware (075) supprime les lignes sous
-- MIN(cursor_value) - marge. Mais un device dont la ligne sync_cursors a été
-- supprimée (device réinstallé, purge orpheline) ou en retard depuis une
-- rotation complète récupère une page VIDE et avance son curseur au-delà des
-- événements perdus — perte silencieuse et indétectable.
--
-- Correction : le pull compare le curseur du client à MIN(sync_seq) du
-- changelog. Si le curseur est strictement inférieur, des événements ont été
-- purgés entre les deux → le serveur renvoie `resync_required: true` et le
-- client déclenche un resync complet (re-lecture de l'état actuel), au lieu
-- d'avancer silencieusement son curseur.
--
-- La fonction retourne TRUE si le curseur donné est inférieur au plus petit
-- sync_seq EXISTANT du tenant (i.e. le début du changelog a été purgé après
-- ce curseur). Sécuritaire par construction : ne peut pas produire de faux
-- négatifs (curseur >= min ⇒ rien n'a été purgé sous lui).
-- ============================================================================

CREATE OR REPLACE FUNCTION sync_resync_required(p_organization_id uuid, p_cursor bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM sync_changelog
    WHERE organization_id = p_organization_id
      AND sync_seq <= p_cursor
  ) = FALSE
  AND EXISTS (
    SELECT 1 FROM sync_changelog
    WHERE organization_id = p_organization_id
  );
$$;

REVOKE ALL ON FUNCTION sync_resync_required(uuid, bigint) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION sync_resync_required(uuid, bigint) TO creche_app;
  END IF;
END $$;

COMMENT ON FUNCTION sync_resync_required(uuid, bigint) IS
  '3.5.2 — TRUE si le curseur du client est inférieur au plus petit sync_seq existant du tenant : des événements ont été purgés sous ce curseur (sync_retention_purge), et le client doit déclencher un resync complet plutôt qu''avancer silencieusement son curseur.';
