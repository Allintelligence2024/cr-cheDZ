-- ============================================================================
-- 078_parent_lookup_tenant_guard.sql
-- P0 (remédiation 2026-10-03, phase 1.3) — fuite cross-tenant au login parent.
--
-- La fonction auth_parent_lookup_by_phone (migration 025) est SECURITY
-- DEFINER (BYPASSRLS) : c'est un bootstrap, le contexte tenant n'est pas
-- encore posé à l'étape de login. Mais son EXISTS (SELECT 1 FROM guardians g
-- WHERE g.user_id = u.id) n'avait AUCUN filtre d'organisation.
--
-- Conséquence : un numéro de téléphone parent d'une crèche A identifie
-- l'utilisateur et confirme son appartenance comme guardian pour TOUTES les
-- crèches. L'authentification réussit au nom de la crèche B (fuite
-- d'appartenance cross-tenant à l'étape de login).
--
-- Correction : la fonction n'accepte plus que les guardian ET user
-- appartenant à la MÊME organisation. Comme users.organization_id est
-- l'organisation de rattachement de l'utilisateur et guardians.organization_id
-- celle du profil guardian, exiger leur égalité restaure l'isolation sans
-- nécessiter de contexte tenant (la fonction reste un bootstrap).
--
-- La fonction retourne toujours au plus 1 ligne (users est unique par phone)
-- et ne change pas sa signature : appelants inchangés.
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_parent_lookup_by_phone(p_phone text)
RETURNS users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user users%ROWTYPE;
BEGIN
  SELECT u.* INTO v_user FROM users u
  WHERE u.phone = p_phone AND u.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM guardians g
      WHERE g.user_id = u.id
        AND g.organization_id = u.organization_id   -- ← garde d'appartenance tenant
    );
  RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION auth_parent_lookup_by_phone(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_parent_lookup_by_phone(text) TO creche_app;
  END IF;
END $$;
