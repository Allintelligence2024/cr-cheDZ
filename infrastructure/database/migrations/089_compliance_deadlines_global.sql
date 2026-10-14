-- ============================================================================
-- 089_compliance_deadlines_global.sql
-- P2 (remédiation 2026-10-04, phase 3.1.3) — le job worker
-- `compliance_deadlines` (phase 2.3) lit privacy_violations / privacy_requests
-- / privacy_dpias via pool.query BRUT pour détecter les échéances dépassées
-- de TOUTES les organisations.
--
-- Problème : ces 3 tables ont ENABLE + FORCE ROW LEVEL SECURITY (migration
-- 029) et le worker ne pose JAMAIS app.tenant_id sur ces lectures (par
-- construction : il doit voir toutes les orgs). Sous NOBYPASSRLS, un SELECT
-- pool.query renvoie donc 0 ligne → le job semble sain mais ne signale
-- JAMAIS aucune échéance. Loi 25-11 silencieusement inappliquée.
--
-- Correction : une fonction SECURITY DEFINER (exécutée comme le propriétaire,
-- donc au-dessus de la RLS) retourne les échéances globales. Elle est en
-- LECTURE SEULE et ne retourne QUE (id, organization_id, deadline) — le
-- worker réinjecte chaque enregistrement sous withTenant() pour l'INSERT de
-- notification (déjà fait côté TS), donc aucune écriture inter-tenant.
--
-- Types de retour unifiés : la colonne date est nommée `deadline` pour les
-- 3 sources (notification_deadline / deadline / review_date).
-- ============================================================================

CREATE OR REPLACE FUNCTION compliance_deadlines_overdue()
RETURNS TABLE(source text, record_id uuid, organization_id uuid, deadline timestamptz)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  -- Violations : notification ANPDP non envoyée et délai de 5 jours dépassé.
  SELECT 'violation'::text, v.id, v.organization_id, v.notification_deadline
  FROM privacy_violations v
  WHERE v.anpdp_notified_at IS NULL
    AND v.notification_deadline IS NOT NULL
    AND v.notification_deadline < NOW()

  UNION ALL

  -- Demandes de droits : non résolues et délai de 30 jours dépassé.
  SELECT 'request'::text, r.id, r.organization_id, r.deadline
  FROM privacy_requests r
  WHERE r.resolved_at IS NULL
    AND r.deadline IS NOT NULL
    AND r.deadline < NOW()

  UNION ALL

  -- DPIA : approuvées et revue annuelle en retard.
  SELECT 'dpia'::text, d.id, d.organization_id, d.review_date
  FROM privacy_dpias d
  WHERE d.status = 'approved'
    AND d.review_date IS NOT NULL
    AND d.review_date < NOW()
$$;

REVOKE ALL ON FUNCTION compliance_deadlines_overdue() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION compliance_deadlines_overdue() TO creche_app;
  END IF;
END $$;
