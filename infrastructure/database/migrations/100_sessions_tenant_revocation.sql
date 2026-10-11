-- ============================================================================
-- 100_sessions_tenant_revocation.sql
-- ----------------------------------------------------------------------------
-- Suite de la migration 088 (remédiation RLS) : `sessions` est désormais une
-- table TENANT (ENABLE + FORCE ROW LEVEL SECURITY, politique sessions_tenant
-- sur organization_id). Trois gardiens et trois chemins d'écriture n'avaient
-- pas suivi — chacun est un défaut RÉEL reproduit sous rôle applicatif
-- (creche_app, NOBYPASSRLS) :
--
--   1. scripts/check-rls-usage.mjs et scripts/check-tenant-index.mjs
--      continuaient de traiter `sessions` comme une « table système sans RLS »
--      (listes figées) — la garde anti-bypass échouait explicitement
--      (« table système figée [...] a désormais la RLS ACTIVE »).
--      → `sessions` sort des listes d'exemption ; l'index de tête
--        organization_id exigé par check-tenant-index est créé ici.
--
--   2. apps/api SessionsService.revokeByRefreshHash (logout) et
--      auth.service refresh (rotation) écrivaient sur `sessions` via la POOL
--      DIRECTE, sans GUC app.tenant_id. Sous RLS, `USING (organization_id =
--      app_tenant_id())` vaut NULL → l'UPDATE ne voit AUCUNE ligne : le
--      logout ne révoquait rien, la rotation laissait l'ancien refresh
--      valable, la détection de réutilisation ne se déclenchait jamais. Le
--      bug est invisible en développement (les tests tournaient en superuser,
--      qui contourne la RLS) et n'apparaît qu'avec les rôles de production.
--
--   3. Ces écritures doivent rester auditées : elles passent donc soit par un
--      GUC posé explicitement (refresh, déjà dans une transaction), soit par
--      des fonctions SECURITY DEFINER (compteur partagé mot de passe/PIN,
--      style bootstrap 015/024) quand l'appelant ne connaît pas le tenant.
--
-- Objets livrés :
--   • idx_sessions_org : index de tête organization_id (check-tenant-index) ;
--   • sessions_revoke_all_for_user / sessions_revoke_by_device : révocations
--     comptables (SECURITY DEFINER, portée explicite par les paramètres).
-- ============================================================================

-- 1. Index de tête tenant (sessions est une table tenant depuis 088).
CREATE INDEX IF NOT EXISTS idx_sessions_org ON sessions (organization_id);

-- 2. Révocation de TOUTES les sessions d'un compte — sémantique COMPTE, pas
-- tenant : changement de mot de passe et réutilisation de refresh token
-- détectée doivent fermer toutes les sessions de l'utilisateur, y compris
-- celles d'une autre organisation (directeur multi-org). SECURITY DEFINER
-- (propriétaire creche_migrator, BYPASSRLS) : la RLS tenant ne s'applique pas,
-- la portée est portée par le paramètre user_id, résolu par les appelants
-- après preuve d'authentification.
CREATE OR REPLACE FUNCTION sessions_revoke_all_for_user(
  p_user_id uuid,
  p_reason text
) RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH revoked AS (
    UPDATE sessions
       SET revoked_at = NOW(), revoked_reason = p_reason
     WHERE user_id = p_user_id AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM revoked;
$$;

COMMENT ON FUNCTION sessions_revoke_all_for_user(uuid, text) IS
  'Révoque toutes les sessions non révoquées d''un compte (mot de passe changé, réutilisation de refresh). Portée COMPTE assumée — équivalent SQL de SessionsService.revokeAllForUser sur la pool, correct sous RLS (migration 088).';

REVOKE ALL ON FUNCTION sessions_revoke_all_for_user(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sessions_revoke_all_for_user(uuid, text) TO creche_app;

-- 3. Révocation des sessions d'un appareil — portée (device, organization)
-- explicite : l'appelant (révocation distante d'un device) connaît le tenant,
-- la fonction préserve ce filtre qui disparaissait sous RLS.
CREATE OR REPLACE FUNCTION sessions_revoke_by_device(
  p_device_id uuid,
  p_organization_id uuid,
  p_reason text
) RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH revoked AS (
    UPDATE sessions
       SET revoked_at = NOW(), revoked_reason = p_reason
     WHERE device_id = p_device_id
       AND organization_id = p_organization_id
       AND revoked_at IS NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM revoked;
$$;

COMMENT ON FUNCTION sessions_revoke_by_device(uuid, uuid, text) IS
  'Révoque les sessions non révoquées d''un appareil dans UNE organisation (filtre conservé depuis SessionsService.revokeByDevice).';

REVOKE ALL ON FUNCTION sessions_revoke_by_device(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sessions_revoke_by_device(uuid, uuid, text) TO creche_app;
