-- ============================================================================
-- 029_phase10_privacy_support.sql
-- Phase 10 : vie privée (loi 18-07 modifiée par 25-11) + console support.
--
-- 1) privacy_violations : workflow de violation de données — chrono de
--    notification ANPDP sous 5 jours.
-- 2) privacy_request_exports : exports JSON des demandes de droits (accès).
-- 3) privacy_dpias : analyses d'impact (photos enfants, santé, paie…).
-- 4) Fonctions SECURITY DEFINER pour la console support (recherche globale
--    cross-tenant, jobs, retry) — même pattern bootstrap que 015/016/017/024.
-- ============================================================================

-- ── Violations de données (chrono 5 jours ANPDP) ────────────────────────────
CREATE TABLE privacy_violations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  occurred_at TIMESTAMPTZ,
  description TEXT NOT NULL,
  data_categories TEXT[] NOT NULL DEFAULT '{}',
  affected_subjects INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'moderate', -- low, moderate, high, critical
  status TEXT NOT NULL DEFAULT 'open',       -- open, investigating, notified, closed
  notification_deadline TIMESTAMPTZ NOT NULL,
  anpdp_notified_at TIMESTAMPTZ,
  notification_status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, blocked_config
  dpo_notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Exports de demandes de droits (accès) ───────────────────────────────────
CREATE TABLE privacy_request_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  request_id UUID NOT NULL REFERENCES privacy_requests(id),
  payload JSONB NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Analyses d'impact (DPIA / AIPD) ─────────────────────────────────────────
CREATE TABLE privacy_dpias (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  processing_registry_id UUID NOT NULL REFERENCES processing_registry(id),
  status TEXT NOT NULL DEFAULT 'draft', -- draft, in_review, approved
  risk_assessment JSONB NOT NULL DEFAULT '{}',
  mitigation_measures TEXT[] NOT NULL DEFAULT '{}',
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  review_date DATE,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE privacy_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_violations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_violations_tenant ON privacy_violations;
CREATE POLICY privacy_violations_tenant ON privacy_violations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE privacy_request_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_request_exports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_request_exports_tenant ON privacy_request_exports;
CREATE POLICY privacy_request_exports_tenant ON privacy_request_exports
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE privacy_dpias ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_dpias FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_dpias_tenant ON privacy_dpias;
CREATE POLICY privacy_dpias_tenant ON privacy_dpias
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_privacy_violations_org ON privacy_violations(organization_id, created_at DESC);
CREATE INDEX idx_privacy_exports_request ON privacy_request_exports(request_id);
CREATE INDEX idx_privacy_dpias_org ON privacy_dpias(organization_id);

-- ── Console support : recherche globale (cross-tenant, super_admin) ─────────

CREATE OR REPLACE FUNCTION support_global_search(p_query text)
RETURNS TABLE (kind text, id uuid, label text, org_slug text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pattern text := '%' || lower(btrim(p_query)) || '%';
BEGIN
  IF btrim(p_query) = '' THEN RETURN; END IF;
  RETURN QUERY
    SELECT 'organization'::text, o.id, o.name_fr, o.slug
    FROM organizations o
    WHERE lower(o.slug) LIKE v_pattern OR lower(o.name_fr) LIKE v_pattern
    ORDER BY o.created_at DESC LIMIT 20;
  RETURN QUERY
    SELECT 'child'::text, c.id,
           c.reference_number || ' — ' || c.first_name_fr || ' ' || c.last_name_fr,
           o.slug
    FROM children c JOIN organizations o ON o.id = c.organization_id
    WHERE c.deleted_at IS NULL
      AND (lower(c.reference_number) LIKE v_pattern
           OR lower(c.first_name_fr) LIKE v_pattern
           OR lower(c.last_name_fr) LIKE v_pattern)
    ORDER BY c.created_at DESC LIMIT 20;
  RETURN QUERY
    SELECT 'user'::text, u.id, u.email, o.slug
    FROM users u
    LEFT JOIN memberships m ON m.user_id = u.id AND m.is_active = true
    LEFT JOIN organizations o ON o.id = m.organization_id
    WHERE u.deleted_at IS NULL AND lower(u.email) LIKE v_pattern
    ORDER BY u.created_at DESC LIMIT 20;
END $$;

-- ── Console support : jobs (liste + retry) ──────────────────────────────────
CREATE OR REPLACE FUNCTION support_list_jobs(p_limit integer DEFAULT 100)
RETURNS TABLE (
  id uuid, job_type text, status text, organization_id uuid,
  attempts integer, max_attempts integer, failure_reason text,
  created_at timestamptz, scheduled_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT bj.id, bj.job_type, bj.status, bj.organization_id,
           bj.attempts, bj.max_attempts, bj.failure_reason,
           bj.created_at, bj.scheduled_at
    FROM background_jobs bj
    ORDER BY bj.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500));
END $$;

CREATE OR REPLACE FUNCTION support_retry_job(p_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  UPDATE background_jobs
    SET status = 'pending', attempts = 0, failure_reason = NULL,
        scheduled_at = NOW(), failed_at = NULL
    WHERE id = p_id AND status IN ('failed', 'pending');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_NOT_RETRYABLE' USING ERRCODE = 'P0001';
  END IF;
END $$;

-- ── Droits (pattern conditionnel 015-028) ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION support_global_search(text) TO creche_app;
    GRANT EXECUTE ON FUNCTION support_list_jobs(integer) TO creche_app;
    GRANT EXECUTE ON FUNCTION support_retry_job(uuid) TO creche_app;
  END IF;
END $$;

REVOKE ALL ON FUNCTION support_global_search(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION support_list_jobs(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION support_retry_job(uuid) FROM PUBLIC;
