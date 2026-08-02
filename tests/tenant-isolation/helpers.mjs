/**
 * Helpers partagés des tests d'isolation.
 *
 * Le rôle applicatif de test (creche_app_test) est un clone de ce que
 * infrastructure/database/roles.sql fait en staging/prod (C06) : rôle NON
 * superutilisateur avec NOBYPASSRLS. C'est le SEUL moyen de prouver que la
 * RLS protège réellement les données (le superuser la contourne toujours).
 */
export const APP_TEST_ROLE = 'creche_app_test';
export const APP_TEST_PASSWORD = 'creche_app_test_pw';

export async function ensureAppRole(admin) {
  await admin.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app_test') THEN
        CREATE ROLE creche_app_test LOGIN PASSWORD 'creche_app_test_pw' NOBYPASSRLS;
      ELSE
        EXECUTE 'ALTER ROLE creche_app_test WITH LOGIN PASSWORD ''creche_app_test_pw'' NOBYPASSRLS';
      END IF;
    END $$;
  `);
  await admin.query('GRANT USAGE ON SCHEMA public TO creche_app_test');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO creche_app_test');
  await admin.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO creche_app_test');
  // Fonctions SECURITY DEFINER du bootstrap auth (migration 015)
  await admin.query('GRANT EXECUTE ON FUNCTION auth_get_memberships(uuid) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION auth_refresh_lookup(text) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION auth_get_device(uuid) TO creche_app_test');
  // Fonctions SECURITY DEFINER des invitations (migration 016)
  await admin.query('GRANT EXECUTE ON FUNCTION invite_get_membership(uuid, uuid) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION invite_upsert_membership(uuid, uuid, uuid, uuid, uuid[]) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION invite_accept(uuid, uuid) TO creche_app_test');
  // Séquence de référence enfants (migration 017)
  await admin.query('GRANT EXECUTE ON FUNCTION next_org_sequence(uuid) TO creche_app_test');
  // Helper RLS (migration 018) — utilisé par toutes les politiques
  await admin.query('GRANT EXECUTE ON FUNCTION app_tenant_id() TO creche_app_test');
  // Phase 8 (migration 024) : webhook de paiement + cycle de vie des jobs
  await admin.query('GRANT EXECUTE ON FUNCTION billing_webhook_apply(uuid, text, numeric, text, timestamptz, text) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION jobs_claim_next() TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION jobs_finish(uuid, boolean, text) TO creche_app_test');
  // Phase 7 (migration 025) : bootstrap login parent (guardians sous RLS)
  await admin.query('GRANT EXECUTE ON FUNCTION auth_parent_lookup_by_phone(text) TO creche_app_test');
  // Phase 10 (migration 029) : console support (recherche globale, jobs)
  await admin.query('GRANT EXECUTE ON FUNCTION support_global_search(text) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION support_list_jobs(integer) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION support_retry_job(uuid) TO creche_app_test');
  // Phase 11 (migration 034) : rétention des journaux (5 ans)
  await admin.query('GRANT EXECUTE ON FUNCTION retention_purge_logs(timestamptz) TO creche_app_test');
  // Phase 11 (migration 035) : console support — feature flags
  await admin.query('GRANT EXECUTE ON FUNCTION support_list_flags() TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION support_set_flag(text, uuid, boolean) TO creche_app_test');
  // Phase 12 (migration 036) : suivi pilote (agrégats par organisation)
  await admin.query('GRANT EXECUTE ON FUNCTION support_pilot_summary() TO creche_app_test');
}

/** URL de connexion avec le rôle applicatif (même hôte/port/base que DATABASE_URL). */
export function appUrl() {
  const u = new URL(process.env.DATABASE_URL);
  u.username = APP_TEST_ROLE;
  u.password = APP_TEST_PASSWORD;
  return u.toString();
}
