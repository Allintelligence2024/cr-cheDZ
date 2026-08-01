# PLAN D'EXÉCUTION — Prochaines phases (P2 → P8)

> **Document de pilotage exécutable** — suite du [`PLAN_IMPLEMENTATION.md`](PLAN_IMPLEMENTATION.md).
> À cocher tâche par tâche. Mise à jour à chaque sprint.
> **Version** : 1.0 — 2026-08-01

---

## 0. État d'avancement (fait ✅)

### Phase 0 — Fondations du monorepo (FAITE)
- [x] Structure complète du monorepo (`apps/`, `packages/`, `infrastructure/`, `docs/`, `tests/`)
- [x] `docker-compose.dev.yml` (postgres + minio + migrate + api + worker + admin-web), staging, prod
- [x] Runner de migrations avec checksums (`scripts/migrate.mjs`) + `scripts/seed.mjs`
- [x] CI GitHub Actions (`ci.yml` : base de données + API + web) + build images Docker
- [x] ADR-000 → ADR-010 dans `docs/adr/`
- [x] Squelettes TypeScript **qui compilent** : api, worker, admin-web, support-console
- [x] Apps Flutter : README avec commande de scaffold (SDK Flutter non disponible ici)

### Phase 1 — Base de données v1 (FAITE et VALIDÉE sur PostgreSQL réel)
- [x] Migrations 001 → 014 corrigées (C01 RLS `USING`+`WITH CHECK` sur 40+ tables, C02 `sync_changelog`, C04 contraintes + triggers financiers, C06 rôle applicatif, C07 FK, C08 historiques)
- [x] Seeds : rôles/permissions, règles décret 19-253, feature flags
- [x] `schema-check.mjs` : 0 table tenant sans RLS · WITH CHECK partout · contraintes C04 · drift migrations
- [x] **GATE : `rls-behavior-check.mjs` VERT sur PostgreSQL 18** (8/8) :
  - B ne lit pas l'enfant de A · B ne peut pas insérer/modifier chez A · sans tenant → 0 ligne · INSERT sans tenant refusé · agrégats journal OK · **facture payée immuable**
- [x] Rôle applicatif `creche_app` (`NOBYPASSRLS`) documenté (`infrastructure/database/roles.sql`)

**Le GATE de l'architecture est donc vérifié en base** : les 3 règles de démarrage
(tenant injecté → `set_config`/`SET LOCAL` → aucun accès cross-tenant testé) sont prouvées.

### Phase 2 — Backend auth + tenant + audit (FAITE et VALIDÉE, sprint S2)
- [x] Login JWT (access 15 min + refresh 7 j rotatif), verrouillage 5 échecs/15 min (423)
- [x] Refresh rotatif + détection de réutilisation → révocation de toutes les sessions (401)
- [x] TOTP RFC 6238 (enable/verify/disable) — login sans code → 401 `TOTP_INVALID`
- [x] Sessions hachées, appareils + **révocation distante** (403 `DEVICE_REVOKED`)
- [x] Contexte tenant par requête via **AsyncLocalStorage** (JwtAuthGuard → TenantContextService)
- [x] Filtre d'erreurs global FR/AR + correlation_id ; AuditService + masquage PII
- [x] Migration 015 : fonctions SECURITY DEFINER (bootstrap auth sous RLS)
- [x] **Test d'isolation API : 31/31 assertions vertes** (`test:api-isolation`, CI postgres:16)
- [x] Spec OpenAPI documentée (auth, devices, me, rooms)

### Phase 3 — Organisations, invitations, sites/salles, staff, web (FAITE et VALIDÉE, sprint S3)
- [x] CRUD organisations (super_admin) + sites + salles (tenant, 404 cross-tenant)
- [x] Cycle d'invitation complet (token signé 7 j → accept → session) + 409/400
- [x] Staff : profils, documents + alerte expiration, affectations, pointage
- [x] /me (memberships + joined_at + permissions), /feature-flags
- [x] Migration 016 : fonctions SECURITY DEFINER invitations (RLS hors tenant)
- [x] Test API Phase 3 : 42/42 assertions vertes
- [x] Admin-web fonctionnel : login, i18n AR/FR RTL, écrans org/sites/rooms/staff/invitations
- [x] E2E Playwright (login) configuré + job CI

### Phase 4 — Enfants, familles, import, mobile staff (FAITE et VALIDÉE, sprint S4)
- [x] CRUD enfants (soft delete, version, audit, accès journalisé) + gardiens +
  permissions granulaires + contacts d'urgence + récupérations autorisées
- [x] reference_number séquentiel par org (migration 017)
- [x] Import CSV/XLSX : dry-run, erreurs FR/AR ligne par ligne, transaction
- [x] Changement de salle tracé (room_moves) + historique statut
- [x] Test API Phase 4 : 50/50 assertions vertes
- [x] Admin-web : page Enfants + recherche + import de fichier
- [x] staff-mobile : squelette Dart complet (Drift C09, SyncEngine, bannière,
  tests) — à matérialiser avec le SDK Flutter

### Phase 5 — Présences + synchronisation offline (FAITE et VALIDÉE, sprint S5)
- [x] Machine à états présence (expected→present→departed, absent, corrections tracées)
- [x] POST /attendance/{check-in,check-out,mark-absent,correct} + GET summary
- [x] /sync/push : idempotence event_id, appareil actif, heure appareil, PERMISSION_DENIED
- [x] /sync/pull : curseur sync_seq, lot 500, curseurs par appareil
- [x] Journal offline (log_*) + agrégats ; 200 opérations testées
- [x] Migration 018 : helper app_tenant_id() (bug GUC ''::uuid corrigé)
- [x] Test Phase 5 : 34/34 verts ; aucune régression (S2, S3, P4)
- [x] staff-mobile : curseur persisté + statuts présence + Arrivée/Départ

---

## 1. Phase 2 — BACKEND AUTH + TENANT + AUDIT (TERMINÉE ✅)

**Objectif atteint** : le GATE de l'architecture est exposé via l'API HTTP et
testé de bout en bout — aucun accès cross-tenant possible.

### Tâches (toutes faites et validées sur PostgreSQL réel)

| # | Tâche | Fichiers | Statut |
|---|---|---|---|
| 2.1 | Pool PostgreSQL global + `DatabaseModule` (`pg.Pool` + `DATABASE_URL`) | `apps/api/src/shared/database/database.module.ts`, `database.provider.ts` | ✅ |
| 2.2 | `TenantContextService` + `withTenantConnection()` (BEGIN → `set_config` → COMMIT/ROLLBACK) — **AsyncLocalStorage** (contexte par requête ; la portée REQUEST casse l'injection dans les APP_GUARD) | `apps/api/src/shared/database/tenant-context.service.ts`, `shared/context/*` | ✅ |
| 2.3 | Filtre global d'exceptions → `{ code, message_fr, message_ar, correlation_id }` ; mapping 404/403/401/423/429 + messages FR/AR | `apps/api/src/shared/filters/http-exception.filter.ts`, `shared/errors.ts` | ✅ |
| 2.4 | Module `identity` : `POST /auth/login` (bcrypt 12, verrouillage 5 échecs/15 min), `/auth/refresh` (rotation + détection réutilisation → révocation famille), `/auth/logout`, `/auth/change-password` (révoque les sessions) | `apps/api/src/modules/identity/*` | ✅ |
| 2.5 | `JwtAuthGuard` injecte `organizationId` dans le contexte tenant + `RolesGuard` + décorateurs `@Public`, `@Roles`, `@CurrentUser`, `@RateLimit` | `apps/api/src/shared/guards/*`, `shared/decorators/*` | ✅ |
| 2.6 | TOTP RFC 6238 implémenté sans dépendance (SHA-1, 6 chiffres, ±1 pas) : enable/verify/disable | `apps/api/src/modules/identity/totp.service.ts` | ✅ |
| 2.7 | Sessions (refresh haché SHA-256), appareils (`/devices`, fingerprint, FCM), **révocation distante** (appareil + sessions, `DEVICE_REVOKED` distinct de `SESSION_REUSE_DETECTED`) | `identity/sessions.service.ts`, `identity/devices.service.ts` | ✅ |
| 2.8 | `AuditService` + masquage PII (`[REDACTED]`, ADR-010) + `data_access_logs` | `modules/privacy/*`, `shared/redact.ts` | ✅ |
| 2.9 | Rate limiting applicatif par IP+route (fenêtre fixe, désactivable via `RATE_LIMIT_DISABLED` pour les tests) | `shared/guards/rate-limit.*` | ✅ |
| 2.10 | **Migration 015** : fonctions SECURITY DEFINER `auth_get_memberships` / `auth_refresh_lookup` / `auth_get_device` (bootstrap auth sous RLS) | `infrastructure/database/migrations/015_auth_functions.sql` | ✅ |
| 2.11 | **Test d'isolation API** : `tests/tenant-isolation/isolation.api.test.mjs` (31 assertions, toutes vertes) | `tests/tenant-isolation/` | ✅ |
| 2.12 | Spec OpenAPI 3.1 documentée (auth, devices, me, rooms, erreurs FR/AR) | `packages/api-contracts/openapi.yaml` | ✅ |

### Détail des corrections faites en cours de sprint
1. **AsyncLocalStorage** au lieu de Scope.REQUEST pour le contexte tenant —
   la portée REQUEST casse l'injection de `JwtService` dans les APP_GUARD
   (bug réel détecté par le test : `jwtService undefined`).
2. **Rôle applicatif obligatoire dans les tests API** : l'app se connecte en
   `creche_app_test` (NOBYPASSRLS) — en superuser, la RLS est contournée
   (preuve supplémentaire de l'importance de C06).
3. **`revoked_reason`** ajouté aux sessions (migration 003, pré-release) pour
   distinguer `DEVICE_REVOKED` (403, pas de suspicion) de
   `SESSION_REUSE_DETECTED` (401, révocation famille).
4. **Rate limiting** : `RATE_LIMIT_DISABLED=true` pour les tests
   d'intégration (10 logins/min dépassés par la suite) ; nginx reste la
   barrière de production.

### Définition of Done Phase 2 (tout est vert ✅)
- [x] POST /auth/login retourne un JWT valide ; /me fonctionne (org, rôle, permissions)
- [x] Refresh rotatif ; un refresh réutilisé → 401 `SESSION_REUSE_DETECTED` + révocation de toutes les sessions
- [x] Aucune lecture cross-tenant possible : A lit la salle de B → 404 (testé via HTTP)
- [x] Audit : login, logout, revoke journalisés — PII masquées (`[REDACTED]`)
- [x] Révocation d'appareil → accès coupé immédiatement (`DEVICE_REVOKED`)
- [x] TOTP exigé pour les comptes activés : login sans code → 401 `TOTP_INVALID`
- [x] Verrouillage après 5 échecs → 423 `ACCOUNT_LOCKED`
- [x] Corps d'erreur normalisé FR/AR + correlation_id
- [x] CI verte : `test:api-isolation` exécuté contre postgres:16 dans GitHub Actions

---

## 2. Phase 3 — Organisations, structure, personnel (TERMINÉE ✅)

### Tâches (toutes faites et validées)

| # | Tâche | Fichiers | Statut |
|---|---|---|---|
| 3.1 | CRUD organisations (super_admin : create/list/get/patch, slug unique → 409), sites, rooms (CRUD + soft delete), max_children, establishment_type, settings | `apps/api/src/modules/organizations/*` | ✅ |
| 3.2 | Invitations : lien signé JWT 7 j (`purpose='invitation'`) → user `pending` → `memberships` → acceptation (`POST /auth/accept-invitation`) → `joined_at` + session ; double invitation → 409 ; token réutilisé → 400 ; email dev loggé | `modules/organizations/invitations.*`, `identity/auth.service.ts` | ✅ |
| 3.3 | `staff_profiles` (qualification, contrat, salaire), `staff_documents` (alerte expiration `GET /staff/documents/expiring`), `staff_assignments` (une seule affectation principale active), `staff_attendance` (check_in/out upsert) | `apps/api/src/modules/staff/*` | ✅ |
| 3.4 | `GET /me` enrichi (memberships + `joined_at` + permissions par rôle), `GET /feature-flags` (global + surcharge org) | `modules/users/*`, `modules/organizations/feature-flags.*` | ✅ |
| 3.5 | **Admin-web fonctionnel** : design-system (tokens, Button, TextField, Card, Table), i18n FR/AR avec RTL, client API avec refresh rotatif, AuthContext, layout desktop + sidebar, pages Login/Dashboard/Organizations/Sites/Rooms/Staff/Invitations/AcceptInvitation | `packages/design-system`, `packages/i18n`, `apps/admin-web/src/*` | ✅ |
| 3.6 | E2E Playwright : config + spec login (2 tests) + `seed-e2e.mjs` + job CI `e2e` (postgres + API + chromium) | `apps/admin-web/playwright.config.ts`, `e2e/login.spec.ts`, `.github/workflows/ci.yml` | ✅ (CI) |
| 3.7 | **Migration 016** : fonctions SECURITY DEFINER `invite_get_membership` / `invite_upsert_membership` / `invite_accept` + `auth_get_memberships` étendue (`joined_at`) — les invitations hors contexte tenant (super_admin, acceptation publique) | `infrastructure/database/migrations/016_invitation_functions.sql` | ✅ |
| 3.8 | **Test API Phase 3** : `tests/tenant-isolation/phase3.api.test.mjs` — 42 assertions vertes | `tests/tenant-isolation/phase3.api.test.mjs` | ✅ |

### Corrections faites en cours de sprint
1. **RLS vs invitations** : le super_admin (sans tenant) et l'acceptation publique ne
   peuvent pas écrire dans `memberships` (RLS) → fonctions SECURITY DEFINER
   (migration 016), même pattern que le bootstrap auth (015). Sans cela :
   `new row violates row-level security policy`.
2. **`RolesGuard` ignorait les `@Roles` au niveau classe** (contrôleur) → lecture
   des métadonnées handler PUIS classe.
3. **`@Type(() => Number)`** nécessaire pour les query params numériques
   (validation pipe).
4. **`auth_get_memberships` étendue** avec `joined_at` (DROP + CREATE dans la
   016 — jamais d'édition de la 015 déjà appliquée, ADR-007).

### Définition of Done Phase 3 (tout est vert ✅)
- [x] Super_admin crée des organisations (slug unique 409) ; non-super_admin → 403
- [x] Cycle d'invitation complet : invite → token → accept → login actif avec rôle correct
- [x] Director crée sites + salles ; éducatrice de la même org les lit
- [x] Isolation : l'org B ne voit ni ne modifie les salles/sites de A (404 partout)
- [x] Staff : profil (non-membre → 400), documents + alerte expiration, affectation
  (une seule principale), pointage — invisibles cross-tenant
- [x] Feature flags globaux + surcharges org
- [x] Admin-web : login réel, écrans FR/AR RTL, build 60 kB gzip, typecheck vert
- [x] CI : job API + job e2e Playwright (postgres:16)

---

## 3. Phase 4 — Enfants et familles (TERMINÉE ✅)

### Tâches (toutes faites et validées)

| # | Tâche | Fichiers | Statut |
|---|---|---|---|
| 4.1 | CRUD children (soft delete, version, audit, data_access_logs sur fiche), guardians, child_guardians (permissions granulaires, un seul parent principal), emergency_contacts, authorized_pickups — **test d'isolation écrit et vert** | `apps/api/src/modules/children/*` | ✅ |
| 4.2 | Import CSV/XLSX : dry-run (0 écriture), rapport d'erreurs FR/AR ligne par ligne, commit transactionnel, gardiens liés | `apps/api/src/modules/children/import.service.ts` + `children.controller.ts` | ✅ |
| 4.3 | `reference_number` par séquence d'org (migration 017 : `org_sequences` + `next_org_sequence()` SECURITY DEFINER) | `infrastructure/database/migrations/017_children_reference.sql` | ✅ |
| 4.4 | Changement de salle tracé (room_moves) + historique statut (child_status_history) — C08 | `children.service.ts` | ✅ |
| 4.5 | **staff-mobile** : squelette Dart complet (Drift avec `siteId` C09, auth secure storage, SyncEngine avec backoff, liste enfants, bannière SyncBanner, tests widget) — matérialisable via `flutter create` (SDK absent de la sandbox) | `apps/staff-mobile/*` | ✅ (prêt) |
| 4.6 | **admin-web** : page Enfants (liste + recherche) + **import CSV/XLSX** (parser CSV maison + lib xlsx en chunk dynamique, dry-run puis commit, rapport d'erreurs) | `apps/admin-web/src/pages/ChildrenPage.tsx` | ✅ |
| 4.7 | **Test API Phase 4** : 50/50 assertions vertes (isolation, CRUD, move-room, gardiens, import, rôles) | `tests/tenant-isolation/phase4.api.test.mjs` | ✅ |

### Corrections faites en cours de sprint
1. **RLS/erreur 500** : la création d'enfant échouait (`column "slug" does not exist`
   — le slug est sur `organizations`, pas `sites`) → jointure corrigée.
2. **DTO d'import trop strict** : le pipe de validation rejetait les lignes
   invalides en 400 global → le DTO est volontairement permissif, la validation
   métier produit un rapport FR/AR ligne par ligne.
3. **`forbidNonWhitelisted` vs double paramètres de route** (`:id/guardians/:gid`) :
   les handlers avec 2 @Param rejetaient `gid`/`pid` → utilisation de
   `@Param('id')`/`@Param('gid')` directs (même correctif appliqué à staff).
4. **room_moves tracé aussi sur PATCH** (pas seulement move-room) — C08 complet.

### Définition of Done Phase 4 (tout est vert ✅)
- [x] Isolation enfants : B ne lit/modifie/supprime pas les enfants de A (404)
- [x] reference_number séquentiel par org (P4A-2026-00001…)
- [x] Accès fiche enfant journalisé (carnet 25-11)
- [x] Import : dry-run sans écriture, 2 valides + 2 erreurs rapportées FR/AR, commit réel
- [x] Admin-web : liste enfants + recherche + import CSV/XLSX (bundle 61.7 kB gzip)
- [x] staff-mobile : squelette prêt (Drift C09, SyncEngine, bannière, tests)

---

## 4. Phase 5 — PRÉSENCES + SYNCHRONISATION OFFLINE (TERMINÉE ✅)

### Tâches (toutes faites et validées)

| # | Tâche | Fichiers | Statut |
|---|---|---|---|
| 5.1 | Machine à états de présence (append-only) : expected → present → departed, mark-absent, arrivée tardive, corrections tracées ; transitions illégales → 409 `INVALID_STATE_TRANSITION` ; session_date à Africa/Algiers | `apps/api/src/modules/attendance/*` | ✅ |
| 5.2 | Endpoints : `POST /attendance/check-in`, `check-out`, `mark-absent`, `correct`, `GET /attendance/summary` (par salle/jour, défaut `expected`) | `attendance.controller.ts` | ✅ |
| 5.3 | **Sync push** : `/sync/push` — par opération : commande connue → appareil actif → dédup event_id (idempotence) → heure appareil (±5 min) → commande métier → `sync_changelog` dans la même transaction ; une opération en erreur ne casse pas le lot | `apps/api/src/modules/sync/sync.service.ts` | ✅ |
| 5.4 | **Sync pull** : `/sync/pull?cursor=&device_id=` — lot de 500, `next_cursor` = max sync_seq, curseur persisté par appareil (`sync_cursors`) ; appareil révoqué → 403 | `sync.service.ts` | ✅ |
| 5.5 | Journal offline : commandes `log_meal/log_diaper/log_nap_start/…` → `daily_log_events` + agrégats `daily_summaries` (trigger) ; `add_photo` → rejeté `NOT_IMPLEMENTED` (Phase 6) | `sync.service.ts` | ✅ |
| 5.6 | **Migration 018** : helper `app_tenant_id()` + régénération de toutes les politiques RLS — corrige le bug GUC (`''::uuid` après `set_config` local + COMMIT, découvert par les tests) | `infrastructure/database/migrations/018_rls_robust.sql` | ✅ |
| 5.7 | **Test API Phase 5** : 34/34 assertions vertes (état, idempotence 10× = 1, cross-tenant `PERMISSION_DENIED`, appareil révoqué, heure future, 200 opérations offline, pull paginé complet, isolation pull) | `tests/tenant-isolation/phase5.api.test.mjs` | ✅ |
| 5.8 | **staff-mobile** : curseur persisté (SharedPreferences), application des événements attendance (miroir local), liste avec statuts du jour + boutons Arrivée/Départ + pull-to-refresh | `apps/staff-mobile/lib/*` | ✅ (prêt) |

### Bug majeur découvert et corrigé (migration 018)
`set_config('app.tenant_id', …, true)` (local) suivi de COMMIT **laisse la GUC
créée avec `''`** sur la connexion poolée → les politiques RLS
`current_setting(…)::uuid` évaluaient `''::uuid` → erreur 500 sur toute
requête directe sur une table tenant. RESET/set_config(NULL) ne réinitialisent
pas (vérifié) → toutes les politiques utilisent désormais `app_tenant_id()`
(NULLIF(btrim(…), '')::uuid) : **safe-by-default, jamais d'erreur**.

### Définition of Done Phase 5 (tout est vert ✅)
- [x] Une éducatrice peut pointer une section (état validé, transitions illégales → 409)
- [x] Idempotence : même event_id envoyé 10× → 1 événement en base
- [x] Aucune opération cross-tenant possible (`PERMISSION_DENIED`, testé)
- [x] 200 opérations offline → toutes acceptées, pull paginé complet (203 événements)
- [x] Appareil révoqué → `DEVICE_REVOKED` ; heure appareil future → `DEVICE_TIME_AHEAD`
- [x] Journal offline → `daily_log_events` + agrégats exacts
- [x] Aucune régression : S2 (isolation), S3, P4 rejoués verts

---

## 5. Phases suivantes (résumé exécutif — détail dans PLAN_IMPLEMENTATION.md §3)

| Phase | S | Livrable clé | Critère de sortie |
|---|---|---|---|
| **P5 — Présences + sync** | ✅ FAIT | Machine à états, push/pull (curseur sync_seq), idempotence, 200 ops offline | 34/34 tests verts |
| **P6 — Journal + médias** | S6 | Événements journal, photos via URL signée MinIO, actions groupées, consentements photo | Repas groupé 12 enfants < 30 s ; 200 événements offline |
| **P7 — App parents** | S7 | OTP téléphone, fil du jour, absence 2 taps, consentements, push FCM/APNs | Push arrivée < 30 s ; isolation parent testée |
| **P8 — Facturation** | S8 | Contrats, factures mensuelles, paiements espèces, PDF worker, caisse | 422 immuable ; webhook ×3 = 1 paiement ; PDF < 5 s → **MVP** |

---

## 5. Règles d'exécution pour les prochaines phases

1. **Ordre strict** : P2 → P3 → P4 (rien en parallèle qui touche la DB ou l'auth).
2. **Test d'isolation d'abord** : pour chaque nouvelle ressource, le test cross-tenant est écrit avant le CRUD.
3. **Le GATE ne redevient jamais rouge** : tout commit qui casse `db:check-rls` ou `db:check-schema` est reverté.
4. **Flutter** : scaffolder les 2 apps dès S3 (`flutter create --org dz.creche`) pour débloquer la CI Flutter (workflow commenté dans `ci.yml`).
5. **Contrats** : toute route ajoutée ⇒ spec OpenAPI + messages FR/AR dans le même commit.
6. **Commits** : Conventional Commits, une tâche = un commit, PR ≤ 400 lignes.

---

## 6. Premier jour de la Phase 2 (ordre d'exécution)

| Heure | Action |
|---|---|
| 09:00 | Créer `DatabaseModule` + pool (`2.1`) |
| 10:00 | `TenantContextService` (`2.2`) + test unitaire du `withTenantConnection` |
| 11:30 | `JwtAuthGuard` + décorateurs (`2.5`) |
| 14:00 | `POST /auth/login` (`2.4`) — test manuel curl |
| 15:30 | `AuditService` + masquage (`2.8`) |
| 16:30 | Premier test API d'isolation (`2.10`) — 1 seul test : login A → lire enfant de B → 404 |
| 17:00 | CI verte + démo interne |

---

*Prochaine révision : à la fin de la Phase 2 (fin de la semaine 2).*
