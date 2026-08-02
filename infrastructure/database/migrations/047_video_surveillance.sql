-- ============================================================================
-- 047_video_surveillance.sql
-- Module vidéosurveillance (roadmap v2, post-DPIA — phase 21).
--
-- Verrous de conformité (docs/regulatory/DPIA-VIDEOSURVEILLANCE.md, §5) :
-- - zones LIMITÉES par CHECK : entrées, couloirs, espaces communs, cour —
--   jamais sanitaires / zones de change / sieste / infirmerie ;
-- - modules accessibles UNIQUEMENT quand le flag org video_surveillance est
--   actif (lui-même bloqué sans DPIA approuvée — migration 046) ;
-- - conservation 30 jours : purge via fonctions SECURITY DEFINER
--   (le worker y accède sous NOBYPASSRLS sans contexte tenant) ;
-- - visionnages journalisés en audit_logs côté API (action 'view').
--
-- RLS : deux tables tenant — USING + WITH CHECK via app_tenant_id() (C01).
-- ============================================================================

-- ── Caméras ──────────────────────────────────────────────────────────────────
CREATE TABLE video_cameras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  zone TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT video_cameras_zone_check
    CHECK (zone IN ('entrance', 'corridor', 'common_room', 'playground')),
  CONSTRAINT video_cameras_org_name_unique UNIQUE (organization_id, name)
);

-- ── Extraits vidéo (clips exportés du DVR/NVR local) ─────────────────────────
CREATE TABLE video_clips (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  camera_id UUID NOT NULL REFERENCES video_cameras(id),
  captured_at TIMESTAMPTZ NOT NULL,
  storage_backend TEXT NOT NULL CHECK (storage_backend IN ('local', 's3')),
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'video/mp4',
  size_bytes BIGINT,
  duration_seconds INTEGER,
  uploaded_by UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- purge à uploaded_at + 30 j
);

CREATE INDEX idx_video_clips_org_camera ON video_clips (organization_id, camera_id, captured_at DESC);
CREATE INDEX idx_video_clips_purge ON video_clips (uploaded_at);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE video_cameras ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_cameras FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_cameras_tenant ON video_cameras;
CREATE POLICY video_cameras_tenant ON video_cameras
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

ALTER TABLE video_clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_clips FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS video_clips_tenant ON video_clips;
CREATE POLICY video_clips_tenant ON video_clips
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());

-- ── Purge 30 jours (worker, NOBYPASSRLS, sans contexte tenant) ──────────────
-- Étape 1 : lister les clips expirés (lecture seule — le worker supprime
--           D'ABORD le stockage ; en cas d'échec la ligne reste et le job
--           échoue pour réessai, jamais de fausse purge).
CREATE OR REPLACE FUNCTION video_clips_expired(p_limit integer DEFAULT 500)
RETURNS TABLE (id uuid, organization_id uuid, storage_backend text, storage_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT c.id, c.organization_id, c.storage_backend, c.storage_key
    FROM video_clips c
    WHERE c.uploaded_at < NOW() - INTERVAL '30 days'
    ORDER BY c.uploaded_at
    LIMIT p_limit;
END $$;

-- Étape 2 : supprimer les lignes dont le stockage a été réellement supprimé.
CREATE OR REPLACE FUNCTION video_clips_delete_purged(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM video_clips WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION video_clips_expired(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION video_clips_delete_purged(uuid[]) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION video_clips_expired(integer) TO creche_app;
    GRANT EXECUTE ON FUNCTION video_clips_delete_purged(uuid[]) TO creche_app;
  END IF;
END $$;
