import { isAbsolute, resolve } from 'node:path';
import { resolveStorageBackend, type StorageBackend } from './storage';

/**
 * Garde de configuration de production (MISSION P1 — feat(config)).
 *
 * Module PARTAGÉ par l'API (`apps/api/src/main.ts`) et le worker
 * (`apps/worker/src/main.ts`) : exécuté au bootstrap UNIQUEMENT lorsque
 * NODE_ENV=production pour les secrets. Le sélecteur STORAGE_BACKEND est
 * vérifié dans tous les environnements (s3 par défaut hors production).
 *
 * Refuse le démarrage avec un message EXPLICITE listant chaque variable
 * fautive :
 *  - PAYMENT_WEBHOOK_SECRET : absent ou < 32 caractères ;
 *  - STORAGE_BACKEND=s3 : S3_ACCESS_KEY / S3_SECRET_KEY laissés aux défauts
 *    de développement minio_dev / minio_dev_password ;
 *  - STORAGE_BACKEND=local : STORAGE_LOCAL_DIR laissé au défaut
 *    /tmp/creche-pdf ;
 *  - configuration SATIM partielle (les 3 variables ensemble ou aucune) ;
 *  - JWT_SECRET : inspection du code (identity.module.ts) — l'auth est
 *    signée par le JwtModule avec `JWT_SECRET` et, s'il est absent, un
 *    DÉFAUT DE DÉVELOPPEMENT en clair est utilisé. Couvert pareillement :
 *    absent, < 32 caractères ou égal au défaut → démarrage refusé.
 */

/** Défaut de développement du JwtModule (identity.module.ts) — jamais en prod. */
export const DEV_JWT_SECRET = 'dev_jwt_secret_change_in_prod_minimum_32_chars';
/** Défauts de développement du backend S3 (pdf-storage / media / video / worker). */
export const DEV_S3_ACCESS_KEY = 'minio_dev';
export const DEV_S3_SECRET_KEY = 'minio_dev_password';
/** Défaut de développement du backend local (pdf-storage / exports / video / worker). */
export const DEV_STORAGE_LOCAL_DIR = '/tmp/creche-pdf';
/** Longueur minimale des secrets de signature (webhook + JWT). */
export const MIN_SECRET_LENGTH = 32;
/** Les 3 variables SATIM sont TOUTES configurées ou AUCUNE (sinon partiel). */
export const SATIM_VARS = ['SATIM_MERCHANT_ID', 'SATIM_SECRET', 'SATIM_GATEWAY_URL'] as const;

export type EnvLike = Record<string, string | undefined>;

/** Liste les problèmes de configuration (vide = config sûre). */
export function validateProductionConfig(env: EnvLike = process.env): string[] {
  const problems: string[] = [];

  // 1. Webhook de paiement : absent ou trop court (signature HMAC faible).
  const webhookSecret = env.PAYMENT_WEBHOOK_SECRET;
  if (!webhookSecret || webhookSecret.length < MIN_SECRET_LENGTH) {
    problems.push(`PAYMENT_WEBHOOK_SECRET: absent ou < ${MIN_SECRET_LENGTH} caractères`);
  }

  // 2. JWT : l'auth retombe sur un défaut de développement si absent —
  //    même exigence que le webhook (le défaut exact est aussi refusé).
  const jwtSecret = env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < MIN_SECRET_LENGTH || jwtSecret === DEV_JWT_SECRET) {
    problems.push(
      `JWT_SECRET: absent, < ${MIN_SECRET_LENGTH} caractères, ou égal au défaut de développement '${DEV_JWT_SECRET}'`,
    );
  }

  // 3. Backend de stockage : secrets S3 par défaut ou répertoire local par défaut.
  let storageBackend: StorageBackend | undefined;
  try { storageBackend = resolveStorageBackend(env); }
  catch (error) { problems.push((error as Error).message); }
  if (storageBackend === 's3') {
    for (const [name, fallback] of [['S3_ACCESS_KEY', DEV_S3_ACCESS_KEY], ['S3_SECRET_KEY', DEV_S3_SECRET_KEY]] as const) {
      const value = env[name];
      if (!value?.trim() || value === fallback) {
        problems.push(`STORAGE_BACKEND=s3: ${name} absent, vide ou égal au défaut de développement`);
      }
    }
  } else if (storageBackend === 'local') {
    const dir = env.STORAGE_LOCAL_DIR;
    if (!dir?.trim() || dir.trim() !== dir || !isAbsolute(dir) || resolve(dir) === DEV_STORAGE_LOCAL_DIR) {
      problems.push(`STORAGE_BACKEND=local: STORAGE_LOCAL_DIR doit être absolu, non vide et différent du défaut de développement ${DEV_STORAGE_LOCAL_DIR}`);
    }
  }

  // 4. SATIM complet ou absent — jamais partiel (init incohérente possible).
  const present = SATIM_VARS.filter((v) => Boolean(env[v] && env[v]!.length > 0));
  if (present.length > 0 && present.length < SATIM_VARS.length) {
    const missing = SATIM_VARS.filter((v) => !env[v] || env[v]!.length === 0);
    problems.push(
      `config SATIM partielle: ${missing.join(', ')} manquant(s) — ${SATIM_VARS.join('/')} (les 3 ensemble ou aucune)`,
    );
  }

  return problems;
}

/**
 * Refuse le démarrage si NODE_ENV=production et que la config est fautive.
 * Hors production : seul le sélecteur de backend est contrôlé.
 */
export function assertProductionConfig(env: EnvLike = process.env): void {
  if (env.NODE_ENV !== 'production') {
    resolveStorageBackend(env);
    return;
  }
  const problems = validateProductionConfig(env);
  if (problems.length === 0) return;
  throw new Error(
    'GARDE CONFIG PRODUCTION — démarrage REFUSÉ (corrigez le .env puis relancez) :\n'
      + problems.map((p) => `  - ${p}`).join('\n'),
  );
}

export { assertApplicationDatabaseRole } from './database-role';

export { BUSINESS_TIME_ZONE, dateOnly, monthBounds, exportRange } from './calendar';

export { JOURNAL_NOTIFICATION_TYPES, NOTIFICATION_DENIED_REASON, NOTIFICATION_INBOX_ALLOWED_SQL, notificationAllowed } from './notification-access';

export { resolveStorageBackend, type StorageBackend } from './storage';
