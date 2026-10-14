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
-- NOTE (2026-10-07) : compliance_rule_sets / compliance_rules sont des tables
-- de RÉFÉRENCE réglementaires globales (catalogue national — décret 19-253),
-- lues SANS filtre tenant par ComplianceService.runChecks
-- (`WHERE rs.status = 'active' AND cr.is_active = true`, pas de organization_id
-- dans le WHERE). Elles n'ont PAS de colonne organization_id (migration 013) —
-- les mettre sous RLS tenant cassait à la fois la migration (column does not
-- exist) et le service (aucune règle visible). La fuite d'une org à l'autre
-- dénoncée par l'audit n'existe pas ici : ces données sont identiques pour
-- tous les tenants par conception. Seul compliance_checks (résultats) porte
-- organization_id + RLS (déjà en place en 013). Aucune RLS ici.
GRANT SELECT ON compliance_rule_sets TO creche_app;
GRANT SELECT ON compliance_rules TO creche_app;

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
  -- organization_id IS NULL : trace des échecs d'auth avant résolution du
  -- tenant (organizationId ?? null côté API). organization_id = app_tenant_id()
  -- : un tenant ne peut tracer QUE pour lui-même — jamais pour un autre.
  WITH CHECK (organization_id IS NULL OR organization_id = app_tenant_id());

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
  -- AuditService.logDataAccess écrit via this.pool (connexion hors contexte
  -- tenant, GUC non posée) en passant organizationId explicitement
  -- (requireTenant) — d'où la branche NULL. Un tenant ne peut écrire QUE
  -- pour lui-même : jamais un organization_id étranger.
  WITH CHECK (organization_id IS NULL OR organization_id = app_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON data_access_logs TO creche_app;
