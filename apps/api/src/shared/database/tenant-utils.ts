import { TenantContextService } from './tenant-context.service';
import { Errors } from '../errors';

/**
 * Retourne le tenant courant ou jette FORBIDDEN si absent
 * (requête non authentifiée ou super_admin sans organisation).
 */
export function requireTenant(ctx: TenantContextService): string {
  const tenantId = ctx.getTenantIdOrNull();
  if (!tenantId) throw Errors.forbidden();
  return tenantId;
}
