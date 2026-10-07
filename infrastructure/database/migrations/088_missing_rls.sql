-- ============================================================================
-- 088_missing_rls.sql
-- P2 (remédiation 2026-10-04, phase 3.1.1) — tables portant des données
-- multi-organisation sans RLS.
--
--  - compliance_rule_sets / compliance_rules (013) : règles par org, lisibles
--    et modifiables par toute requête authentifiée → fuite d'une org à l'autre.
--  - sessions (003), audit_logs / data_access_logs (004) : RBAC d'accès en
--    lecture sur le schéma → un éducateur d'une org voit les sessions et
--    journaux d'audit d'une autre org.
--
-- FORCE RLS : même le superuser et les fonctions SECURITY DEFINER sous
-- `creche_app` sont filtrées — politique définie par ailleurs.
-- Politiques : USING/SELECT/UPDATE/DELETE restreint + INSERT avec WITH CHECK.
-- Audit_logs reçoit une politique d'insertion permissive car l'écriture se fait
-- via une fonction SECURITY DEFINER sans tenant posé (pour préserver la cause
-- même d'une erreur d'authentification).
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    CREATE ROLE creche_app NOLOGIN;
  END IF;
END $$;

-- ------------------------------------------------------------------ 013
ALTER TABLE compliance_rule_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_rule_sets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compliance_rule_sets_tenant ON compliance_rule_sets;
CREATE POLICY compliance_rule_sets_tenant ON compliance_rule_sets
  FOR ALL
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

ALTER TABLE compliance_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_rules FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compliance_rules_tenant ON compliance_rules;
CREATE POLICY compliance_rules_tenant ON compliance_rules
  FOR ALL
  USING (rule_set_id IN (SELECT id FROM compliance_rule_sets))
  WITH CHECK (rule_set_id IN (SELECT id FROM compliance_rule_sets));

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_rule_sets TO creche_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance_rules TO creche_app;

-- ------------------------------------------------------------------ 003 (sessions)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_tenant ON sessions;
CREATE POLICY sessions_tenant ON sessions
  FOR ALL
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO creche_app;

-- ------------------------------------------------------------------ 004 (audit_logs, data_access_logs)
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

-- Lecture : tenant only. Insertion : permissive car les fonctions SECURITY
-- DEFINER d'audit écrivent sans tenant posé (notamment pour tracer les
-- échecs d'auth : avant que le tenant ne soit résolu).
DROP POLICY IF EXISTS audit_logs_tenant ON audit_logs;
CREATE POLICY audit_logs_tenant ON audit_logs
  FOR SELECT
  USING (organization_id = app_tenant_id());

DROP POLICY IF EXISTS audit_logs_insert_any ON audit_logs;
CREATE POLICY audit_logs_insert_any ON audit_logs
  FOR INSERT
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON audit_logs TO creche_app;

ALTER TABLE data_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_access_logs_tenant ON data_access_logs;
CREATE POLICY data_access_logs_tenant ON data_access_logs
  FOR SELECT
  USING (organization_id = app_tenant_id());

DROP POLICY IF EXISTS data_access_logs_insert_any ON data_access_logs;
CREATE POLICY data_access_logs_insert_any ON data_access_logs
  FOR INSERT
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON data_access_logs TO creche_app;
