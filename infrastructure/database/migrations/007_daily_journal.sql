-- ============================================================================
-- 007_daily_journal.sql
-- Journal quotidien : événements append-only (repas, sieste, change,
-- activité, température, note, incident) + agrégats quotidiens tenus par
-- trigger (daily_summaries).
-- ============================================================================

-- Tous les événements de la journée — modèle événementiel, jamais d'écrasement
CREATE TABLE daily_log_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  room_id UUID REFERENCES rooms(id),
  event_date DATE NOT NULL,
  event_type TEXT NOT NULL, -- meal, nap_start, nap_end, diaper, activity,
                            -- temperature, note, health_observation, incident
  occurred_at TIMESTAMPTZ NOT NULL,
  server_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  recorded_by UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  is_offline BOOLEAN NOT NULL DEFAULT false,
  sync_event_id UUID,
  -- Repas
  meal_type TEXT,           -- breakfast, lunch, snack, bottle
  meal_quantity meal_quantity,
  meal_notes TEXT,
  -- Sieste
  nap_start_at TIMESTAMPTZ,
  nap_end_at TIMESTAMPTZ,
  nap_quality TEXT,         -- good, agitated, refused
  -- Change
  diaper_type TEXT,         -- wet, dirty, both, dry
  -- Santé
  temperature_celsius NUMERIC(4,1),
  health_observation TEXT,
  medication_given BOOLEAN DEFAULT false,
  -- Activité
  activity_name TEXT,
  activity_notes TEXT,
  -- Note générale
  note_text TEXT,
  note_is_private BOOLEAN DEFAULT false,
  -- Incident
  incident_severity TEXT,   -- minor, moderate, serious
  incident_description TEXT,
  incident_action TEXT,
  incident_notified BOOLEAN DEFAULT false,
  -- Correction (append-only : corriger = insérer un nouvel événement)
  is_correction BOOLEAN NOT NULL DEFAULT false,
  corrects_event_id UUID REFERENCES daily_log_events(id),
  correction_reason TEXT,
  -- Visible aux parents
  visible_to_parents BOOLEAN NOT NULL DEFAULT true,
  parent_notified BOOLEAN NOT NULL DEFAULT false,
  parent_notified_at TIMESTAMPTZ
);

-- Vue agrégée pour performance de lecture (tenue par trigger)
CREATE TABLE daily_summaries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  summary_date DATE NOT NULL,
  meal_count INTEGER NOT NULL DEFAULT 0,
  nap_minutes INTEGER NOT NULL DEFAULT 0,
  diaper_count INTEGER NOT NULL DEFAULT 0,
  activity_count INTEGER NOT NULL DEFAULT 0,
  has_incident BOOLEAN NOT NULL DEFAULT false,
  has_health_obs BOOLEAN NOT NULL DEFAULT false,
  photo_count INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(child_id, summary_date)
);

-- ============================================================================
-- Trigger : maintien incrémental de daily_summaries à chaque INSERT
-- d'événement de journal (append-only => pas de trigger UPDATE/DELETE).
-- ============================================================================
CREATE OR REPLACE FUNCTION upsert_daily_summary_on_event() RETURNS trigger AS $$
DECLARE
  v_nap_minutes INTEGER := 0;
BEGIN
  IF NEW.is_correction THEN
    RETURN NEW; -- les corrections ne re-comptent pas les agrégats
  END IF;

  IF NEW.nap_start_at IS NOT NULL AND NEW.nap_end_at IS NOT NULL THEN
    v_nap_minutes := GREATEST(0, EXTRACT(EPOCH FROM (NEW.nap_end_at - NEW.nap_start_at)) / 60)::INTEGER;
  END IF;

  INSERT INTO daily_summaries
    (organization_id, child_id, summary_date,
     meal_count, nap_minutes, diaper_count, activity_count,
     has_incident, has_health_obs)
  VALUES
    (NEW.organization_id, NEW.child_id, NEW.event_date,
     CASE WHEN NEW.event_type IN ('meal', 'bottle') THEN 1 ELSE 0 END,
     v_nap_minutes,
     CASE WHEN NEW.event_type = 'diaper' THEN 1 ELSE 0 END,
     CASE WHEN NEW.event_type = 'activity' THEN 1 ELSE 0 END,
     NEW.event_type = 'incident',
     NEW.event_type IN ('temperature', 'health_observation'))
  ON CONFLICT (child_id, summary_date) DO UPDATE SET
    meal_count     = daily_summaries.meal_count + EXCLUDED.meal_count,
    nap_minutes    = daily_summaries.nap_minutes + EXCLUDED.nap_minutes,
    diaper_count   = daily_summaries.diaper_count + EXCLUDED.diaper_count,
    activity_count = daily_summaries.activity_count + EXCLUDED.activity_count,
    has_incident   = daily_summaries.has_incident OR EXCLUDED.has_incident,
    has_health_obs = daily_summaries.has_health_obs OR EXCLUDED.has_health_obs,
    last_updated   = NOW();

  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_summary
  AFTER INSERT ON daily_log_events
  FOR EACH ROW EXECUTE FUNCTION upsert_daily_summary_on_event();

-- RLS ------------------------------------------------------------------------

ALTER TABLE daily_log_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_events_tenant ON daily_log_events;
CREATE POLICY daily_events_tenant ON daily_log_events
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_summaries_tenant ON daily_summaries;
CREATE POLICY daily_summaries_tenant ON daily_summaries
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_daily_events_child_date ON daily_log_events(child_id, event_date DESC);
CREATE INDEX idx_daily_events_room_date ON daily_log_events(room_id, event_date);
CREATE INDEX idx_daily_events_org_date ON daily_log_events(organization_id, event_date DESC);
CREATE INDEX idx_daily_events_visible
  ON daily_log_events(child_id, event_date, visible_to_parents)
  WHERE visible_to_parents = true;
CREATE INDEX idx_daily_summaries_child_date ON daily_summaries(child_id, summary_date DESC);
