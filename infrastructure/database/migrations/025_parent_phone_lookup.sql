-- ============================================================================
-- 025_parent_phone_lookup.sql
-- Correction du login parent (OTP/PIN) sous rôle applicatif NOBYPASSRLS :
-- la vérification « l'utilisateur possède un profil guardian » interroge la
-- table tenant guardians, invisible sans tenant posé (RLS) — le login parent
-- échouait donc TOUJOURS avec le rôle applicatif (401). Même pattern que le
-- bootstrap auth (015) : fonction SECURITY DEFINER pour ce bootstrap.
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_parent_lookup_by_phone(p_phone text)
RETURNS users
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_user users%ROWTYPE;
BEGIN
  SELECT u.* INTO v_user FROM users u
  WHERE u.phone = p_phone AND u.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM guardians g WHERE g.user_id = u.id);
  RETURN v_user;
END $$;

REVOKE ALL ON FUNCTION auth_parent_lookup_by_phone(text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_parent_lookup_by_phone(text) TO creche_app;
  END IF;
END $$;
