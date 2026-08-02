-- ============================================================================
-- 036_support_pilot_summary.sql
-- Suivi pilote (Phase 12) : agrégats par organisation pour la console
-- support (super_admin) — pointages du jour, sync 24 h, événements journal,
-- factures impayées, jobs en échec. SECURITY DEFINER (cross-tenant, pattern
-- 029/035). Aucune donnée personnelle : uniquement des compteurs.
-- ============================================================================

CREATE OR REPLACE FUNCTION support_pilot_summary()
RETURNS TABLE (
  org_slug text,
  org_name text,
  children_active integer,
  checkins_today integer,
  sync_ops_24h integer,
  journal_events_today integer,
  invoices_unpaid integer,
  jobs_failed_24h integer
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT
      o.slug,
      o.name_fr,
      (SELECT COUNT(*)::int FROM children c
        WHERE c.organization_id = o.id AND c.deleted_at IS NULL AND c.status = 'active'),
      (SELECT COUNT(*)::int FROM attendance_events e
        JOIN attendance_sessions s ON s.id = e.session_id
        WHERE s.organization_id = o.id AND e.event_type = 'check_in'
          AND s.session_date = (NOW() AT TIME ZONE 'Africa/Algiers')::date),
      (SELECT COUNT(*)::int FROM sync_operations so
        WHERE so.organization_id = o.id AND so.created_at >= NOW() - INTERVAL '24 hours'),
      (SELECT COUNT(*)::int FROM daily_log_events d
        WHERE d.organization_id = o.id AND d.event_date = (NOW() AT TIME ZONE 'Africa/Algiers')::date),
      (SELECT COUNT(*)::int FROM invoices i
        WHERE i.organization_id = o.id AND i.status IN ('sent', 'partially_paid', 'overdue')),
      (SELECT COUNT(*)::int FROM background_jobs bj
        WHERE bj.organization_id = o.id AND bj.status = 'failed'
          AND bj.failed_at >= NOW() - INTERVAL '24 hours')
    FROM organizations o
    ORDER BY o.slug;
END $$;

REVOKE ALL ON FUNCTION support_pilot_summary() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION support_pilot_summary() TO creche_app;
  END IF;
END $$;
