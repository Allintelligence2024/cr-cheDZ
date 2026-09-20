// F3 — matrice d'accès UI (miroir des @Roles serveur). Exécuté par node --test
// (voir `npm run test:unit` dans apps/admin-web).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROUTE_ROLES, canAccess, currentRole, homeFor } from './routeAccess.ts';

const ORG = 'org-1';
const user = (role: string, extra: Partial<Parameters<typeof canAccess>[0] & object> = {}) => ({
  is_super_admin: false,
  memberships: [{ organization_id: ORG, role_slug: role }],
  current_organization_id: ORG,
  ...extra,
});

test('éducateur : pas de paie/facturation/exports/vidéo, mais présence/journal/enfants', () => {
  const edu = user('educator');
  for (const p of ['/payroll', '/billing', '/exports', '/video', '/staff', '/compliance', '/invitations', '/sites', '/organizations']) {
    assert.equal(canAccess(edu, p), false, `educator ne doit pas voir ${p}`);
  }
  for (const p of ['/', '/attendance', '/journal', '/media', '/children', '/health', '/messaging']) {
    assert.equal(canAccess(edu, p), true, `educator doit voir ${p}`);
  }
});

test('comptable : finance oui, soins non', () => {
  const acc = user('accountant');
  for (const p of ['/', '/payroll', '/billing', '/exports', '/compliance', '/staff', '/privacy']) assert.equal(canAccess(acc, p), true, p);
  for (const p of ['/attendance', '/children', '/health', '/video', '/sites']) assert.equal(canAccess(acc, p), false, p);
});

test('directeur : tout sauf organisations (plateforme)', () => {
  const dir = user('director');
  for (const p of Object.keys(ROUTE_ROLES)) assert.equal(canAccess(dir, p), p !== '/organizations', p);
});

test('super-admin plateforme (is_super_admin) : tout, quel que soit le slug', () => {
  const sa = user('educator', { is_super_admin: true });
  for (const p of Object.keys(ROUTE_ROLES)) assert.equal(canAccess(sa, p), true, p);
});

test('rôle de l’organisation COURANTE (multi-adhésions), pas la première', () => {
  const u = {
    is_super_admin: false,
    memberships: [{ organization_id: 'other', role_slug: 'director' }, { organization_id: ORG, role_slug: 'educator' }],
    current_organization_id: ORG,
  };
  assert.equal(currentRole(u), 'educator');
  assert.equal(canAccess(u, '/payroll'), false);
});

test('non connecté / rôle inconnu : refus ; route non listée : autorisée', () => {
  assert.equal(canAccess(null, '/'), false);
  assert.equal(canAccess(user('mystery'), '/payroll'), false);
  assert.equal(canAccess(user('mystery'), '/whatever'), true);
});

test('homeFor : renvoi vers un écran accessible (jamais une boucle vers une route refusée)', () => {
  assert.equal(homeFor(user('educator')), '/');
  assert.equal(homeFor(user('accountant')), '/');
  const none = user('mystery');
  assert.equal(canAccess(none, homeFor(none)), false); // aucun écran : '/' par défaut, le serveur répond 403
});
