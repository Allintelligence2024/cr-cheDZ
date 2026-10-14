import { useAuth } from '../auth/AuthContext';

/**
 * 3.9.1 (remédiation 2026-10-05) — guard de rôle UI pour les actions
 * destructrices (suppression de média, suppression d'événement journal).
 *
 * L'API refuse déjà ces appels (@Roles('director','super_admin')), mais
 * l'UI les montrait à un `educator`/`receptionist` : bouton cliquable,
 * erreur 403 après envoi. Le guard UI masque le bouton — l'utilisateur
 * non autorisé ne voit même pas l'action possible.
 *
 * Ce n'est PAS un contrôle de sécurité (le backend reste l'autorité) :
 * c'est de la honnêteté d'interface. Ne jamais faire confiance au seul
 * role_slug côté client pour protéger une ressource.
 */

/** Rôles autorisés à détruire du contenu (média, événement journal). */
const DESTRUCTIVE_ROLES = new Set(['director', 'super_admin']);

export function canDestruct(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  if (user.is_super_admin) return true;
  // role_slug vit dans memberships[] ; on prend l'org active (même règle que
  // le backend : le JWT porte l'org + le role de cette org).
  const m = user.memberships.find((x) => x.organization_id === user.current_organization_id)
    ?? user.memberships[0];
  return !!m && DESTRUCTIVE_ROLES.has(m.role_slug);
}
