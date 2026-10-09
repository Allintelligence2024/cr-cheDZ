-- ============================================================================
-- 098_sync_resync_required_zero_cursor.sql
-- Correctif du bug F4 (2026-10-09) : sync_resync_required(t, 0) renvoyait
-- TRUE au premier sync. Raison : la première branche testait
-- EXISTS(... sync_seq <= 0), toujours FALSE car sync_seq commence à 1,
-- puis négation -> TRUE. Un device neuf (cursor 0) déclenche un resync,
-- relit tout, et la 2e boucle break sans appliquer -> localChildren vide.
-- Garde-fou : cursor < 1 signifie "jamais synchronisé", rien n'a pu être
-- purgé sous lui. On renvoie FALSE. La sémantique de purge reste intacte :
-- pour cursor >= 1, TRUE seulement si aucune ligne <= cursor n'existe.
-- ============================================================================
CREATE OR REPLACE FUNCTION sync_resync_required(p_organization_id uuid, p_cursor bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_cursor >= 1
  AND EXISTS (
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
  '3.5.2 — TRUE si le curseur client (>= 1) est inférieur au plus petit sync_seq existant : des événements ont été purgés sous ce curseur (sync_retention_purge), et le client doit resynchroniser plutôt qu''avancer silencieusement. Un curseur < 1 (jamais synchronisé) renvoie FALSE : rien n''a pu être purgé sous lui.';
