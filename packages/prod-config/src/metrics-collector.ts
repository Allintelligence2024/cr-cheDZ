/**
 * H2k — credential de collecte Prometheus pour GET /api/v1/metrics.
 *
 * Conception « privilège limité » :
 *  - le collecteur ne reçoit AUCUN JWT utilisateur : ni rôle, ni session, ni
 *    capacité métier hors le scrape ;
 *  - la configuration API ne contient que des DIGESTS SHA-256 (liste séparée
 *    par virgules) — jamais le token brut, jamais un mot de passe administrateur ;
 *  - rotation : l'entrée courante et l'entrée précédente coexistent (fenêtre
 *    de grâce), puis l'ancienne est retirée → révocation à la prochaine
 *    relecture de la config ;
 *  - liste absente = collecte par token désactivée ; le chemin administrateur
 *    (JWT d'accès plateforme courant, H2j) reste le seul accès.
 *
 * Entrées valides : 64 caractères hexadécimaux (majuscules acceptées,
 * normalisées). Toute entrée malformée désactive le chemin collecteur
 * (fail-closed) ET, en production, bloque le démarrage : une coquille dans
 * la liste ne doit jamais laisser un token inattendu passer ni masquer une
 * révocation ratée.
 */
import type { EnvLike } from './index';

/** Variable d'environnement livrée à l'API : digests acceptés, séparés par des virgules. */
export const METRICS_COLLECTOR_HASHES_ENV = 'METRICS_COLLECTOR_TOKEN_HASHES';

export interface MetricsCollectorConfig {
  /** true seulement si la liste est présente, complète et sans entrée invalide. */
  enabled: boolean;
  /** Digests hexadécimaux normalisés (minuscules), dédupliqués, dans l'ordre. */
  hashes: string[];
  /** Entrées malformées, indexées mais JAMAIS échoées (peuvent être sensibles). */
  invalidEntries: number[];
}

const DIGEST_HEX = /^[0-9a-fA-F]{64}$/;

export function parseMetricsCollectorConfig(env: EnvLike = process.env): MetricsCollectorConfig {
  const raw = env[METRICS_COLLECTOR_HASHES_ENV];
  if (raw === undefined || raw.trim() === '') return { enabled: false, hashes: [], invalidEntries: [] };
  const hashes: string[] = [];
  const seen = new Set<string>();
  const invalidEntries: number[] = [];
  raw.split(',').forEach((entry, index) => {
    const value = entry.trim();
    if (value === '') return; // virgules superflues tolérées (fin de ligne, copier-coller)
    if (!DIGEST_HEX.test(value)) {
      invalidEntries.push(index + 1);
      return;
    }
    const normalized = value.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      hashes.push(normalized);
    }
  });
  return { enabled: hashes.length > 0 && invalidEntries.length === 0, hashes, invalidEntries };
}

/** Problèmes de configuration (vide = ok). Appelé par la garde de production. */
export function validateMetricsCollectorConfig(env: EnvLike = process.env): string[] {
  const parsed = parseMetricsCollectorConfig(env);
  if (parsed.invalidEntries.length === 0) return [];
  return [
    `${METRICS_COLLECTOR_HASHES_ENV}: entrée(s) invalide(s) n° ${parsed.invalidEntries.join(', ')} — ` +
      'chaque entrée doit être un digest SHA-256 hexadécimal de 64 caractères (jamais le token brut) ; ' +
      'le chemin de collecte par token est refusé tant que la liste est malformée',
  ];
}
