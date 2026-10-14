-- ============================================================================
-- 090_device_session_validate.sql
-- P2 (remédiation 2026-10-04, phase 3.3.1) — `device_id` envoyé à la création
-- de session (login, refresh, acceptation d'invitation) n'était JAMAIS
-- validé : un attaquant (ou un client buggy) pouvait lier sa session à un
-- device arbitraire, étranger, inexistant ou révoqué.
--
-- Conséquences concrètes :
--  - falsification d'attribution : la session apparaît comme émise depuis le
--    device d'une autre personne (audit + fichiers journaux trompeurs) ;
--  - contournement de la révocation : revokeByDevice() marque les sessions
--    device_revoked, mais un device_id bidon pointe vers rien de révoqué ;
--  - surfaces de surveillance (device_revoked dans auth_refresh_lookup)
--    silencieusement inopérantes.
--
-- Correction : fonction SECURITY DEFINER (lecture seule) qui valide qu'un
-- device_id donné appartient bien à l'utilisateur ET est actif/non révoqué.
-- Retourne un record : exists / active / owner_ok. Utilisée au login,
-- refresh et acceptation d'invitation (guard en échec fermé : un device_id
-- invalide est ignoré, la session reste créée SANS device — jamais rejetée,
-- pour ne pas casser le flux des clients qui n'envoient pas de device_id).
-- ============================================================================

CREATE OR REPLACE FUNCTION auth_device_validate(
  p_device_id uuid,
  p_user_id uuid
)
RETURNS TABLE(is_valid boolean, reason text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  -- LEFT JOIN sur une source constante : RETURNS TABLE renvoie TOUJOURS
  -- exactement une ligne, même si le device n'existe pas (is_valid=false,
  -- reason='not_found'). Sans cela, un SELECT simple renvoie 0 ligne et
  -- l'appelant doit gérer deux cas distincts (absence vs. invalide).
  SELECT
    d.id IS NOT NULL
      AND d.registered_by = p_user_id
      AND d.is_active
      AND d.revoked_at IS NULL,
    CASE
      WHEN d.id IS NULL THEN 'not_found'
      WHEN d.registered_by <> p_user_id THEN 'not_owner'
      WHEN NOT d.is_active THEN 'inactive'
      WHEN d.revoked_at IS NOT NULL THEN 'revoked'
      ELSE 'ok'
    END
  FROM (SELECT 1) AS one
  LEFT JOIN devices d ON d.id = p_device_id
$$;

REVOKE ALL ON FUNCTION auth_device_validate(uuid, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION auth_device_validate(uuid, uuid) TO creche_app;
  END IF;
END $$;
