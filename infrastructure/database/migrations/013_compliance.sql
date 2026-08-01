-- ============================================================================
-- 013_compliance.sql
-- Conformité : jeux de règles (décret exécutif 19-253 du 16/09/2019),
-- règles paramétrées en base, résultats des vérifications.
-- Le jeu de règles initial est inséré par le seed 013_compliance.sql.
-- ============================================================================

CREATE TABLE compliance_rule_sets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  jurisdiction TEXT NOT NULL DEFAULT 'DZ',
  establishment_type TEXT NOT NULL DEFAULT 'creche',
  effective_from DATE NOT NULL,
  effective_until DATE,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE compliance_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_set_id UUID NOT NULL REFERENCES compliance_rule_sets(id),
  code TEXT NOT NULL,
  category TEXT NOT NULL, -- ratio, document, registration, capacity, health
  parameters JSONB NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning', -- critical, warning, info
  message_fr TEXT NOT NULL,
  message_ar TEXT,
  reference TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Vérifications de conformité (résultats des contrôles)
CREATE TABLE compliance_checks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID REFERENCES sites(id),
  rule_id UUID NOT NULL REFERENCES compliance_rules(id),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result TEXT NOT NULL, -- pass, fail, warning
  details JSONB,
  checked_by TEXT NOT NULL DEFAULT 'system', -- system, director, inspector
  acknowledged_by UUID REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE compliance_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_checks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compliance_checks_tenant ON compliance_checks;
CREATE POLICY compliance_checks_tenant ON compliance_checks
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_compliance_checks_org ON compliance_checks(organization_id, checked_at DESC);
CREATE INDEX idx_compliance_rules_set ON compliance_rules(rule_set_id) WHERE is_active = true;
