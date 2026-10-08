-- ============================================================================
-- 097_sessions_rls_super_admin.sql
-- ----------------------------------------------------------------------------
-- Correctif de la migration 088_missing_rls.sql (remédiation RLS).
--
-- 088 a posé sur `sessions` :
--   ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
--   CREATE POLICY sessions_tenant ON sessions
--     FOR ALL
--     USING (organization_id = app_tenant_id())
--     WITH CHECK (organization_id = app_tenant_id());
--
-- PROBLÈME : un super-admin sans organisation (users.is_super_admin = true,
-- organization_id NULL) ne peut PLUS créer de session : NULL = NULL est NULL
-- en SQL (faux), donc WITH CHECK échoue → la connexion est rejetée. La
-- remédiation 088 sécurisait les tenants mais cassait le super-admin.
--
-- SOLUTION : politique PERMISSIVE supplémentaire ordonnée avant sessions_tenant
-- pour les lignes hors-tenant (organization_id NULL). Étant PERMISSIVE, elle
-- s'OR-ifie avec sessions_tenant (restrictive) : un super-admin NULL passe via
-- 097, un utilisateur tenanté reste soumis à sessions_tenant.
--
-- NOTE : avec createSession (apps/api), app.tenant_id est posé à
-- organizationId ?? NULL à l'INSERT, donc cette politique est utilisable sans
-- contexte de requête préalable.
-- ============================================================================

DROP POLICY IF EXISTS sessions_super_admin_no_org ON sessions;

-- Doit être créée AVANT sessions_tenant pour l'ordre d'évaluation et la
-- documentation ; PERMISSIVE donc l'ordre n'affecte pas le résultat (OR).
CREATE POLICY sessions_super_admin_no_org ON sessions
  FOR ALL
  AS PERMISSIVE
  USING (organization_id IS NULL)
  WITH CHECK (organization_id IS NULL);
