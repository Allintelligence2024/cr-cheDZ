-- ============================================================================
-- 050_metrics_global_counts.sql
-- Fondation (audit, étape 4.1) : les jauges métier de /metrics (Prometheus)
-- comptaient des tables TENANT (background_jobs, invoices, children…) via la
-- pool brute SANS contexte tenant — sous le rôle applicatif NOBYPASSRLS,
-- chaque COUNT renvoyait silencieusement 0 : métriques globales fausses
-- (même famille de défaut que le P0 paiement : pool brute + RLS = 0 ligne).
--
-- Correction : fonction SECURITY DEFINER metrics_global_counts() — même
-- pattern de confiance que support_* (migration 029+) : agrégats GLOBAUX
-- (des compteurs, aucune ligne ni PII), résolus côté serveur. Le service
-- /metrics appelle désormais cette fonction au lieu de compter les tables
-- directement.
--
-- NB découvert au passage : la jauge sync_ops_24h comptait
-- sync_operations.created_at — colonne INEXISTANTE (received_at) : l'erreur
-- était avalée par count() → jauge faussement 0 depuis la phase 11. Corrigé
-- ici (received_at).
-- ============================================================================

CREATE OR REPLACE FUNCTION metrics_global_counts()
RETURNS TABLE (metric text, n bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  SELECT 'jobs_pending'::text, COUNT(*)::bigint FROM background_jobs WHERE status = 'pending'
  UNION ALL
  SELECT 'jobs_failed_24h', COUNT(*)::bigint FROM background_jobs WHERE status = 'failed' AND failed_at >= NOW() - INTERVAL '24 hours'
  UNION ALL
  SELECT 'notifications_pending', COUNT(*)::bigint FROM notification_queue WHERE status = 'pending'
  UNION ALL
  SELECT 'invoices_unpaid', COUNT(*)::bigint FROM invoices WHERE status IN ('sent', 'partially_paid', 'overdue')
  UNION ALL
  SELECT 'children_active', COUNT(*)::bigint FROM children WHERE deleted_at IS NULL AND status = 'active'
  UNION ALL
  SELECT 'checkins_today', COUNT(*)::bigint FROM attendance_events e JOIN attendance_sessions s ON s.id = e.session_id
    WHERE e.event_type = 'check_in' AND s.session_date = (NOW() AT TIME ZONE 'Africa/Algiers')::date
  UNION ALL
  SELECT 'sync_ops_24h', COUNT(*)::bigint FROM sync_operations WHERE received_at >= NOW() - INTERVAL '24 hours'
$$;

REVOKE ALL ON FUNCTION metrics_global_counts() FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION metrics_global_counts() TO creche_app;
  END IF;
END $$;
