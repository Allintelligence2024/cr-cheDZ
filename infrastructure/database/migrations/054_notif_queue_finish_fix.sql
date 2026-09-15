-- E3, décision client : contrat de statut conservé ; sent = queue traitée,
-- PAS preuve de livraison push. Un motif de non-envoi ne doit pas être effacé.
CREATE OR REPLACE FUNCTION notif_queue_finish(
  p_id uuid, p_success boolean, p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_success THEN
    UPDATE notification_queue SET status='sent', sent_at=clock_timestamp(),
      failed_at=NULL, failure_reason=p_failure_reason WHERE id=p_id;
  ELSE
    UPDATE notification_queue
      SET status=CASE WHEN attempts >= 3 THEN 'failed' ELSE 'pending' END,
          failed_at=clock_timestamp(), failure_reason=p_failure_reason,
          scheduled_at=clock_timestamp() + INTERVAL '1 minute' * POWER(2,attempts)
      WHERE id=p_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION notif_queue_finish(uuid,boolean,text) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='creche_app') THEN
    GRANT EXECUTE ON FUNCTION notif_queue_finish(uuid,boolean,text) TO creche_app;
  END IF;
END $$;
