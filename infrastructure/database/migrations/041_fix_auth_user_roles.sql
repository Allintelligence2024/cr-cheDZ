-- ============================================================================
-- 041_fix_auth_user_roles.sql
-- Correction de auth_user_roles() (migration 040) : « invalid
-- UNION/INTERSECT/EXCEPT ORDER BY clause » — un ORDER BY global n'est pas
-- valide dans un UNION ALL avec RETURN QUERY. Le tri est déplacé dans la
-- dernière branche (et un tri final est appliqué au SELECT englobant côté
-- appelant si nécessaire). CREATE OR REPLACE — migrations immuables.
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_user_roles(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  role_slug text,
  is_primary boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT m.organization_id, r.slug, true
    FROM memberships m JOIN roles r ON r.id = m.role_id
    WHERE m.user_id = p_user_id AND m.is_active = true
  UNION ALL
    SELECT ra.organization_id, r.slug, false
    FROM role_assignments ra JOIN roles r ON r.id = ra.role_id
    WHERE ra.user_id = p_user_id
  ORDER BY 1, 3 DESC, 2;
END $$;

REVOKE ALL ON FUNCTION auth_user_roles(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_user_roles(uuid) TO creche_app;
  END IF;
END $$;
