-- ============================================================================
-- 008_media.sql
-- Médias (photos, documents, avatars) : stockage objet (MinIO/S3) référencé
-- ici ; journalisation des accès (loi 25-11) ; contrôle consentements.
-- ============================================================================

CREATE TABLE media_assets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID REFERENCES children(id) ON DELETE RESTRICT,
  log_event_id UUID REFERENCES daily_log_events(id),
  uploaded_by UUID NOT NULL REFERENCES users(id),
  media_type media_type NOT NULL DEFAULT 'photo',
  storage_key TEXT NOT NULL UNIQUE,
  thumbnail_key TEXT,
  original_filename TEXT,
  mime_type TEXT NOT NULL,
  file_size_bytes INTEGER,
  width_px INTEGER,
  height_px INTEGER,
  taken_at TIMESTAMPTZ,
  exif_stripped BOOLEAN NOT NULL DEFAULT false,
  checksum TEXT,
  is_visible_to_parents BOOLEAN NOT NULL DEFAULT false,
  visible_at TIMESTAMPTZ,
  -- Enfants présents sur la photo (pour vérification consentements)
  children_in_photo UUID[],
  all_consents_checked BOOLEAN NOT NULL DEFAULT false,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Accès aux médias (journalisation conforme loi 25-11)
CREATE TABLE media_access_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_id UUID NOT NULL REFERENCES media_assets(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  accessed_by UUID NOT NULL REFERENCES users(id),
  access_type TEXT NOT NULL, -- view, download, share
  ip_address INET,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- Trigger : incrément du compteur photo de daily_summaries (migration 007).
-- ============================================================================
CREATE OR REPLACE FUNCTION bump_daily_photo_count() RETURNS trigger AS $$
DECLARE
  v_date DATE;
BEGIN
  IF NEW.media_type <> 'photo' OR NEW.child_id IS NULL THEN
    RETURN NEW;
  END IF;
  v_date := COALESCE(NEW.taken_at, NEW.created_at)::date;
  INSERT INTO daily_summaries (organization_id, child_id, summary_date, photo_count)
  VALUES (NEW.organization_id, NEW.child_id, v_date, 1)
  ON CONFLICT (child_id, summary_date) DO UPDATE SET
    photo_count = daily_summaries.photo_count + 1,
    last_updated = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_daily_photo_count
  AFTER INSERT ON media_assets
  FOR EACH ROW EXECUTE FUNCTION bump_daily_photo_count();

-- RLS ------------------------------------------------------------------------

ALTER TABLE media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_assets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_tenant ON media_assets;
CREATE POLICY media_tenant ON media_assets
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE media_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_access_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS media_access_tenant ON media_access_logs;
CREATE POLICY media_access_tenant ON media_access_logs
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_media_child ON media_assets(child_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_org_date ON media_assets(organization_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_media_visible
  ON media_assets(child_id, is_visible_to_parents)
  WHERE is_visible_to_parents = true AND deleted_at IS NULL;
CREATE INDEX idx_media_access_media ON media_access_logs(media_id, accessed_at DESC);
