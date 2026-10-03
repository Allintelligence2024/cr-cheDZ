# Analyse complète de l'API — défauts trouvés, corrigés et re-testés

**Date :** 2026-10-02 (round 4)
**Périmètre :** `apps/api` (services, contrôleurs, DTO, SQL) + batterie d'isolation
`tests/tenant-isolation` (76 suites) + gardiens CI.
**Commits :** `2bc5e7a` (poussé) puis `5d2e72f` (ce lot).
**Méthode :** inventaire mécanique des 204 routes et de leurs gardes, revue des
DTO/contrôleurs/services, greps ciblés (interpolations SQL, `@Body`/`@Param`/
`@Query` non validés), puis **exécution réelle** : API compilée + PostgreSQL
réel, batterie complète des suites d'isolation, et nouvelle suite `phase80`
écrite pour verrouiller les correctifs.

---

## 1. Résultat en une ligne

Six défauts confirmés — une classe unique : **une entrée invalide côté client
finissait en 500** au lieu d'un 400 (erreurs de cast PostgreSQL `22P02` /
`22008`), plus une route de configuration ouverte à tout compte authentifié et
un angle mort de l'outil d'inventaire des gardes. **Tout est corrigé, testé et
poussé.** Aucune injection SQL, aucune fuite inter-tenant, aucune régression :
la batterie reste verte (73/77 en local ; les 4 restants sont des prérequis
Gate D, rejoués verts ci-dessous).

---

## 2. Défauts confirmés et corrigés

### API-01 — UUID de chemin non validés → 500 (`22P02`)

| | |
|---|---|
| **Symptôme** | `GET /children/not-a-uuid`, `POST /devices/not-a-uuid/revoke`, `PATCH /journal/events/not-a-uuid/visibility`, `POST /staff/<uuid>/assignments/not-a-uuid/end`, `GET /members/not-a-uuid/roles`… → **500 INTERNAL_ERROR** |
| **Cause racine** | La valeur brute atteignait la requête ; PostgreSQL rejetait le cast `uuid` (`22P02`). Le filtre d'exception ne mappe que `AppError`/`HttpException` : l'erreur du driver devenait un 500 (bruit d'alerte, réessais client inutiles). |
| **Correctif** | `ParseUUIDPipe` sur les paramètres de chemin (`children`, `identity/devices`, `journal`, `parents`, `staff`, `users`) et `ParseUUIDPipe({ optional: true })` sur les filtres de requête UUID (`billing` `child_id` ×3 + `site_id`, `attestations` `child_id`). **≈25 nouveaux usages** (27 au total, 7 contrôleurs). |
| **Preuve** | `phase80` §1 : 11 routes × 400 ; §2 : 6 filtres × 400. Contrôles positifs : `/children/:uuid` → 200, `/billing/invoices?child_id=<uuid>` → 200. |

### API-02 — Dates au calendrier inexistant → 500 (`22008`)

| | |
|---|---|
| **Symptôme** | `GET /analytics/attendance?from=2026-02-31`, `/analytics/ratios?date=2026-02-31`, `/attendance/summary?date=2026-02-31`, `/staff/schedule?from=2026-02-31`, `/billing/payments/online/reconciliation?from=2026-02-31`, `POST /attendance/check-in {occurred_at:'2026-02-31T10:00:00Z'}` → **500** |
| **Cause racine** | `@IsDateString()` s'appuie sur `isISO8601` **sans mode strict** : `isDateString('2026-02-31') === true` (constaté en exécution). La date invalide passait la validation puis faisait échouer le cast `::date` / la colonne `date` (`22008`). |
| **Correctif** | Nouveau `apps/api/src/shared/validation/iso-date.ts` : `isStrictIsoDate` (même sémantique qu'`isDateString` + existence réelle du jour via `Date.UTC(an, mois, 0)`) et décorateur `@IsStrictIsoDate` de même signature. **47 décorateurs remplacés dans 10 DTO** (`analytics`, `attendance`, `billing`, `children`, `guardians`, `enrollment`, `health`, `journal`, `media`, `staff`) + la regex d'`onlineReconciliation` (`from`/`to`) remplacée par `isStrictIsoDate`. |
| **Preuve** | `phase80` §3 : 9 requêtes × 400 (dont horodatage ISO) ; contrôles positifs `/analytics/ratios?date=2026-02-28` → 200, `/analytics/attendance?from&to` valides → 200. |

### API-03 — Corps `role_id` non validé → 500

`POST /members/:userId/roles` n'avait pas de DTO : `role_id` brut atteignait la
requête (`22P02`). → `AddRoleDto { @IsUUID() role_id }`, plus `ParseUUIDPipe`
sur `:userId`. `phase80` §1 : 400 pour `role_id` invalide **et** pour `:userId`
invalide.

### API-04 — `GET /feature-flags` sans contrôle de rôle

La route (configuration du tenant : flags + surcharges) n'avait ni `@Roles` ni
`@Public` : elle était lisible par **tout compte authentifié** (l'isolation
RLS empêchait la fuite inter-tenant, mais un parent ou un stagiaire voyait la
configuration de l'organisation). → `@Roles('director', 'super_admin')`.
`phase80` §6 : éducatrice → **403**, directrice → **200**.

### API-05 — Inventaire des gardes : faux positifs (outil, pas produit)

`scripts/inventory-route-guards.mjs` ne lisait que les décorateurs de
**méthode** et ignorait les `@Roles` de **classe** — or `RolesGuard` lit
`handler ?? class`. Résultat : `organizations` (4 routes), `enrollment` (3),
`attestations` (2) et `feature-flags` (1) étaient comptées « sans garde » à
tort. → héritage classe → méthode ; **40 routes réellement sans `@Roles`**
au lieu des 50 annoncées (les 10 restantes sont triées ci-dessous, §4).

### API-06 — Nettoyage

`children.service.ts` : suppression d'un `.replace(/c\./g, 'c.')` no-op dans la
requête de comptage (aucun changement de comportement).

---

## 3. Vérifications exécutées

| Contrôle | Résultat |
|---|---|
| `npm run lint` (--max-warnings=0) | **0** |
| `npm run typecheck` (tous workspaces) | **0 erreur** |
| `npm run test:unit` | **121/121** (api) + **5/5** (worker) |
| Batterie d'isolation (garde anti-bypass + **76 suites**) | **73/77 vertes** — 4 rouges = prérequis Gate D (voir §5) |
| `phase80-input-validation` (nouvelle) | **40 assertions ✓** |
| Suites sensibles re-vérifiées | `phase64` 27 ✓, `phase67` 50 ✓, `phase79` 21 ✓ |
| `production-compose-contract` | 22/22 ✓ |
| `claims-contract` (compteurs doc/CI) | 12/12 ✓ |
| Gardiens CI (`check-env-example`, `check-e2e-skeletons`, `check-guards-wired`, inventaire routes) | ✓ |
| `npm audit --omit=dev` | **0 vulnérabilité** |

**Rejeu Gate D des 4 suites rouges** (prélude documenté : `bootstrap-roles.mjs`
puis migrations en `creche_migrator`, `PRODUCTION_ROLE_TESTS=1`) :

| Suite | Local (sans Gate D) | Rejeu Gate D |
|---|---|---|
| `phase22-audit-fixes` | ✗ « API production (spawn) démarrée » | **44 ✓ / 0 ✗** |
| `phase36-notification-revocation` | ✗ `DATABASE_ROLE_UNSAFE` | **51 ✓ / 0 ✗** |
| `phase47-invitations` | ✗ `DATABASE_ROLE_UNSAFE` | **39 ✓ / 0 ✗** |
| `phase49-storage-selection` | ✗ `DATABASE_ROLE_UNSAFE` | **49 ✓ / 0 ✗** |

Cause unique : le contrôle de démarrage exige le rôle applicatif de production
littéralement nommé `creche_app` (NOSUPERUSER/NOBYPASSRLS, sans propriété ni
appartenance). Ces 4 suites sont exécutées par le job CI après le prélude
Gate D ; en local sans ce prélude elles échouent **par construction**. Ce ne
sont **pas** des défauts produit.

---

## 4. Routes sans `@Roles` : triage (40 restantes)

| Module | Routes | Pourquoi c'est voulu |
|---|---|---|
| `parents/*` | 16 | auto-périmétrées par le lien de filiation (`u.sub` → gardien), vérifié par `phase37` (157 assertions) |
| `identity/auth` | 6 | self-service (2FA, changement de mot de passe, logout, PIN parent) sur son propre compte |
| `privacy` (demandes) | 4 | scoping par `u.role` en service (`requester_id` pour un parent, tenant pour la direction) |
| `messaging` | 4 | participant uniquement (`conversation_participants.user_id`) |
| `identity/devices` | 3 | appareils de l'utilisateur (`u.sub`) |
| `organizations/sites` + `rooms` | 4 (lectures) | référentiel du tenant, lecture pour tous les rôles, écritures `@Roles('super_admin','director')` ; RLS tenant |
| `notifications` | 2 | boîte de réception de l'utilisateur |
| `users` | 1 | `GET /me` |

Aucun accès inter-tenant n'est possible sur ces routes (RLS + scoping service).

---

## 5. Ce qui a été vérifié comme sain (fausses pistes écartées)

- **Injections SQL** : les 37 interpolations repérées sont des fragments de
  clause construits par le code (`${where}` alimenté par des `$n` paramétrés),
  ou des listes de colonnes littérales — aucune entrée utilisateur concaténée.
- **`@Body()`** : 100 % typés par une classe DTO ; `ValidationPipe` global
  `{ whitelist: true, transform: true, forbidNonWhitelisted: true }`.
- **`organization_id` fourni par le client** : uniquement deux cas
  (`invitations`, `support/flags`), tous deux contrôlés (directeur limité à son
  tenant / route `super_admin`).
- **`@Param('key')` (flag)** : clé texte validée côté service (gate DPIA), pas
  un UUID — à ne pas mettre sous `ParseUUIDPipe`.
- **`phase3` « Liste organisations → 2 »** : artefact de pollution de base
  partagée (fixtures `phase10-*`), pas un bug — DB fraîche requise.

---

## 6. Limites de la vérification (non exécutable dans cet environnement)

Non rejoués ici (déjà couverts par la CI) : pile Docker staging/dev (H1),
synchronisation Flutter (`check-staff-sync`, `test-sync-api-flutter`), piles de
monitoring Prometheus/Alertmanager, scan Trivy des images et publication GHCR.
Le job `database` de la CI exécute la batterie **après** le prélude Gate D :
c'est l'environnement de référence pour les 4 suites ci-dessus.

---

## 7. Fichiers modifiés (`5d2e72f`)

- `apps/api/src/shared/validation/iso-date.ts` **(nouveau)**
- 10 DTO : `analytics`, `attendance`, `billing`, `children`, `guardians`,
  `enrollment`, `health`, `journal`, `media`, `staff`
- 8 contrôleurs : `analytics`, `attestations`, `billing`, `children`,
  `identity/devices`, `journal`, `parents`, `staff`, `users`,
  `organizations/feature-flags`
- `apps/api/src/modules/children/children.service.ts` (no-op retiré)
- `scripts/inventory-route-guards.mjs` (héritage des gardes de classe)
- `tests/tenant-isolation/phase80-input-validation.api.test.mjs` **(nouveau)** +
  `scripts/run-isolation-suites.sh` (76 entrées) + compteurs de doc/CI
  (`ci.yml`, `HANDOFF.md`, `LOCAL-RUN.md`, `VERIFICATION_ANALYSE_2026-09-24.md`,
  `ANALYSE_PILIERS_MANQUANTS.md`)
