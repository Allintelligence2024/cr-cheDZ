-- ============================================================================
-- 027_fix_jobs_claim_next_qualified.sql
-- Correction finale de jobs_claim_next() : toutes les références de colonnes
-- du corps sont qualifiées (background_jobs.*) pour lever l'ambiguïté avec
-- les colonnes OUT (id, attempts, max_attempts). CREATE OR REPLACE — les
-- migrations existantes ne sont jamais modifiées (ADR-007).
-- ============================================================================

CREATE OR REPLACE FUNCTION jobs_claim_next()
RETURNS TABLE (
  id uuid, job_type text, payload jsonb, organization_id uuid,
  attempts integer, max_attempts integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_job background_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM background_jobs
    WHERE background_jobs.status = 'pending'
      AND background_jobs.scheduled_at <= NOW()
      AND background_jobs.attempts < background_jobs.max_attempts
    ORDER BY background_jobs.priority DESC, background_jobs.scheduled_at
    LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE background_jobs
    SET status = 'processing',
        started_at = NOW(),
        background_jobs.attempts = background_jobs.attempts + 1
    WHERE background_jobs.id = v_job.id;
  RETURN QUERY SELECT v_job.id, v_job.job_type, v_job.payload,
    v_job.organization_id, v_job.attempts, v_job.max_attempts;
END $$;

REVOKE ALL ON FUNCTION jobs_claim_next() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION jobs_claim_next() TO creche_app;
  END IF;
END $$;
