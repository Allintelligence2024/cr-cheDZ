-- ============================================================================
-- 099_audit_logs_tenant_context.sql
-- Correctif (2026-10-09) : audit_logs/data_access_logs sont FORCE RLS (088)
-- et AuditService.log()/logDataAccess() écrivaient via la POOL DIRECTE sans
-- GUC app.tenant_id. Le WITH CHECK était
-- `organization_id IS NULL OR organization_id = app_tenant_id()` : sur la
-- pool, app_tenant_id() vaut NULL, donc `organization_id = NULL` est NULL
-- (jamais TRUE) — TOUT INSERT avec un organization_id était rejeté, l'erreur
-- avalée par le try/catch, et le journal d'audit restait VIDE pour chaque
-- action métier. Non-conformité loi 18-07/25-11.
--
-- Décision : garder l'ancrage tenant (exigé par schema-check 1d) et corriger
-- l'ÉCRIVAIN. AuditService pose maintenant app.tenant_id sur sa connexion
-- quand il connaît l'organization (voir audit.service.ts), puis RESTORE la
-- valeur précédente (jamais un RESET brut — la pool est partagée). La policy
-- reste `organization_id IS NULL OR organization_id = app_tenant_id()` :
--  - organization_id NULL : traces d'auth avant résolution du tenant ;
--  - organization_id = tenant : un tenant ne trace que pour lui-même.
-- Aucun changement de politique : la migration existe pour documenter le
-- correctif côté écrivain et remettre le COMMENT de la policy.
-- ============================================================================

ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_insert_any ON audit_logs;
-- Identique à 088, mais le contrat d'écriture est désormais respecté :
-- AuditService pose app.tenant_id avant l'INSERT.
CREATE POLICY audit_logs_insert_any ON audit_logs
  FOR INSERT
  -- organization_id IS NULL : trace des échecs d'auth avant résolution du
  -- tenant (AuditEntry.organizationId ?? null). organization_id =
  -- app_tenant_id() : un tenant ne peut tracer QUE pour lui-même.
  WITH CHECK (organization_id IS NULL OR organization_id = app_tenant_id());

GRANT INSERT ON audit_logs TO creche_app;
