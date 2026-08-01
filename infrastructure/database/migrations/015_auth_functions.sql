-- ============================================================================
-- 015_auth_functions.sql
-- Fonctions SECURITY DEFINER pour le bootstrap d'authentification.
--
-- Pourquoi : memberships et devices sont sous RLS FORCE. La connexion
-- (login/refresh) n'a pas encore de contexte tenant, or elle doit lire la
-- membership de l'utilisateur et vérifier l'état de l'appareil. Ces fonctions
-- s'exécutent avec les droits du propriétaire (le rôle de migration), jamais
-- avec ceux du client — elles sont le SEUL chemin de lecture cross-tenant
-- autorisé et sont restreintes à l'usage du service d'authentification.
-- ============================================================================

-- Memberships actives d'un utilisateur (avec infos organisation et rôle)
CREATE OR REPLACE FUNCTION auth_get_memberships(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  role_id uuid,
  role_slug text,
  role_name text,
  site_id uuid,
  room_ids uuid[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.organization_id,
         o.name_fr,
         m.role_id,
         r.slug,
         r.name,
         m.site_id,
         m.room_ids
  FROM memberships m
  JOIN roles r        ON r.id = m.role_id
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id
    AND m.is_active = true
    AND o.is_active = true
  ORDER BY m.joined_at ASC NULLS LAST, m.created_at ASC;
$$;

-- Session + état de l'appareil pour le refresh (évite de lire devices sous RLS)
CREATE OR REPLACE FUNCTION auth_refresh_lookup(p_refresh_hash text)
RETURNS TABLE (
  session_id uuid,
  user_id uuid,
  organization_id uuid,
  device_id uuid,
  device_revoked boolean,
  user_status text,
  session_revoked_at timestamptz,
  revoked_reason text,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id,
         s.user_id,
         s.organization_id,
         s.device_id,
         (d.revoked_at IS NOT NULL OR d.is_active = false) AS device_revoked,
         u.status::text,
         s.revoked_at,
         s.revoked_reason,
         s.expires_at
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN devices d ON d.id = s.device_id
  WHERE s.refresh_token_hash = p_refresh_hash;
$$;

-- État d'un appareil (vérification de révocation hors contexte tenant)
CREATE OR REPLACE FUNCTION auth_get_device(p_device_id uuid)
RETURNS TABLE (id uuid, organization_id uuid, is_active boolean, revoked_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT d.id, d.organization_id, d.is_active, d.revoked_at
  FROM devices d
  WHERE d.id = p_device_id;
$$;

-- Droits d'exécution : uniquement le rôle applicatif (jamais PUBLIC)
REVOKE ALL ON FUNCTION auth_get_memberships(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_refresh_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION auth_get_device(uuid) FROM PUBLIC;

-- En production, le rôle applicatif est créé par infrastructure/database/roles.sql
-- avant les migrations ; en dev/CI, il peut ne pas exister → octroi conditionnel.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_get_memberships(uuid) TO creche_app;
    GRANT EXECUTE ON FUNCTION auth_refresh_lookup(text) TO creche_app;
    GRANT EXECUTE ON FUNCTION auth_get_device(uuid) TO creche_app;
  END IF;
END $$;
