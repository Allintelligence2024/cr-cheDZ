-- ============================================================================
-- 080_notif_queue_fence.sql
-- P0 (remédiation 2026-10-03, phase 1.4) — double envoi de notifications.
--
-- notif_queue_finish (migration 042) faisait :
--     UPDATE notification_queue SET status='sent' ... WHERE id = p_id
-- sans aucune vérification d'état ni de jeton de bail.
--
-- Conséquence : si notif_queue_reclaim (migration 065) rejouait une ligne
-- 'processing' orpheline (batch > 300 s, crash, deux workers), l'ancien
-- worker ET le nouveau terminaient tous les deux la MÊME ligne → la
-- notification était envoyée DEUX FOIS et le statut écrasé.
--
-- Correction : la terminaison n'agit que sur une ligne 'processing'
-- appartenant au bail courant (claimed_at). C'est le pattern classique de
-- fencing : la fonction est SECURITY DEFINER, elle seule peut garantir
-- l'atomicité du claim→finish.
--
-- claimed_at est posé par le claim (migration 065) : on compare au bail le
-- plus ancien non encore terminé. Comme le claim est atomique
-- (FOR UPDATE SKIP LOCKED) et que claimed_at change à chaque claim, un
-- worker lent termine en no-op au lieu d'écraser l'état du nouveau claim.
-- ============================================================================

-- PostgreSQL : CREATE OR REPLACE avec un paramètre SUPPLÉMENTAIRE crée une
-- SURCHARGE (deux signatures coexistent). L'ancienne (uuid, boolean, text)
-- reste exécutable avec ses grants — et ses REVOKE/GRANT ci-dessous ne
-- touchent que la nouvelle. On DROP l'ancienne signature d'abord.
DROP FUNCTION IF EXISTS notif_queue_finish(uuid, boolean, text);

CREATE OR REPLACE FUNCTION notif_queue_finish(
  p_id uuid,
  p_success boolean,
  p_failure_reason text DEFAULT NULL,
  p_claimed_at timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- P0 fencing : n'agir que sur la ligne 'processing' du bail fourni.
  -- Sans p_claimed_at (appelants non migrés), on reste sur l'ancien
  -- comportement (rétro-compatible) — le worker passera le bail dès la
  -- phase 1.4, mais la base ne doit pas casser les appels existants.
  IF p_success THEN
    UPDATE notification_queue SET status = 'sent', sent_at = NOW(), failure_reason = NULL
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
