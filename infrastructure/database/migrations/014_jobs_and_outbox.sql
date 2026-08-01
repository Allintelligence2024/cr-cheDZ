-- ============================================================================
-- 014_jobs_and_outbox.sql
-- Infrastructure : file de jobs asynchrones (worker), outbox (événements
-- vers workers), feature flags (globaux ou par organisation).
-- Les flags par défaut sont insérés par le seed 014_feature_flags.sql.
-- ============================================================================

CREATE TABLE background_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id),
  job_type TEXT NOT NULL, -- generate_invoice_pdf, send_push, send_sms,
                          -- compress_media, send_monthly_invoices, export_report
  payload JSONB NOT NULL,
  status job_status NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 5,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Outbox pattern : événements publiés vers les workers/consommateurs externes
CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE feature_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  flag_key TEXT NOT NULL,
  organization_id UUID REFERENCES organizations(id), -- NULL = global
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(flag_key, organization_id)
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE background_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE background_jobs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS background_jobs_tenant ON background_jobs;
CREATE POLICY background_jobs_tenant ON background_jobs
  USING (
    organization_id IS NULL
    OR organization_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = current_setting('app.tenant_id', true)::uuid
  );

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbox_events_tenant ON outbox_events;
CREATE POLICY outbox_events_tenant ON outbox_events
  USING (
    organization_id IS NULL
    OR organization_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = current_setting('app.tenant_id', true)::uuid
  );

-- feature_flags : globale (org NULL) ou par organisation
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flags_tenant ON feature_flags;
CREATE POLICY feature_flags_tenant ON feature_flags
  USING (
    organization_id IS NULL
    OR organization_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    organization_id IS NULL
    OR organization_id = current_setting('app.tenant_id', true)::uuid
  );

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_jobs_pending
  ON background_jobs(status, priority DESC, scheduled_at)
  WHERE status = 'pending';
CREATE INDEX idx_outbox_unpublished ON outbox_events(created_at) WHERE published_at IS NULL;
CREATE INDEX idx_feature_flags_org ON feature_flags(flag_key, organization_id);
