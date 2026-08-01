import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Contexte de requête via AsyncLocalStorage (pattern NestJS officiel).
 * Un contexte est créé par requête (middleware request-context.middleware).
 * Le JwtAuthGuard y écrit le tenant ; TenantContextService le lit.
 * Évite la portée REQUEST (qui casse l'injection dans les APP_GUARD).
 */
export interface RequestContext {
  tenantId: string | null;
  userId: string | null;
  correlationId: string | null;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
