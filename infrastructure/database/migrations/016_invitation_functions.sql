-- ============================================================================
-- 016_invitation_functions.sql
-- Fonctions SECURITY DEFINER pour le cycle d'invitation.
--
-- Pourquoi : memberships est sous RLS FORCE. Le super_admin qui invite dans
-- une organisation arbitraire n'a PAS de contexte tenant ; l'acceptation
-- d'invitation est publique (pas de tenant non plus). Ces fonctions
-- s'exécutent avec les droits du propriétaire (rôle de migration) et sont
-- les SEULS chemins d'écriture sur memberships hors contexte tenant.
-- ============================================================================

-- /me a besoin de joined_at : extension de la fonction 015 (DROP + CREATE
-- dans une nouvelle migration, jamais d'édition de la 015 déjà appliquée).
DROP FUNCTION IF EXISTS auth_get_memberships(uuid);
CREATE FUNCTION auth_get_memberships(p_user_id uuid)
RETURNS TABLE (
  organization_id uuid,
  organization_name text,
  role_id uuid,
  role_slug text,
  role_name text,
  site_id uuid,
  room_ids uuid[],
  joined_at timestamptz
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
         m.room_ids,
         m.joined_at
  FROM memberships m
  JOIN roles r        ON r.id = m.role_id
  JOIN organizations o ON o.id = m.organization_id
  WHERE m.user_id = p_user_id
    AND m.is_active = true
    AND o.is_active = true
  ORDER BY m.joined_at ASC NULLS LAST, m.created_at ASC;
$$;

-- État d'une membership (utilisé par le service d'invitation)
CREATE OR REPLACE FUNCTION invite_get_membership(p_org uuid, p_user uuid)
RETURNS TABLE (id uuid, is_active boolean, joined_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, is_active, joined_at
  FROM memberships
  WHERE organization_id = p_org AND user_id = p_user;
$$;

-- Upsert d'une membership (invitation) — retourne l'id
CREATE OR REPLACE FUNCTION invite_upsert_membership(
  p_org uuid, p_user uuid, p_role uuid, p_site uuid, p_rooms uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO memberships (organization_id, user_id, role_id, site_id, room_ids, is_active, invited_at)
  VALUES (p_org, p_user, p_role, p_site, p_rooms, true, NOW())
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    role_id    = EXCLUDED.role_id,
    site_id    = EXCLUDED.site_id,
    room_ids   = EXCLUDED.room_ids,
    is_active  = true,
    invited_at = NOW(),
    joined_at  = NULL
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Acceptation : marque joined_at (l'utilisateur a activé son compte)
CREATE OR REPLACE FUNCTION invite_accept(p_user uuid, p_org uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE memberships
  SET joined_at = NOW()
  WHERE user_id = p_user AND organization_id = p_org AND is_active = true;
$$;

-- Droits : jamais PUBLIC
REVOKE ALL ON FUNCTION invite_get_membership(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION invite_upsert_membership(uuid, uuid, uuid, uuid, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION invite_accept(uuid, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION invite_get_membership(uuid, uuid) TO creche_app;
    GRANT EXECUTE ON FUNCTION invite_upsert_membership(uuid, uuid, uuid, uuid, uuid[]) TO creche_app;
    GRANT EXECUTE ON FUNCTION invite_accept(uuid, uuid) TO creche_app;
  END IF;
END $$;
