-- ============================================================================
-- 038_report_exports.sql
-- Roadmap v2 — exports Excel (présences, facturation) générés par le worker.
-- Le job export_report écrit un fichier (backend local ou S3) et enregistre
-- la référence ici ; l'API liste les exports du tenant et sert le téléchargement.
-- ============================================================================

CREATE TABLE report_exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  report_type TEXT NOT NULL,            -- attendance, invoices
  period_label TEXT NOT NULL,           -- '2026-07' ou '2026-07-01..2026-07-31'
  status TEXT NOT NULL DEFAULT 'pending', -- pending, done, failed
  storage_key TEXT,
  file_size_bytes INTEGER,
  failure_reason TEXT,
  requested_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_exports FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS report_exports_tenant ON report_exports;
CREATE POLICY report_exports_tenant ON report_exports
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_report_exports_org ON report_exports (organization_id, created_at DESC);
