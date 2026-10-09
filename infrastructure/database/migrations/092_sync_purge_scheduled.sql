-- ============================================================================
-- 092_sync_purge_scheduled.sql
-- P2 (remédiation 2026-10-04, phase 3.5.1) — la fonction de purge
-- sync_retention_purge() (migration 075, SECURITY DEFINER) existait mais
-- n'était JAMAIS appelée : sync_changelog (1 ligne par écriture métier)
-- croît sans borne, et 075 a été livrée pour rien.
--
-- Le scheduler interne (056) pilote les jobs via scheduler_ticks, dont le
-- CHECK job_type IN (...) est FERMÉ : on ne peut pas y ajouter 'sync_purge'
-- sans migration. De plus scheduler_next_run() ne connaît pas ce type.
--
-- Correction (idempotente) :
--  1. étendre le CHECK de scheduler_ticks ;
--  2. enseigner scheduler_next_run() pour 'sync_purge' (quotidien, comme
--     retention_purge) ;
--  3. insérer le tick (enabled, prochaine exécution calculée) ;
--  4. étendre le INSERT ... unnest(ARRAY[...]) d'initialisation de 056 pour
--     les bases déjà créées (ON CONFLICT DO NOTHING).
-- Le worker appellera sync_retention_purge() via job-runtime (handler ajouté
-- côté TypeScript dans apps/worker/src/main.ts).
-- ============================================================================

-- 1. Étendre le CHECK (drop + recreate constraint).
ALTER TABLE scheduler_ticks DROP CONSTRAINT IF EXISTS scheduler_ticks_job_type_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduler_ticks_job_type_check'
      AND conrelid = 'scheduler_ticks'::regclass
  ) THEN
    ALTER TABLE scheduler_ticks
      ADD CONSTRAINT scheduler_ticks_job_type_check
      CHECK (job_type IN ('video_clips_purge','retention_purge','payments_expire',
                          'send_monthly_invoices','sync_purge'));
  END IF;
END $$;

-- 2. Apprendre la cadence 'sync_purge' : quotidien comme retention_purge.
CREATE OR REPLACE FUNCTION scheduler_next_run(p_type text, p_after timestamptz)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path=public,pg_temp
AS $$
DECLARE local_time timestamp := p_after AT TIME ZONE 'Africa/Algiers'; next_time timestamp;
BEGIN
  IF p_type='payments_expire' THEN
    next_time := date_trunc('hour',local_time) + INTERVAL '1 hour';
  ELSIF p_type IN ('video_clips_purge','retention_purge','sync_purge') THEN
    next_time := date_trunc('day',local_time) + INTERVAL '2 hours';
    IF next_time <= local_time THEN next_time := next_time + INTERVAL '1 day'; END IF;
  ELSIF p_type='send_monthly_invoices' THEN
    next_time := date_trunc('month',local_time) + INTERVAL '3 hours';
    IF next_time <= local_time THEN next_time := next_time + INTERVAL '1 month'; END IF;
  ELSE RAISE EXCEPTION 'SCHEDULE_TYPE_INVALID' USING ERRCODE='22023';
  END IF;
  RETURN next_time AT TIME ZONE 'Africa/Algiers';
END $$;

-- 3. Insérer le tick (idempotent). enabled=true : la purge est sûre (075 ne
--    supprime que ce qui est au-delà de la marge de curseur de toutes les
--    sync_operations de l'org — jamais d'événement encore non consommé).
INSERT INTO scheduler_ticks(job_type, enabled, next_run_at)
SELECT 'sync_purge', true, scheduler_next_run('sync_purge', clock_timestamp())
WHERE NOT EXISTS (SELECT 1 FROM scheduler_ticks WHERE job_type = 'sync_purge');
