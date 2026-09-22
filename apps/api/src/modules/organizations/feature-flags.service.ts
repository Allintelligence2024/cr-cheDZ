import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { PG_POOL } from '../../shared/database/database.provider';

/**
 * Feature flags : globaux (organization_id NULL) + surcharges par
 * organisation. La RLS de feature_flags limite déjà la lecture au tenant
 * courant (ou aux flags globaux). Résultat : une entrée par flag, la
 * surcharge d'organisation gagnant sur le flag global.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @Inject(PG_POOL) private readonly pool: Pool,
  ) {}

  async list(): Promise<Array<Record<string, unknown>>> {
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT flag_key, is_enabled, description, organization_id
         FROM feature_flags
         ORDER BY flag_key`,
      );
      const byKey = new Map<string, { flag_key: string; is_enabled: boolean; description: string | null; is_org_override: boolean }>();
      for (const row of res.rows) {
        const existing = byKey.get(row.flag_key);
        // La ligne d'organisation (RLS : celle du tenant) écrase la globale.
        if (!existing || row.organization_id !== null) {
          byKey.set(row.flag_key, {
            flag_key: row.flag_key,
            is_enabled: row.is_enabled,
            description: row.description,
            is_org_override: row.organization_id !== null,
          });
        }
      }
      return [...byKey.values()];
    });
  }

  /**
   * R17 (remédiation 2026-09-21, F16) — résout un flag pour un tenant
   * donné. Surcharge d'organisation > globale > défaut (false si flag
   * introuvable, MAIS le FeatureFlagGuard fail-open, cf. commentaire
   * dans feature-flag.guard.ts).
   *
   * Connexion superuser (pool direct) : le guard peut être appelé hors
   * d'un tenant (cas global). C'est intentionnel : si `orgId` est NULL,
   * on lit uniquement le flag global (organization_id IS NULL).
   *
   * Stratégie de lookup en 2 temps (surcharge → global) parce que la
   * contrainte UNIQUE(flag_key, organization_id) ne matche pas NULL=NULL
   * en PostgreSQL ; un ORDER BY avec NULLS LAST ne ramène pas la ligne
   * globale quand un orgId non-null est fourni.
   */
  async isEnabledByOrg(flagKey: string, orgId: string | null): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      // Étape 1 : surcharge d'org (si orgId fourni).
      if (orgId) {
        const orgRes = await client.query<{ is_enabled: boolean }>(
          `SELECT is_enabled FROM feature_flags
           WHERE flag_key = $1 AND organization_id = $2::uuid
           LIMIT 1`,
          [flagKey, orgId],
        );
        if (orgRes.rows.length > 0) return orgRes.rows[0].is_enabled === true;
      }
      // Étape 2 : flag global (organization_id IS NULL).
      const globRes = await client.query<{ is_enabled: boolean }>(
        `SELECT is_enabled FROM feature_flags
         WHERE flag_key = $1 AND organization_id IS NULL
         LIMIT 1`,
        [flagKey],
      );
      // Pas de ligne globale → fail-open (cf. guard).
      if (globRes.rows.length === 0) return true;
      return globRes.rows[0].is_enabled === true;
    } finally {
      client.release();
    }
  }
}
