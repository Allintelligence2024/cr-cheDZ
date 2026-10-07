import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Restreint une route aux permissions RBAC données (matrice
 * role_permissions, migration 003 + guard 084).
 *
 * Format : `@Permissions('health:medicate')` — l'utilisateur doit disposer de
 * la permission `health:medicate` dans l'organisation courante.
 *
 * Plusieurs clés = OU logique (l'une d'elles suffit) — même sémantique que
 * `@Roles`. Pour un ET, poser deux décorateurs `@Permissions` sur des routes
 * séparées (cas rare, évité).
 *
 * À combiner avec `@Roles` : `@Roles('educator') @Permissions('health:medicate')`
 * restreint aux educators ET à ceux qui ont la permission medicate.
 */
export const Permissions = (...permissions: string[]) => SetMetadata(PERMISSIONS_KEY, permissions);
