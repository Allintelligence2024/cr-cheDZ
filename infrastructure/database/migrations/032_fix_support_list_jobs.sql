-- ============================================================================
-- 032_fix_support_list_jobs.sql
-- Correction de support_list_jobs() (migration 029) : background_jobs.status
-- est un enum job_status, la colonne OUT est text → « structure of query does
-- not match function result type ». CREATE OR REPLACE (migrations immuables).
-- ============================================================================

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
    SELECT bj.id, bj.job_type, bj.status::text, bj.organization_id,
           bj.attempts, bj.max_attempts, bj.failure_reason,
           bj.created_at, bj.scheduled_at
    FROM background_jobs bj
    ORDER BY bj.created_at DESC
    LIMIT GREATEST(1, LEAST(p_limit, 500));
END $$;

REVOKE ALL ON FUNCTION support_list_jobs(integer) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION support_list_jobs(integer) TO creche_app;
  END IF;
END $$;
