import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { FEATURE_FLAG_META } from '../decorators/feature-flag.decorator';
import { FeatureFlagsService } from '../../modules/organizations/feature-flags.service';

/**
 * FeatureFlagGuard — bloque une route si le flag `feature_flag` est désactivé
 * côté serveur (cf. seed 014 + feature_flags).
 *
 * R17 (remédiation 2026-09-21, F16) : complément de sécurité pour les
 * routes exposées SANS UI admin-web. Le mobile peut quand même appeler
 * la route, mais elle renvoie 503 FEATURE_DISABLED — l'app mobile désactive
 * l'écran correspondant. Côté admin-web : pas de menu, pas de bouton, la
 * feature est invisible.
 *
 * Lookup : `flag_key` + `organization_id` (NULL = global). Si le flag n'est
 * pas trouvé : on autorise (fail-open) pour ne pas casser une migration
 * oubliée ; le commentaire du flag dans seed 014 sert de mémo.
 *
 * Pas de cache applicatif ici : la table feature_flags est petite (quelques
 * dizaines de lignes max) et la requête est indexée (idx sur flag_key +
 * organization_id). Si la latence devient un problème, on ajoutera un
 * cache mémoire 5s — la cohérence n'est pas critique (toggle rare).
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  private readonly logger = new Logger(FeatureFlagGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flagKey = this.reflector.getAllAndOverride<string>(FEATURE_FLAG_META, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!flagKey) return true; // pas de @FeatureFlag → on laisse passer

    // Le tenant peut être dans le JWT (currentUser) ou dans le contexte
    // tenant (GUC app_tenant_id()). On tente les deux ; à défaut, NULL
    // = lecture du flag global uniquement.
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = (req as { user?: { organizationId?: string } }).user;
    const tenantCtx = (req as { tenantContext?: { getTenantIdOrNull?: () => string | null } }).tenantContext;
    const orgId = user?.organizationId ?? tenantCtx?.getTenantIdOrNull?.() ?? null;

    const enabled = await this.featureFlags.isEnabledByOrg(flagKey, orgId);
    if (enabled) return true;

    this.logger.warn(`[FeatureFlagGuard] route bloquée : flag '${flagKey}' désactivé (org=${orgId ?? 'global'})`);
    // On lève 503 (≠ 404) — l'app mobile peut afficher un message
    // « module désactivé par votre administrateur » au lieu d'un
    // « endpoint introuvable » trompeur.
    throw new (await import('../errors')).AppError(
      'FEATURE_DISABLED',
      `Module désactivé (flag: ${flagKey})`,
      `وحدة معطلة (${flagKey})`,
      503,
    );
  }
}
