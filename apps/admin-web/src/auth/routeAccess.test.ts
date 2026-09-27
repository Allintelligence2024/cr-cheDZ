// F3 — matrice d'accès UI (miroir des @Roles serveur). Exécuté par node --test
// (voir `npm run test:unit` dans apps/admin-web).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { ROUTE_ROLES, canAccess, canAnonymizeChild, currentRole, homeFor } from './routeAccess.ts';

const ORG = 'org-1';
const privacyPageSource = readFileSync(new URL('../pages/PrivacyPage.tsx', import.meta.url), 'utf8');
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

test('anonymisation enfant : director et super_admin seulement', () => {
  assert.equal(canAnonymizeChild(user('director')), true);
  assert.equal(canAnonymizeChild(user('super_admin')), true);
  assert.equal(canAnonymizeChild(user('accountant')), false);
  assert.equal(canAnonymizeChild(user('educator')), false);
  assert.equal(canAnonymizeChild(user('parent_primary')), false);
  assert.equal(canAnonymizeChild(null), false);
  assert.equal(canAnonymizeChild(user('educator', { is_super_admin: true })), true);
});

test('anonymisation : rôle de l’organisation courante, pas une autre adhésion', () => {
  const multiRole = {
    is_super_admin: false,
    memberships: [
      { organization_id: 'other', role_slug: 'director' },
      { organization_id: ORG, role_slug: 'accountant' },
    ],
    current_organization_id: ORG,
  };
  assert.equal(canAnonymizeChild(multiRole), false);
});

test('PrivacyPage protège le tab et n’envoie que des dossiers sortis non anonymisés', () => {
  assert.match(privacyPageSource, /const mayAnonymizeChildren = canAnonymizeChild\(user\)/);
  assert.match(privacyPageSource, /mayAnonymizeChildren \? \[\{ id: 'anonymize'/);
  assert.match(privacyPageSource, /tab === 'anonymize' && mayAnonymizeChildren && <AnonymizeChildTab \/>/);
  assert.match(privacyPageSource, /status: 'departed'/);
  assert.match(privacyPageSource, /child\.status === 'departed'/);
  assert.match(privacyPageSource, /Anonyme-\[0-9a-f\]\{8\}/);
  assert.match(privacyPageSource, /trimmedReason\.length < 5 \|\| !confirmed/);
});

test('homeFor : renvoi vers un écran accessible (jamais une boucle vers une route refusée)', () => {
  assert.equal(homeFor(user('educator')), '/');
  assert.equal(homeFor(user('accountant')), '/');
  const none = user('mystery');
  assert.equal(canAccess(none, homeFor(none)), false); // aucun écran : '/' par défaut, le serveur répond 403
});
