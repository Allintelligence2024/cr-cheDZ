-- ============================================================================
-- 094_scheduler_enqueue_advisory_lock.sql
-- 3.6.1 (remédiation 2026-10-05) — probe anti-doublon non verrouillé.
--
-- Constat : scheduler_enqueue_due() (056) verrouille bien la LIGNE du tick
-- (FOR UPDATE SKIP LOCKED), mais la sonde anti-doublon
-- (`IF NOT EXISTS (SELECT 1 FROM background_jobs ... status IN ('pending','processing'))`)
-- est une LECTURE non verrouillée. Deux workers appelant la fonction
-- concurrently voient tous les deux « aucun job actif » et insèrent
-- chacun leur job → deux jobs identiques pour le même job_type.
--
-- Correction : un verrou advisory transactionnel sur le job_type (clé
-- déterministe = hashtext du job_type) AVANT la sonde. Le premier appelant
-- verrouille, évalue et insère atomiquement ; le second attend la fin de la
-- transaction du premier (la sonde voit alors le job 'pending') et n'insère
-- rien. Pas de table, pas de configuration : pg_advisory_xact_lock est
-- libéré au COMMIT/ROLLBACK.
--
-- Clé 48274 (espace disjoint de 060 qui utilise 48273).
-- ============================================================================

CREATE OR REPLACE FUNCTION scheduler_enqueue_due() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE tick scheduler_ticks%ROWTYPE; v_job uuid; v_count integer := 0;
        v_now timestamptz := clock_timestamp();
BEGIN
  FOR tick IN SELECT * FROM scheduler_ticks
    WHERE enabled AND next_run_at <= v_now
    ORDER BY next_run_at, job_type FOR UPDATE SKIP LOCKED
  LOOP
    -- 3.6.1 : verrou advisory transactionnel AVANT la sonde anti-doublon.
    -- Sans lui, deux workers concurrents passent tous les deux la sonde
    -- (lectures non verrouillées) et insèrent chacun un job. Le verrou est
    -- sur le job_type, pas sur la ligne — le second appelant attend le
    -- COMMIT du premier et voit alors le job 'pending'.
    PERFORM pg_advisory_xact_lock(48274, hashtext(tick.job_type));

    -- Coalescer le retard, sans tempête de rattrapage ni deuxième job actif.
    IF NOT EXISTS (SELECT 1 FROM background_jobs b WHERE b.job_type = tick.job_type
      AND b.payload->>'scheduler' = 'true' AND b.status IN ('pending','processing')) THEN
      INSERT INTO background_jobs(organization_id, job_type, payload, priority)
        VALUES(NULL, tick.job_type, jsonb_build_object('scheduler', true, 'scheduled_for', tick.next_run_at), 1)
        RETURNING id INTO v_job;
      UPDATE scheduler_ticks SET last_enqueued_at = v_now, last_job_id = v_job WHERE job_type = tick.job_type;
      v_count := v_count + 1;
    END IF;
    UPDATE scheduler_ticks SET next_run_at = scheduler_next_run(tick.job_type, v_now) WHERE job_type = tick.job_type;
  END LOOP;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION scheduler_enqueue_due() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION scheduler_enqueue_due() TO creche_app;
  END IF;
END $$;

COMMENT ON FUNCTION scheduler_enqueue_due() IS
  '3.6.1 — verrou advisory transactionnel (48274, hashtext(job_type)) avant la sonde anti-doublon : deux workers concurrents ne peuvent plus insérer deux jobs identiques pour le même job_type. Le verrou est libéré au COMMIT.';
