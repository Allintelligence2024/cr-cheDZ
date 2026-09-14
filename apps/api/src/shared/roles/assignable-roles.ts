import { AppError } from '../errors';

/**
 * Rôles qui ne peuvent JAMAIS être attribués par une API d'affectation
 * (invitations, multi-rôles) — audit 2026-09, finding C2.
 *
 * Le super_admin est réservé à l'initialisation de la plateforme (seed).
 * Si une affectation l'acceptait, un directeur pourrait s'octroyer (ou
 * octroyer) le rôle le plus privilégié : escalade horizontale complète.
 *
 * Garde CENTRALISÉE : tous les chemins d'attribution (invitations.service,
 * users.service.addRoleAssignment, et tout futur endpoint) doivent passer
 * par ici — c'est l'oubli de ce module voisin qui a créé le trou.
 */
const FORBIDDEN_ASSIGNMENT_ROLES = new Set(['super_admin']);

export function assertRoleAssignable(roleSlug: string): void {
  if (FORBIDDEN_ASSIGNMENT_ROLES.has(roleSlug)) {
    throw new AppError(
      'ROLE_FORBIDDEN',
      'Ce rôle ne peut pas être attribué via une invitation ou une affectation',
      'لا يمكن إسناد هذا الدور عبر دعوة أو تعيين',
      403,
    );
  }
}
