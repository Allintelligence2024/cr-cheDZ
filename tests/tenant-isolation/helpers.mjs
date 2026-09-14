// Isolation des fixtures : ne pas déclencher une purge si une suite croise l'heure pleine.
// Les scénarios E2 activent explicitement le scheduler dans leurs vrais workers.
process.env.WORKER_SCHEDULER_ENABLED ??= 'false';

import pg from 'pg';

/**
 * Helpers partagés des tests d'isolation.
 *
 * Le rôle applicatif de test (creche_app_test) est un clone de ce que
 * infrastructure/database/roles.sql fait en staging/prod (C06) : rôle NON
 * superutilisateur avec NOBYPASSRLS. C'est le SEUL moyen de prouver que la
 * RLS protège réellement les données (le superuser la contourne toujours).
 */
export const APP_TEST_ROLE = process.env.PRODUCTION_ROLE_TESTS === '1' ? 'creche_app' : 'creche_app_test';
export const APP_TEST_PASSWORD = 'creche_app_test_pw';

export async function ensureAppRole(admin) {
  if (process.env.PRODUCTION_ROLE_TESTS === '1') {
    const { assertApplicationDatabaseRole } = await import('@creche/prod-config');
    // IMPORTANT : aucun CREATE ROLE/GRANT ici. Tester les grants livrés, pas
    // ceux d'un clone privilégié reconstruit par le helper.
    const app = new pg.Client({ connectionString: appUrl() });
    await app.connect();
    try {
      await assertApplicationDatabaseRole(app, { NODE_ENV: 'production' });
      console.log('✓ Connexion applicative réelle : creche_app (grants de production inchangés)');
    } finally { await app.end(); }
    return;
  }
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
  // E1 (053) — uniquement pour le mode historique. Le mode prod plus haut
  // n'ajoute JAMAIS de grants : il vérifie ceux livrés par le migrateur.
  const leased = await admin.query("SELECT to_regprocedure('jobs_claim_leased()') AS fn");
  if (leased.rows[0].fn) {
    await admin.query(`GRANT EXECUTE ON FUNCTION jobs_claim_leased(), jobs_heartbeat(uuid,uuid),
      jobs_finish_leased(uuid,uuid,boolean,text), jobs_reap_stale(interval) TO creche_app_test`);
  }
  // E2/E6 : mode historique seulement ; en prod, grants de migrations inchangés.
  if ((await admin.query("SELECT to_regprocedure('scheduler_enqueue_due()') AS fn")).rows[0].fn) {
    await admin.query('GRANT EXECUTE ON FUNCTION scheduler_enqueue_due(), scheduler_health(), scheduler_next_run(text,timestamptz) TO creche_app_test');
  }
  if ((await admin.query("SELECT to_regprocedure('exports_reconcile_tenant()') AS fn")).rows[0].fn) {
    await admin.query('GRANT EXECUTE ON FUNCTION exports_fail_job(uuid,uuid), exports_fail_stale(interval,uuid), exports_reconcile_tenant() TO creche_app_test');
  }
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
  // Roadmap v2 (migration 040) : multi-rôles — liste des rôles effectifs
  await admin.query('GRANT EXECUTE ON FUNCTION auth_user_roles(uuid) TO creche_app_test');
  // Roadmap v2 (migration 042) : drain notification_queue sous NOBYPASSRLS
  await admin.query('GRANT EXECUTE ON FUNCTION notif_queue_claim(integer) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION notif_queue_finish(uuid, boolean, text) TO creche_app_test');
  // Roadmap v2 (migration 046) : garde-fou DPIA vidéosurveillance
  await admin.query('GRANT EXECUTE ON FUNCTION privacy_approved_dpia_exists(uuid, text) TO creche_app_test');
  // Roadmap v2 (migration 047) : purge des clips vidéo à 30 jours
  await admin.query('GRANT EXECUTE ON FUNCTION video_clips_expired(integer) TO creche_app_test');
  await admin.query('GRANT EXECUTE ON FUNCTION video_clips_delete_purged(uuid[]) TO creche_app_test');
  // Mission P1 (migration 051) : expiration des paiements pending SATIM.
  // GRANT conditionnel : la preuve par mutation retire 051 temporairement —
  // la suite doit alors échouer sur le COMPORTEMENT (fonction absente), pas
  // sur le GRANT lui-même.
  const expiryFn = await admin.query(`SELECT 1 FROM pg_proc WHERE proname='payments_expire_pending'`);
  if (expiryFn.rows.length > 0) {
    await admin.query('GRANT EXECUTE ON FUNCTION payments_expire_pending(integer, integer) TO creche_app_test');
  }
  // Fondations audit (migration 050) : jauges globales /metrics
  await admin.query('GRANT EXECUTE ON FUNCTION metrics_global_counts() TO creche_app_test');
}

/** URL de connexion avec le rôle applicatif (même hôte/port/base que DATABASE_URL). */
export function appUrl() {
  if (process.env.PRODUCTION_ROLE_TESTS === '1') {
    if (!process.env.APP_DATABASE_URL || new URL(process.env.APP_DATABASE_URL).username !== 'creche_app') {
      throw new Error('APP_DATABASE_URL creche_app requis pour le gate de production');
    }
    return process.env.APP_DATABASE_URL;
  }
  const u = new URL(process.env.DATABASE_URL);
  u.username = APP_TEST_ROLE;
  u.password = APP_TEST_PASSWORD;
  return u.toString();
}
