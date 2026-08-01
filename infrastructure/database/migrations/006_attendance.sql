-- ============================================================================
-- 006_attendance.sql
-- Présences : sessions (1/enfant/jour), événements append-only,
-- synchronisation offline (opérations + curseurs) et
-- sync_changelog (C02 — curseur par séquence, pas par horloge).
-- ============================================================================

-- Session de présence (une par enfant par jour)
CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  room_id UUID REFERENCES rooms(id),
  child_id UUID NOT NULL REFERENCES children(id),
  session_date DATE NOT NULL,
  status attendance_status NOT NULL DEFAULT 'expected',
  expected_arrival TIME,
  expected_departure TIME,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(child_id, session_date)
);

-- Événements de présence (immuables, append-only)
CREATE TABLE attendance_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  session_id UUID NOT NULL REFERENCES attendance_sessions(id),
  child_id UUID NOT NULL REFERENCES children(id),
  event_type TEXT NOT NULL, -- check_in, check_out, absence_declared, correction
  occurred_at TIMESTAMPTZ NOT NULL,
  server_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  absence_reason TEXT,
  correction_of UUID REFERENCES attendance_events(id),
  correction_reason TEXT,
  -- Champs de synchronisation
  sync_event_id UUID UNIQUE,
  is_offline BOOLEAN NOT NULL DEFAULT false,
  device_time TIMESTAMPTZ
);

-- Table de synchronisation des opérations offline
CREATE TABLE sync_operations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  user_id UUID NOT NULL REFERENCES users(id),
  event_id UUID NOT NULL UNIQUE,
  client_sequence BIGINT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  command sync_command NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  payload JSONB NOT NULL,
  base_version INTEGER,
  occurred_at_device TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, accepted, rejected, conflict
  rejection_reason TEXT,
  conflict_details JSONB
);

-- Curseurs de synchronisation par appareil
CREATE TABLE sync_cursors (
  device_id UUID NOT NULL REFERENCES devices(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  cursor_value BIGINT NOT NULL DEFAULT 0,
  last_sync_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(device_id, organization_id)
);

-- ============================================================================
-- sync_changelog — C02 : curseur monotone (BIGSERIAL) au lieu de l'horloge.
-- Toute écriture métier (présence, journal, média, enfant…) écrit ici une
-- ligne DANS LA MÊME TRANSACTION. Le pull lit les lignes > cursor.
-- ============================================================================
CREATE TABLE sync_changelog (
  sync_seq BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  aggregate_type TEXT NOT NULL,   -- attendance_event | daily_log | media | child | correction
  aggregate_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,         -- delta minimal pour la mise à jour locale
  origin_device_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS att_sessions_tenant ON attendance_sessions;
CREATE POLICY att_sessions_tenant ON attendance_sessions
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS att_events_tenant ON attendance_events;
CREATE POLICY att_events_tenant ON attendance_events
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sync_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_operations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_operations_tenant ON sync_operations;
CREATE POLICY sync_operations_tenant ON sync_operations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_cursors_tenant ON sync_cursors;
CREATE POLICY sync_cursors_tenant ON sync_cursors
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE sync_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_changelog FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sync_changelog_tenant ON sync_changelog;
CREATE POLICY sync_changelog_tenant ON sync_changelog
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_att_sessions_org_date ON attendance_sessions(organization_id, session_date DESC);
CREATE INDEX idx_att_sessions_child ON attendance_sessions(child_id, session_date DESC);
CREATE INDEX idx_att_sessions_room_date ON attendance_sessions(room_id, session_date);
CREATE INDEX idx_att_events_session ON attendance_events(session_id, server_time DESC);
CREATE INDEX idx_sync_ops_device ON sync_operations(device_id, client_sequence);
CREATE INDEX idx_sync_ops_status ON sync_operations(organization_id, status) WHERE status = 'pending';
CREATE INDEX idx_sync_changelog_org_seq ON sync_changelog(organization_id, sync_seq);
