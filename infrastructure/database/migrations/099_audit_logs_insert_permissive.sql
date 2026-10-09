-- ============================================================================
-- 099_audit_logs_insert_permissive.sql
-- Correctif (2026-10-09) : audit_logs_insert_any et data_access_logs_insert_any
-- (088). Les commentaires disaient « Insertion : permissive », mais le WITH
-- CHECK était `organization_id IS NULL OR organization_id = app_tenant_id()`. Or
-- AuditService.log() écrit via la POOL DIRECTE (pas de GUC app.tenant_id)
-- pour tracer même avant résolution du tenant — app_tenant_id() y vaut NULL,
-- donc `organization_id = NULL` est NULL (jamais TRUE). Résultat : TOUT
-- INSERT avec un organization_id non NULL était rejeté, et l'erreur étant
-- avalée (log()), le journal d'audit était vide pour chaque action métier.
-- Loi 18-07/25-11 : un journal d'audit muet est une non-conformité.
-- Fix : WITH CHECK TRUE. L'isolation est portée par la SELECT policy
-- (audit_logs_tenant : organization_id = app_tenant_id()) — un tenant ne lit
-- que ses propres lignes. Le WRITE CHECK n'ajoutait aucune sécurité : tout
-- rôle applicatif peut déjà écrire, et écrire pour un autre tenant n'a aucun
-- gain (invisible à la lecture).
-- ============================================================================
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_insert_any ON audit_logs;
CREATE POLICY audit_logs_insert_any ON audit_logs
  FOR INSERT
  -- Permissive : trace des échecs d'auth avant résolution du tenant
  -- (organization_id NULL) ET des actions métier (organization_id du tenant),
  -- toutes écrites via la pool directe sans GUC posé.
  WITH CHECK (TRUE);

GRANT INSERT ON audit_logs TO creche_app;

ALTER TABLE data_access_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS data_access_logs_insert_any ON data_access_logs;
CREATE POLICY data_access_logs_insert_any ON data_access_logs
  FOR INSERT
  WITH CHECK (TRUE);

GRANT INSERT ON data_access_logs TO creche_app;
