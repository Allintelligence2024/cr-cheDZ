import { SetMetadata } from '@nestjs/common';

/**
 * Décorateur `@FeatureFlag('flag_key')` — applique un FeatureFlagGuard
 * (cf. apps/api/src/shared/guards/feature-flag.guard.ts) qui lit le flag
 * via FeatureFlagsService.isEnabled(flag_key, organization_id).
 *
 * R17 (remédiation 2026-09-21, F16) — feature-flag léger pour désactiver
 * une route exposée sans UI admin-web (enrollment, staff_schedule).
 * Si le flag est `false` côté serveur, la route renvoie 503
 * `FEATURE_DISABLED` (≠ 404, plus parlant côté mobile qui peut
 * s'adapter). Si le flag n'existe pas : on considère `true` par défaut
 * (fail-open pour ne pas casser une route oubliée par erreur).
 *
 * Méta-donnée consommée par FeatureFlagGuard : `feature_flag` = flag_key.
 */
export const FEATURE_FLAG_META = 'feature_flag';
export const FeatureFlag = (flagKey: string): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE_FLAG_META, flagKey);
