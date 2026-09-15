-- E2 : scheduler interne coordonné en base. 055 reste réservé à G2.
-- Décision client : 3 traitements automatiques ; facturation DÉSACTIVÉE.
CREATE TABLE scheduler_ticks (
  job_type text PRIMARY KEY CHECK(job_type IN ('video_clips_purge','retention_purge','payments_expire','send_monthly_invoices')),
  enabled boolean NOT NULL,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_enqueued_at timestamptz,
  last_success_at timestamptz,
  -- Référence d'observation non FK : les jobs peuvent être archivés/supprimés.
  last_job_id uuid,
  CHECK(job_type <> 'send_monthly_invoices' OR NOT enabled)
);
ALTER TABLE scheduler_ticks ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_ticks FORCE ROW LEVEL SECURITY;
-- Grants D peuvent être rejoués sans ouvrir l'écriture de configuration à l'app.
CREATE POLICY scheduler_internal_only ON scheduler_ticks FOR SELECT USING (false);

CREATE FUNCTION scheduler_next_run(p_type text, p_after timestamptz)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp
AS $$
DECLARE local_time timestamp := p_after AT TIME ZONE 'Africa/Algiers'; next_time timestamp;
BEGIN
  IF p_type='payments_expire' THEN
    next_time := date_trunc('hour',local_time) + INTERVAL '1 hour';
  ELSIF p_type IN ('video_clips_purge','retention_purge') THEN
    next_time := date_trunc('day',local_time) + INTERVAL '2 hours';
    IF next_time <= local_time THEN next_time := next_time + INTERVAL '1 day'; END IF;
  ELSIF p_type='send_monthly_invoices' THEN
    next_time := date_trunc('month',local_time) + INTERVAL '3 hours';
    IF next_time <= local_time THEN next_time := next_time + INTERVAL '1 month'; END IF;
  ELSE RAISE EXCEPTION 'SCHEDULE_TYPE_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN next_time AT TIME ZONE 'Africa/Algiers';
END $$;

INSERT INTO scheduler_ticks(job_type,enabled,next_run_at)
  SELECT t, t <> 'send_monthly_invoices', scheduler_next_run(t,clock_timestamp())
  FROM unnest(ARRAY['video_clips_purge','retention_purge','payments_expire','send_monthly_invoices']) t;

CREATE FUNCTION scheduler_enqueue_due() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
DECLARE tick scheduler_ticks%ROWTYPE; v_job uuid; v_count integer := 0;
        v_now timestamptz := clock_timestamp();
BEGIN
  FOR tick IN SELECT * FROM scheduler_ticks
    WHERE enabled AND next_run_at <= v_now
    ORDER BY next_run_at,job_type FOR UPDATE SKIP LOCKED
  LOOP
    -- Coalescer le retard, sans tempête de rattrapage ni deuxième job actif.
    IF NOT EXISTS (SELECT 1 FROM background_jobs b WHERE b.job_type=tick.job_type
      AND b.payload->>'scheduler'='true' AND b.status IN ('pending','processing')) THEN
      INSERT INTO background_jobs(organization_id,job_type,payload,priority)
        VALUES(NULL,tick.job_type,jsonb_build_object('scheduler',true,'scheduled_for',tick.next_run_at),1)
        RETURNING id INTO v_job;
      UPDATE scheduler_ticks SET last_enqueued_at=v_now,last_job_id=v_job WHERE job_type=tick.job_type;
      v_count := v_count+1;
    END IF;
    UPDATE scheduler_ticks SET next_run_at=scheduler_next_run(tick.job_type,v_now) WHERE job_type=tick.job_type;
  END LOOP;
  RETURN v_count;
END $$;

CREATE FUNCTION scheduler_record_success() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp
AS $$
BEGIN
  IF NEW.status='done' AND OLD.status IS DISTINCT FROM NEW.status AND NEW.payload->>'scheduler'='true' THEN
    UPDATE scheduler_ticks SET last_success_at=clock_timestamp() WHERE job_type=NEW.job_type;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER scheduler_record_success AFTER UPDATE OF status ON background_jobs
  FOR EACH ROW EXECUTE FUNCTION scheduler_record_success();

-- Interrogeable par un moniteur EXTERNE, même si tous les workers sont arrêtés.
-- Aucune PII, uniquement les 3 types fixes et des timestamps/états.
CREATE FUNCTION scheduler_health()
RETURNS TABLE(job_type text,overdue boolean,last_success_at timestamptz,next_run_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp
AS $$
  SELECT t.job_type,
    clock_timestamp() > COALESCE(t.last_success_at,t.created_at) +
      CASE WHEN t.job_type='payments_expire' THEN INTERVAL '2 hours' ELSE INTERVAL '2 days' END,
    t.last_success_at,t.next_run_at
  FROM scheduler_ticks t WHERE t.enabled ORDER BY t.job_type
$$;
REVOKE ALL ON FUNCTION scheduler_next_run(text,timestamptz),scheduler_enqueue_due(),scheduler_record_success(),scheduler_health() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='creche_app') THEN
    GRANT EXECUTE ON FUNCTION scheduler_enqueue_due(),scheduler_health() TO creche_app;
  END IF;
END $$;
