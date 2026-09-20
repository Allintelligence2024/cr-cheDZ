/**
 * F3 (rapport 5 analyses) — visibilité des écrans par rôle côté admin-web.
 *
 * Ce n'est PAS une frontière d'autorisation : le serveur applique `@Roles`
 * sur chaque endpoint et renverrait 403 de toute façon. Ceci est de
 * l'hygiène UX / défense en profondeur : un éducateur ne voit pas « Paie »
 * dans le menu et ne tombe pas sur une page vide de 403 en tapant /payroll.
 *
 * La matrice ci-dessous est le MIROIR des `@Roles(...)` des contrôleurs API
 * (lecture minimale de chaque écran). Toute divergence doit être corrigée
 * ici, jamais côté serveur pour « faire passer » l'UI.
 */
export type RoleSlug = 'super_admin' | 'director' | 'accountant' | 'educator' | 'receptionist' | string;

const CARE = ['super_admin', 'director', 'educator', 'receptionist'] as const;
const FINANCE = ['super_admin', 'director', 'accountant'] as const;
const ADMIN = ['super_admin', 'director'] as const;
const ALL_STAFF = ['super_admin', 'director', 'educator', 'receptionist', 'accountant'] as const;

/** Rôles (slug) autorisés à VOIR chaque écran. Une route absente = tout le personnel. */
export const ROUTE_ROLES: Readonly<Record<string, readonly string[]>> = {
  '/': ALL_STAFF,               // dashboard.controller STAFF_ROLES
  '/attendance': CARE,          // attendance.controller STAFF_ROLES
  '/journal': CARE,             // journal.controller STAFF_ROLES
  '/media': CARE,               // media.controller STAFF_ROLES
  '/messaging': CARE,           // messaging.controller STAFF_CREATE
  '/exports': FINANCE,          // exports.controller
  '/privacy': FINANCE,          // privacy.controller STAFF_ROLES (director, accountant, super_admin)
  '/payroll': FINANCE,          // payroll.controller
  '/video': ADMIN,              // video.controller VIDEO_ROLES
  '/marketplace': ALL_STAFF,    // marketplace.controller (aucun @Roles)
  '/billing': FINANCE,          // billing.controller (director, accountant) — super_admin via is_super_admin
  '/health': CARE,              // health.controller CARE_ROLES
  '/compliance': FINANCE,       // compliance.controller
  '/organizations': ['super_admin'],
  '/sites': ADMIN,              // sites.controller
  '/rooms': ADMIN,              // rooms.controller
  '/children': CARE,            // children.controller READ_ROLES
  '/staff': FINANCE,            // staff.controller READ_ROLES
  '/invitations': ADMIN,        // invitations.controller
  '/settings': ALL_STAFF,       // lit /billing/contracts : la page gère elle-même le 403
};

export interface AccessSubject {
  is_super_admin: boolean;
  memberships: Array<{ organization_id: string; role_slug: string }>;
  current_organization_id: string | null;
}

/** Slug de rôle dans l'organisation courante (première adhésion à défaut). */
export function currentRole(user: AccessSubject | null | undefined): RoleSlug | null {
  if (!user) return null;
  const m = user.memberships.find((x) => x.organization_id === user.current_organization_id) ?? user.memberships[0];
  return m?.role_slug ?? null;
}

/** Peut-on afficher l'écran `path` à `user` ? Super-admin plateforme : tout. */
export function canAccess(user: AccessSubject | null | undefined, path: string): boolean {
  if (!user) return false;
  if (user.is_super_admin) return true;
  const allowed = ROUTE_ROLES[path];
  if (!allowed) return true;
  const role = currentRole(user);
  return role !== null && allowed.includes(role);
}

/** Premier écran accessible (cible du renvoi quand une route est refusée). */
export function homeFor(user: AccessSubject | null | undefined): string {
  if (canAccess(user, '/')) return '/';
  const first = Object.keys(ROUTE_ROLES).find((p) => canAccess(user, p));
  return first ?? '/';
}
