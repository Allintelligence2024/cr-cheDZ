-- ============================================================================
-- 040_role_assignments.sql
-- Roadmap v2 — MULTI-RÔLES par utilisateur et par organisation (évolution
-- d'ADR-001) : la table role_assignments porte les rôles ADDITIONNELS ;
-- memberships.role_id reste le « rôle principal » (rétrocompatibilité totale :
-- /me, invitations, guards et les tests existants continuent de fonctionner).
-- Le JWT embarque désormais roles[] (tous les rôles) en plus de role (principal).
--
-- Garde : les rôles additionnels ne peuvent pas dupliquer le rôle principal
-- (même organisation).
-- ============================================================================

CREATE TABLE role_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  assigned_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id, role_id)
);

-- RLS (C01 : toute table avec organization_id)

ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_assignments_tenant ON role_assignments;
CREATE POLICY role_assignments_tenant ON role_assignments
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

CREATE INDEX idx_role_assignments_user ON role_assignments (user_id, organization_id);

-- Fonction SECURITY DEFINER : liste des rôles effectifs d'un utilisateur
-- (principal + additions) — pattern bootstrap auth (015).

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
  ORDER BY organization_id, is_primary DESC, role_slug;
END $$;

REVOKE ALL ON FUNCTION auth_user_roles(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_user_roles(uuid) TO creche_app;
  END IF;
END $$;
