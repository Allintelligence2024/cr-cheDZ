-- ============================================================================
-- 102_notif_queue_finish_reason.sql
-- P0 (batterie d'isolation 2026-10-11, phase 28 E3) — régression 080 :
-- le CREATE OR REPLACE de notif_queue_finish (fencing p_claimed_at) a
-- réécrit la branche SUCCÈS en « failure_reason = NULL » figé, ignorant
-- p_failure_reason. Conséquence réelle : le worker pousse
-- 'PUSH_NOT_CONFIGURED_OR_NO_DEVICE' (décision E3 : « sent » = file
-- traitée, pas livraison — le motif de non-envoi EST le contrat), mais la
-- base l'écrase à NULL. Le motif disparaît : impossible de distinguer
-- « push délivré » de « aucun appareil / pas de fournisseur ».
--
-- 054 posait déjà `failure_reason = p_failure_reason` dans les deux
-- branches ; 080 l'a perdue en ajoutant le fencing. Restaurée ici —
-- le fencing (080) et le cast texte du claim (101) sont conservés.
-- Pattern DROP+CREATE inutile : signature inchangée
-- (uuid, boolean, text, timestamptz).
-- ============================================================================

CREATE OR REPLACE FUNCTION notif_queue_finish(
  p_id uuid,
  p_success boolean,
  p_failure_reason text DEFAULT NULL,
  p_claimed_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  -- P0 fencing : n'agir que sur la ligne 'processing' du bail fourni.
  -- Sans p_claimed_at (appelants non migrés), on reste sur l'ancien
  -- comportement (rétro-compatible).
  IF p_success THEN
    UPDATE notification_queue SET status = 'sent', sent_at = NOW(),
      failure_reason = p_failure_reason
      WHERE id = p_id
        AND status = 'processing'
        AND (p_claimed_at IS NULL OR claimed_at = p_claimed_at);
  ELSE
    UPDATE notification_queue
      SET status = CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
          failed_at = NOW(),
          failure_reason = p_failure_reason,
          scheduled_at = NOW() + (INTERVAL '1 minute' * POWER(2, attempts))
      WHERE id = p_id
        AND status = 'processing'
        AND (p_claimed_at IS NULL OR claimed_at = p_claimed_at);
  END IF;
END $$;

REVOKE ALL ON FUNCTION notif_queue_finish(uuid, boolean, text, timestamptz) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION notif_queue_finish(uuid, boolean, text, timestamptz) TO creche_app;
  END IF;
END $$;
