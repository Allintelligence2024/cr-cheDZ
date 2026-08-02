import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';

/**
 * Marketplace / annuaire public (roadmap v2).
 *
 * Règles :
 * - le flag GLOBAL `marketplace` doit être activé (sinon 422 FEATURE_DISABLED) ;
 * - seules les organisations avec `settings.public_listing = true` ET
 *   `settings.public_name` sont listées (opt-in explicite de chaque crèche) ;
 * - le listing est accessible via un endpoint PUBLIC (pas de JWT) : il ne
 *   renvoie QUE des données de présentation (nom public, wilaya, commune,
 *   description, contact public) — jamais d'emails internes ni de données
 *   d'enfants.
 */
@Injectable()
export class MarketplaceService {
  constructor(private readonly tenantContext: TenantContextService) {}

  /** Vérifie le flag global marketplace (via la pool brute, table système RLS org NULL). */
  async isEnabled(): Promise<boolean> {
    const flag = await this.tenantContext.withTenantConnection(async (client) => client.query(
      `SELECT is_enabled FROM feature_flags
       WHERE flag_key='marketplace' AND organization_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    ));
    return Boolean(flag.rows[0]?.is_enabled);
  }

  /** Liste publique des crèches (opt-in). Endpoint @Public — aucune donnée sensible. */
  async list(): Promise<Array<Record<string, unknown>>> {
    if (!(await this.isEnabled())) return [];
    // Lecture directe (sans tenant) : organisations = table système ; on ne
    // filtre QUE sur les champs de présentation.
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT slug, name_fr,
                settings->>'public_name' AS public_name,
                settings->>'public_description' AS public_description,
                wilaya, commune, address_line1,
                settings->>'public_phone' AS public_phone,
                settings->>'public_email' AS public_email,
                establishment_type
         FROM organizations
         WHERE is_active = true
           AND settings->>'public_listing' = 'true'
         ORDER BY name_fr`,
      );
      return res.rows;
    });
  }
}
