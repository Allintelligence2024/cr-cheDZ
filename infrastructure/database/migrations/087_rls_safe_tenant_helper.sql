-- ============================================================================
-- 087_rls_safe_tenant_helper.sql
-- P2 (remédiation 2026-10-04, phase 3.1.2) — cast current_setting() brut
-- réintroduit dans 6 politiques RLS.
--
-- La migration 018 avait éliminé ce pattern en créant app_tenant_id()
-- (NULLIF(btrim(...), '')::uuid — safe-by-default : 0 ligne, jamais d'erreur).
-- Les migrations 029 (3 tables), 068, 069 et 070 (2 tables) l'ont réintroduit :
-- `current_setting('app.tenant_id', true)::uuid` lève `ERROR 22P02
-- invalid input syntax for type uuid: ""` sur TOUTE requête si la GUC est
-- vide — pas seulement la table ciblée.
--
-- Conséquence concrète : une fonction SECURITY DEFINER qui oublie de poser le
-- tenant (bootstrap, job global, ou migration future) fait tomber 500 au lieu
-- de renvoyer 0 ligne.
--
-- Correction : DROP + CREATE de chaque politique avec app_tenant_id().
-- ============================================================================

-- 029 — privacy_violations
DROP POLICY IF EXISTS privacy_violations_tenant ON privacy_violations;
CREATE POLICY privacy_violations_tenant ON privacy_violations
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- 029 — privacy_request_exports
DROP POLICY IF EXISTS privacy_request_exports_tenant ON privacy_request_exports;
CREATE POLICY privacy_request_exports_tenant ON privacy_request_exports
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- 029 — privacy_dpias
DROP POLICY IF EXISTS privacy_dpias_tenant ON privacy_dpias;
CREATE POLICY privacy_dpias_tenant ON privacy_dpias
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- 068 — invoice_reminders
DROP POLICY IF EXISTS invoice_reminders_tenant ON invoice_reminders;
CREATE POLICY invoice_reminders_tenant ON invoice_reminders
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- 069 — attestations
DROP POLICY IF EXISTS attestations_tenant ON attestations;
CREATE POLICY attestations_tenant ON attestations
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- 070 — enrollment_requests
DROP POLICY IF EXISTS enrollment_requests_tenant ON enrollment_requests;
CREATE POLICY enrollment_requests_tenant ON enrollment_requests
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- 070 — staff_shifts
DROP POLICY IF EXISTS staff_shifts_tenant ON staff_shifts;
CREATE POLICY staff_shifts_tenant ON staff_shifts
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());
