import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { parseMetricsCollectorConfig } from '@creche/prod-config';

/**
 * H2k — vérification du credential de collecte Prometheus (privilège limité).
 *
 * Le token présenté est un secret opaque à haute entropie (32 octets, généré
 * hors bande par `scripts/provision-metrics-collector.mjs`). La config API ne
 * contient QUE ses digests SHA-256 ; la comparaison se fait digeste contre
 * digeste, en temps constant. Aucun état en base : la révocation est la
 * relecture de la liste de digests (redéploiement/rechargement de config),
 * exactement comme une rotation de secret d'infrastructure.
 *
 * La liste est relue à chaque scrape : changer l'env (restart) applique
 * rotation/révocation sans recompiler ; un environnement malformé est refusé
 * en bloc (fail-closed) par la config partagée, jamais partiellement.
 */
@Injectable()
export class MetricsCollectorService {
  /** Le collecteur n'a d'autorité que sur le scrape ; jamais un principal API. */
  accepts(token: string): boolean {
    const config = parseMetricsCollectorConfig(process.env);
    if (!config.enabled) return false;
    // Digestes de même longueur (32 octets) par construction : timingSafeEqual est sûr ici.
    const presented = createHash('sha256').update(token, 'utf8').digest();
    let matched = false;
    for (const entry of config.hashes) {
      const equal = timingSafeEqual(presented, Buffer.from(entry, 'hex'));
      matched = matched || equal; // pas de break : coût indépendant de la position
    }
    return matched;
  }
}
