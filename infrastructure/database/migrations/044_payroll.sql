-- ============================================================================
-- 044_payroll.sql
-- Roadmap v2 — module paie (base : staff_profiles.base_salary).
-- Bulletins mensuels par employé, génération idempotente (UNIQUE
-- staff_id/mois), lignes par type (base, prime, indemnité, retenue),
-- totaux contrôlés en base. RLS tenant (USING + WITH CHECK).
-- ============================================================================

CREATE TABLE payroll_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft, finalized, cancelled
  total_gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(12,2) NOT NULL DEFAULT 0,
  generated_by UUID NOT NULL REFERENCES users(id),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, period_year, period_month)
);

CREATE TABLE payroll_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  run_id UUID NOT NULL REFERENCES payroll_runs(id),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id),
  user_id UUID NOT NULL REFERENCES users(id),
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  gross_amount NUMERIC(10,2) NOT NULL,
  deductions_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  net_amount NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft, paid
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(run_id, staff_id),
  CONSTRAINT chk_payroll_net CHECK (net_amount = gross_amount - deductions_amount AND net_amount >= 0)
);

CREATE TABLE payroll_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  entry_id UUID NOT NULL REFERENCES payroll_entries(id),
  line_type TEXT NOT NULL,               -- base, bonus, allowance, deduction
  label_fr TEXT NOT NULL,
  label_ar TEXT,
  amount NUMERIC(10,2) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_runs_tenant ON payroll_runs;
CREATE POLICY payroll_runs_tenant ON payroll_runs
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

ALTER TABLE payroll_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_entries_tenant ON payroll_entries;
CREATE POLICY payroll_entries_tenant ON payroll_entries
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

ALTER TABLE payroll_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_lines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_lines_tenant ON payroll_lines;
CREATE POLICY payroll_lines_tenant ON payroll_lines
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_payroll_runs_org ON payroll_runs (organization_id, period_year DESC, period_month DESC);
CREATE INDEX idx_payroll_entries_run ON payroll_entries (run_id);
CREATE INDEX idx_payroll_entries_staff ON payroll_entries (staff_id, period_year DESC, period_month DESC);
CREATE INDEX idx_payroll_lines_entry ON payroll_lines (entry_id);
