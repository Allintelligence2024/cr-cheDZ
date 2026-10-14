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
  // ── Grants : MIROIR de infrastructure/database/grants.sql ──────────────────
  // Le rôle de test doit avoir EXACTEMENT les droits que le migrateur donne à
  // creche_app en production. Jusqu'ici la liste des fonctions SECURITY
  // DEFINER autorisées était recopiée à la main : elle a dérivé (migration 084
  // `auth_user_permissions` — le PermissionsGuard répondait « permission denied
  // for function » sur CHAQUE route, 30+ suites rouges pour la même cause).
  // Un `GRANT EXECUTE ON ALL FUNCTIONS` + DEFAULT PRIVILEGES, comme en prod,
  // supprime la classe entière de dérive : une fonction ajoutée par une
  // migration est utilisable immédiatement, sans toucher ce helper.
  await admin.query('GRANT USAGE ON SCHEMA public TO creche_app_test');
  await admin.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO creche_app_test');
  await admin.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO creche_app_test');
  await admin.query('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO creche_app_test');
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO creche_app_test`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO creche_app_test`);
  await admin.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT EXECUTE ON FUNCTIONS TO creche_app_test`);
  // Le registre de migrations est lisible (schema-check), pas modifiable —
  // même restriction que grants.sql pour creche_app.
  await admin.query('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_migrations FROM creche_app_test');
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

/**
 * Raccourci de banc d'essai à NE JAMAIS propager à un processus NODE_ENV=production.
 *
 * Le runner (`run-isolation-suites.sh`) exporte `RATE_LIMIT_DISABLED=1` et le
 * job CI `true`, pour que les suites puissent marteler l'API d'un même process.
 * Un spawn de production qui fait `...process.env` transmet donc ce raccourci —
 * or la garde de configuration (plan de réparation 2026-09-24, lot 1) le REFUSE
 * en production : le processus meurt au boot (« GARDE CONFIG PRODUCTION ») et le
 * test échoue pour la mauvaise raison, en accusant les rôles de base.
 *
 * Un environnement de production ne désactive jamais la limitation de débit :
 * tout spawn `NODE_ENV=production` le dit donc explicitement.
 * Verrou anti-régression : phase26 (§ « raccourci de banc d'essai »).
 */
export const PRODUCTION_SPAWN_ENV = { RATE_LIMIT_DISABLED: 'false' };
