-- ============================================================================
-- 034_phase11_retention.sql
-- Phase 11 — rétention des journaux (loi 25-11, recommandation 5 ans).
-- Fonction SECURITY DEFINER de purge : audit_logs et data_access_logs sont
-- des tables système (sans RLS), media_access_logs est sous RLS → le worker
-- (rôle NOBYPASSRLS) ne peut pas la purger directement. Cette fonction est
-- l'équivalent retention du bootstrap auth (015) — pattern documenté.
-- ============================================================================

CREATE OR REPLACE FUNCTION retention_purge_logs(p_cutoff timestamptz)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_total bigint := 0;
        v_batch bigint;
BEGIN
  LOOP
    DELETE FROM audit_logs WHERE occurred_at < p_cutoff AND id IN (
      SELECT id FROM audit_logs WHERE occurred_at < p_cutoff LIMIT 5000
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch < 5000;
  END LOOP;
  LOOP
    DELETE FROM data_access_logs WHERE accessed_at < p_cutoff AND id IN (
      SELECT id FROM data_access_logs WHERE accessed_at < p_cutoff LIMIT 5000
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch < 5000;
  END LOOP;
  LOOP
    DELETE FROM media_access_logs WHERE accessed_at < p_cutoff AND id IN (
      SELECT id FROM media_access_logs WHERE accessed_at < p_cutoff LIMIT 5000
    );
    GET DIAGNOSTICS v_batch = ROW_COUNT;
    v_total := v_total + v_batch;
    EXIT WHEN v_batch < 5000;
  END LOOP;
  RETURN v_total;
END $$;

-- Index de purge sur media_access_logs (accessed_at).
CREATE INDEX idx_media_access_accessed
  ON media_access_logs (accessed_at);

REVOKE ALL ON FUNCTION retention_purge_logs(timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION retention_purge_logs(timestamptz) TO creche_app;
  END IF;
END $$;
