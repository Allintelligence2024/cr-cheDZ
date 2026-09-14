-- E1 : bail par tentative, heartbeat et reprise des workers morts.
-- Déploiement : arrêter TOUS les anciens workers avant migration (pas de mélange
-- d'anciens claims sans bail avec les nouveaux). Voir PHASE_E_WORKER_RUNBOOK.md.
ALTER TABLE background_jobs ADD COLUMN lease_token uuid;
ALTER TABLE background_jobs ADD COLUMN heartbeat_at timestamptz;
CREATE INDEX idx_jobs_processing_heartbeat
  ON background_jobs ((COALESCE(heartbeat_at, started_at, created_at)))
  WHERE status = 'processing';

-- Réutilise le claim atomique/SKIP LOCKED historique dans la même transaction.
-- La forme de jobs_claim_next() est conservée pour les consommateurs historiques.
CREATE FUNCTION jobs_claim_leased()
RETURNS TABLE (
  id uuid, job_type text, payload jsonb, organization_id uuid,
  attempts integer, max_attempts integer, lease_token uuid
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_job background_jobs%ROWTYPE;
BEGIN
  SELECT c.id INTO v_id FROM jobs_claim_next() c;
  IF v_id IS NULL THEN RETURN; END IF;
  UPDATE background_jobs b
    SET lease_token = gen_random_uuid(), heartbeat_at = clock_timestamp(),
        completed_at = NULL, failed_at = NULL
    WHERE b.id = v_id RETURNING b.* INTO v_job;
  RETURN QUERY SELECT v_job.id, v_job.job_type, v_job.payload,
    v_job.organization_id, v_job.attempts, v_job.max_attempts, v_job.lease_token;
END $$;

CREATE FUNCTION jobs_heartbeat(p_id uuid, p_lease_token uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE background_jobs SET heartbeat_at = clock_timestamp()
    WHERE id = p_id AND status = 'processing' AND lease_token = p_lease_token;
  RETURN FOUND;
END $$;

-- Le jeton protège aussi contre une remise à zéro de attempts par le support.
-- Une terminaison ancienne ne peut ni terminer, ni faire échouer le nouveau bail.
CREATE FUNCTION jobs_finish_leased(
  p_id uuid, p_lease_token uuid, p_success boolean, p_failure_reason text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE background_jobs
    SET status = (CASE WHEN p_success THEN 'done'
                      WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END)::job_status,
        completed_at = CASE WHEN p_success THEN clock_timestamp() END,
        failed_at = CASE WHEN NOT p_success AND attempts >= max_attempts THEN clock_timestamp() END,
        failure_reason = CASE WHEN p_success THEN NULL ELSE left(p_failure_reason, 500) END,
        scheduled_at = CASE WHEN p_success THEN scheduled_at
                           ELSE clock_timestamp() + INTERVAL '1 minute' * POWER(2, attempts) END,
        lease_token = NULL, heartbeat_at = NULL
    WHERE id = p_id AND status = 'processing' AND lease_token = p_lease_token;
  RETURN FOUND;
END $$;

CREATE FUNCTION jobs_reap_stale(p_timeout interval)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  IF p_timeout IS NULL OR p_timeout <= INTERVAL '0 seconds' THEN
    RAISE EXCEPTION 'JOB_TIMEOUT_INVALID' USING ERRCODE = '22023';
  END IF;
  -- Batch borné. Plusieurs reapers se partagent les lignes via SKIP LOCKED.
  -- started_at/created_at permettent également de reprendre les anciens jobs
  -- sans heartbeat, jamais les jobs actifs dont le heartbeat est récent.
  WITH stale AS (
    SELECT b.id FROM background_jobs b
      WHERE b.status = 'processing'
        AND COALESCE(b.heartbeat_at, b.started_at, b.created_at) < clock_timestamp() - p_timeout
      ORDER BY COALESCE(b.heartbeat_at, b.started_at, b.created_at), b.id
      LIMIT 500 FOR UPDATE SKIP LOCKED
  )
  UPDATE background_jobs b
    SET status = (CASE WHEN b.attempts >= b.max_attempts THEN 'failed' ELSE 'pending' END)::job_status,
        failed_at = CASE WHEN b.attempts >= b.max_attempts THEN clock_timestamp() END,
        failure_reason = 'WORKER_LEASE_EXPIRED', scheduled_at = clock_timestamp(),
        started_at = NULL, completed_at = NULL, heartbeat_at = NULL, lease_token = NULL
    FROM stale WHERE b.id = stale.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- L'ancienne API de terminaison ne doit pas contourner le fencing des baux.
-- Elle ne touche que des claims historiques processing SANS jeton.
CREATE OR REPLACE FUNCTION jobs_finish(
  p_id uuid, p_success boolean, p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE background_jobs
    SET status = (CASE WHEN p_success THEN 'done'
                      WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END)::job_status,
        completed_at = CASE WHEN p_success THEN clock_timestamp() END,
        failed_at = CASE WHEN NOT p_success AND attempts >= max_attempts THEN clock_timestamp() END,
        failure_reason = CASE WHEN p_success THEN NULL ELSE p_failure_reason END,
        scheduled_at = CASE WHEN p_success THEN scheduled_at
                           ELSE clock_timestamp() + INTERVAL '1 minute' * POWER(2, attempts) END
    WHERE id = p_id AND status = 'processing' AND lease_token IS NULL;
END $$;

REVOKE ALL ON FUNCTION jobs_claim_leased() FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs_heartbeat(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs_finish_leased(uuid, uuid, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs_reap_stale(interval) FROM PUBLIC;
REVOKE ALL ON FUNCTION jobs_finish(uuid, boolean, text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION jobs_claim_leased(), jobs_heartbeat(uuid, uuid),
      jobs_finish_leased(uuid, uuid, boolean, text), jobs_reap_stale(interval),
      jobs_finish(uuid, boolean, text) TO creche_app;
  END IF;
END $$;
