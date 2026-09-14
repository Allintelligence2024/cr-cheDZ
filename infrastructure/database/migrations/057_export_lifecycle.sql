-- E6 : projection de l'état du job, timeout d'exécution et attente bornée.
-- Aucune modification de 038/053. Reprise explicite via support_retry_job.
ALTER TABLE report_exports ADD COLUMN last_requested_at timestamptz;
UPDATE report_exports SET last_requested_at=created_at;
ALTER TABLE report_exports ALTER COLUMN last_requested_at SET DEFAULT clock_timestamp();
ALTER TABLE report_exports ALTER COLUMN last_requested_at SET NOT NULL;
CREATE INDEX idx_exports_pending_age ON report_exports(last_requested_at) WHERE status='pending';

CREATE FUNCTION export_job_project_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
BEGIN
  IF NEW.job_type <> 'export_report' THEN RETURN NEW; END IF;
  IF NEW.status='failed' THEN
    UPDATE report_exports SET status='failed', failure_reason=COALESCE(NEW.failure_reason,'EXPORT_JOB_FAILED'),
      completed_at=COALESCE(NEW.failed_at,clock_timestamp())
      WHERE id::text=NEW.payload->>'export_id' AND organization_id=NEW.organization_id AND status='pending';
  ELSIF NEW.status='pending' AND OLD.status='failed' AND NEW.attempts=0 THEN
    UPDATE report_exports SET status='pending',failure_reason=NULL,completed_at=NULL,last_requested_at=clock_timestamp()
      WHERE id::text=NEW.payload->>'export_id' AND organization_id=NEW.organization_id AND status='failed';
  ELSIF NEW.status='pending' AND NEW.failure_reason IS NOT NULL THEN
    UPDATE report_exports SET failure_reason=NEW.failure_reason
      WHERE id::text=NEW.payload->>'export_id' AND organization_id=NEW.organization_id AND status='pending';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER export_job_project_status AFTER UPDATE OF status ON background_jobs
  FOR EACH ROW EXECUTE FUNCTION export_job_project_status();

-- Fin terminale d'une exécution trop longue. Le worker s'arrête ensuite pour
-- ne pas laisser le handler continuer après le rejet de Promise.race.
CREATE FUNCTION exports_fail_job(p_id uuid,p_lease_token uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
BEGIN
  UPDATE background_jobs SET status='failed', failed_at=clock_timestamp(),
    failure_reason='EXPORT_TIMEOUT',lease_token=NULL,heartbeat_at=NULL
    WHERE id=p_id AND lease_token=p_lease_token AND status='processing' AND job_type='export_report';
  RETURN FOUND;
END $$;

-- Cas d'attente excessive (worker absent auparavant, ancien export sans job,
-- job abandonné). Sans worker vivant, le contrôle API list exécute aussi ce
-- rattrapage, scopé au tenant via sa fonction dédiée plus bas.
CREATE FUNCTION exports_fail_stale(p_max_age interval,p_organization_id uuid DEFAULT NULL) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE e report_exports%ROWTYPE; n integer := 0;
BEGIN
  IF p_max_age IS NULL OR p_max_age <= INTERVAL '0 seconds' THEN
    RAISE EXCEPTION 'EXPORT_MAX_AGE_INVALID' USING ERRCODE='22023';
  END IF;
  -- Verrouiller les jobs AVANT la projection exports (même ordre que finish).
  -- Aucun verrou d'export pris pendant l'UPDATE des jobs : pas d'inversion.
  WITH stale AS (
    SELECT b.id FROM background_jobs b
    WHERE b.job_type='export_report' AND b.status IN ('pending','processing') AND EXISTS (
      SELECT 1 FROM report_exports r WHERE r.id::text=b.payload->>'export_id'
        AND r.organization_id=b.organization_id AND r.status='pending'
        AND (p_organization_id IS NULL OR r.organization_id=p_organization_id)
        AND r.last_requested_at < clock_timestamp()-p_max_age
    ) ORDER BY b.id LIMIT 500 FOR UPDATE OF b SKIP LOCKED
  )
  UPDATE background_jobs b SET status='failed',failed_at=clock_timestamp(),
    failure_reason='EXPORT_QUEUE_TIMEOUT',lease_token=NULL,heartbeat_at=NULL
    FROM stale WHERE b.id=stale.id;
  GET DIAGNOSTICS n=ROW_COUNT;
  -- Exports anciens sans job : rattrapage par batches bornés.
  FOR e IN SELECT * FROM report_exports r WHERE r.status='pending'
    AND (p_organization_id IS NULL OR r.organization_id=p_organization_id)
    AND r.last_requested_at < clock_timestamp()-p_max_age
    AND NOT EXISTS(SELECT 1 FROM background_jobs b WHERE b.job_type='export_report'
      AND b.organization_id=r.organization_id AND b.payload->>'export_id'=r.id::text AND b.status IN ('pending','processing'))
    LIMIT 500 FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE report_exports SET status='failed',failure_reason='EXPORT_QUEUE_TIMEOUT',completed_at=clock_timestamp() WHERE id=e.id;
    n:=n+1;
  END LOOP;
  RETURN n;
END $$;

-- L'API fournit son contexte tenant, pas un UUID contrôlé par le client HTTP.
-- Pas d'accès global via cette fonction ; app_tenant_id NULL = aucune action.
CREATE FUNCTION exports_reconcile_tenant() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE tenant uuid := app_tenant_id();
BEGIN
  IF tenant IS NULL THEN RETURN 0; END IF;
  RETURN exports_fail_stale(INTERVAL '30 minutes',tenant);
END $$;
REVOKE ALL ON FUNCTION export_job_project_status(),exports_fail_job(uuid,uuid),exports_fail_stale(interval,uuid),exports_reconcile_tenant() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='creche_app') THEN
    GRANT EXECUTE ON FUNCTION exports_fail_job(uuid,uuid),exports_fail_stale(interval,uuid),exports_reconcile_tenant() TO creche_app;
  END IF;
END $$;

-- Rattraper les échecs terminaux antérieurs à cette migration sans attendre
-- une nouvelle transition du job. Ne pas écraser un export déjà terminé.
UPDATE report_exports r SET status='failed',failure_reason=COALESCE(b.failure_reason,'EXPORT_JOB_FAILED'),
  completed_at=COALESCE(b.failed_at,clock_timestamp())
FROM background_jobs b WHERE b.job_type='export_report' AND b.status='failed'
  AND b.organization_id=r.organization_id AND b.payload->>'export_id'=r.id::text AND r.status='pending'
  AND NOT EXISTS(SELECT 1 FROM background_jobs active WHERE active.job_type='export_report'
    AND active.organization_id=r.organization_id AND active.payload->>'export_id'=r.id::text
    AND active.status IN ('pending','processing'));
