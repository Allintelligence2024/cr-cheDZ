-- ============================================================================
-- 048_fix_jobs_finish_cast.sql
-- BUG RÉEL découvert par phase21 (vidéosurveillance) : jobs_finish(..., false,
-- reason) n'a JAMAIS fonctionné — le CASE 'failed'/'pending' produit le type
-- text alors que background_jobs.status est l'enum job_status (« column
-- "status" is of type job_status but expression is of type text »). Aucun
-- test N'avait exercé l'échec d'un background_job avant phase21 (les succès
-- passent par l'autre branche) : le retry exponentiel + le marquage 'failed'
-- d'un job en échec étaient donc cassés depuis la migration 024.
-- Correction : cast explicite ::job_status. CREATE OR REPLACE — les
-- migrations existantes restent immuables (ADR-007).
-- ============================================================================

CREATE OR REPLACE FUNCTION jobs_finish(
  p_id uuid, p_success boolean, p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF p_success THEN
    UPDATE background_jobs SET status = 'done', completed_at = NOW(),
      failure_reason = NULL WHERE id = p_id;
  ELSE
    UPDATE background_jobs
      SET status = (CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END)::job_status,
          failed_at = CASE WHEN attempts >= max_attempts THEN NOW() END,
          failure_reason = p_failure_reason,
          scheduled_at = NOW() + (INTERVAL '1 minute' * POWER(2, attempts))
      WHERE id = p_id;
  END IF;
END $$;

REVOKE ALL ON FUNCTION jobs_finish(uuid, boolean, text) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION jobs_finish(uuid, boolean, text) TO creche_app;
  END IF;
END $$;
