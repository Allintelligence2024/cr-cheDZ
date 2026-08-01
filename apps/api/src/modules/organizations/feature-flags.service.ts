import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';

/**
 * Feature flags : globaux (organization_id NULL) + surcharges par
 * organisation. La RLS de feature_flags limite déjà la lecture au tenant
 * courant (ou aux flags globaux). Résultat : une entrée par flag, la
 * surcharge d'organisation gagnant sur le flag global.
 */
@Injectable()
export class FeatureFlagsService {
  constructor(private readonly tenantContext: TenantContextService) {}

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
}
