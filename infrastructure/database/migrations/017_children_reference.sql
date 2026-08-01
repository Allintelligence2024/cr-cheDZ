-- ============================================================================
-- 017_children_reference.sql
-- Séquence de référence par organisation (reference_number des enfants).
--
-- La table est technique (aucun accès direct) : l'incrément se fait
-- EXCLUSIVEMENT via la fonction SECURITY DEFINER next_org_sequence().
-- ============================================================================

CREATE TABLE org_sequences (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id),
  seq BIGINT NOT NULL DEFAULT 0
);

-- RLS (C01 : toute table avec organization_id) — la fonction SECURITY DEFINER
-- (exécutée avec les droits du propriétaire) y accède hors contexte tenant.
ALTER TABLE org_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_sequences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS org_sequences_tenant ON org_sequences;
CREATE POLICY org_sequences_tenant ON org_sequences
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Incrément atomique de la séquence d'une organisation
CREATE OR REPLACE FUNCTION next_org_sequence(p_org uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_seq bigint;
BEGIN
  INSERT INTO org_sequences (organization_id) VALUES (p_org) ON CONFLICT DO NOTHING;
  UPDATE org_sequences SET seq = seq + 1 WHERE organization_id = p_org RETURNING seq INTO v_seq;
  RETURN v_seq;
END $$;

REVOKE ALL ON FUNCTION next_org_sequence(uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION next_org_sequence(uuid) TO creche_app;
  END IF;
END $$;
