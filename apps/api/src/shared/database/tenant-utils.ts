import { TenantContextService } from './tenant-context.service';
import { AppError } from '../errors';

/**
 * Retourne le tenant courant ou jette 403 TENANT_REQUIRED si absent.
 *
 * C9 (remédiation audits combinés) — comportement super_admin documenté :
 * un super_admin n'a PAS d'organisation dans son JWT (rôle plateforme).
 * Sur les routes qui exigent un tenant, il reçoit donc 403 TENANT_REQUIRED
 * avec un message FR/AR explicite — ce n'est pas un trou d'authentification
 * mais une absence de périmètre : à lui de cibler l'organisation via les
 * routes plateforme dédiées (ex. /organizations) ou de rejoindre une
 * organisation avec un rôle membre. Code d'erreur distinct de FORBIDDEN pour
 * que les clients (web/mobile) puissent afficher la vraie raison.
 */
export function requireTenant(ctx: TenantContextService): string {
  const tenantId = ctx.getTenantIdOrNull();
  if (!tenantId) {
    throw new AppError(
      'TENANT_REQUIRED',
      'Cette action nécessite une organisation ; sélectionnez un périmètre membre',
      'هذا الإجراء يتطلب مؤسسة؛ اختر نطاق عضوية',
      403,
    );
  }
  return tenantId;
}
