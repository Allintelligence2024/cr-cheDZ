-- ============================================================================
-- 035_support_flags.sql
-- Console support (super_admin) : lecture/modification de TOUS les feature
-- flags (globaux + surcharges par organisation). feature_flags est sous RLS
-- (org NULL = visible partout, org = tenant sinon) : le support n'a pas de
-- tenant → fonctions SECURITY DEFINER (pattern 015/024/029).
-- ============================================================================

CREATE OR REPLACE FUNCTION support_list_flags()
RETURNS TABLE (
  flag_key text, is_enabled boolean, description text,
  organization_id uuid, org_slug text, updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT ff.flag_key, ff.is_enabled, ff.description, ff.organization_id,
           o.slug, ff.updated_at
    FROM feature_flags ff
    LEFT JOIN organizations o ON o.id = ff.organization_id
    ORDER BY ff.flag_key, ff.organization_id NULLS FIRST;
END $$;

CREATE OR REPLACE FUNCTION support_set_flag(
  p_flag_key text,
  p_organization_id uuid,
  p_is_enabled boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO feature_flags (flag_key, organization_id, is_enabled, updated_at)
  VALUES (p_flag_key, p_organization_id, p_is_enabled, NOW())
  ON CONFLICT (flag_key, organization_id) DO UPDATE
    SET is_enabled = EXCLUDED.is_enabled, updated_at = NOW();
END $$;

REVOKE ALL ON FUNCTION support_list_flags() FROM PUBLIC;
REVOKE ALL ON FUNCTION support_set_flag(text, uuid, boolean) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION support_list_flags() TO creche_app;
    GRANT EXECUTE ON FUNCTION support_set_flag(text, uuid, boolean) TO creche_app;
  END IF;
END $$;
