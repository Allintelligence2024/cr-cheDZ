-- ============================================================================
-- 084_permissions_guard.sql
-- P1 (remédiation 2026-10-04, phase 2.2) — rendre la matrice RBAC effective.
--
-- Les tables `permissions` et `role_permissions` existent (migration 003) et
-- sont peuplées par le seed 003, mais AUCUN guard ne les interroge :
-- `PermissionsGuard` / `@Permissions` / `hasPermission` → 0 résultat dans
-- apps/api/src. L'autorisation ne repose que sur le slug de rôle (@Roles),
-- ce qui rend la matrice role_permissions inutile : un `educator` reçoit
-- TOUTES les routes du contrôleur même si la matrice ne lui accorde que
-- 'read'/'write'/'check_in'…
--
-- Correction : une fonction SECURITY DEFINER qui résout les permissions
-- effectives d'un utilisateur (rôles effectifs via auth_user_roles, migration
-- 040) contre role_permissions.
--
-- Décision : implémenter le guard (ne pas supprimer la table) — la matrice
-- est la modélisation RBAC de la loi 25-11 / décret 19-253 (séparation DPO).
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_user_permissions(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  permission_key text  -- '<resource>:<action>'
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT aur.organization_id,
           p.resource || ':' || p.action
    FROM auth_user_roles(p_user_id) aur
    JOIN roles r ON r.slug = aur.role_slug
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id;
END $$;

REVOKE ALL ON FUNCTION auth_user_permissions(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_user_permissions(uuid) TO creche_app;
  END IF;
END $$;
