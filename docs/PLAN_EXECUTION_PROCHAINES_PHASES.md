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

## 5. Phase 6 — JOURNAL QUOTIDIEN + MÉDIAS + NOTIFICATIONS (TERMINÉE ✅)

| # | Tâche | Statut |
|---|---|---|
| 6.1 | Journal : `POST /journal/events` (meal, nap_*, diaper, activity, temperature, note privée, incident), corrections append-only (`is_correction` + `corrects_event_id`), `GET /journal/events` (personnel) + `GET /journal/feed` (visible parents), note privée jamais dans le fil | ✅ |
| 6.2 | Actions groupées : `POST /journal/group-actions` (repas de section 12 enfants → 12 événements, même transaction) | ✅ |
| 6.3 | Notifications : `NotificationsService` (file `notification_queue` + `notification_inbox`) — incident/repas/fin de sieste/arrivée/départ → parents `can_receive_push` | ✅ |
| 6.4 | Médias : `POST /media/presign-upload` (URL signée S3/MinIO, signature locale), `POST /media` (register), `PATCH /media/:id/visibility` (**consentement photo obligatoire → 422** `CONSENT_REQUIRED`, révoqué → 422), `GET /media/:id/download` (URL signée + `media_access_logs` + `data_access_logs`), cross-tenant 404 | ✅ |
| 6.5 | Sync : `add_photo` implémenté (asset non visible par défaut), `log_incident`/`log_temperature` → journal + notifications | ✅ |
| 6.6 | Worker : boucle `background_jobs` (FOR UPDATE SKIP LOCKED, retry exponentiel) + drain `notification_queue` (stub FCM, réel en Phase 7) | ✅ |
| 6.7 | **Test Phase 6** : 40+ assertions vertes (agrégats exacts, 12 repas groupés, consentements, worker) | ✅ |
| 6.8 | Mobile : `JournalFormSheet` (tous types d'événements), `GroupActionSheet` (section), `MediaUploader` (presign → PUT → register) | ✅ (prêt) |

### DoD Phase 6
- [x] Repas groupé 12 enfants en une requête (testé) ; agrégats exacts après 60 opérations offline
- [x] Note privée hors fil parent ; incident → notification parent (file + inbox)
- [x] Photo sans consentement → 422 ; consentement révoqué → 422 ; éducatrice ne publie pas (403)
- [x] Téléchargement journalisé (media_access_logs) ; cross-tenant 404
- [x] Worker traite les jobs + draine les notifications (testé en processus réel)
- [x] Aucune régression (S2, S3, P4, P5 rejoués verts)

---

## 6. Phase 7 — APPLICATION PARENTS + NOTIFICATIONS (TERMINÉE ✅ — API + worker)

### Tâches (faites et validées sur PostgreSQL 18 réel, rôle NOBYPASSRLS)

| # | Tâche | Fichiers | Statut |
|---|---|---|---|
| 7.1 | Portail `/parent/*` : enfants (liste filtrée `can_view_journal`), fil du jour (`can_view_journal`, note privée exclue), absence (2 taps → `markAbsent`), consentements (révocation → effet immédiat), préférences notification + quiet hours, photos avec URL signée (consentement re-vérifié à chaque URL) | `apps/api/src/modules/parents/*` | ✅ |
| 7.2 | OTP téléphone (bcrypt, 10 min, usage unique, 5 essais max) + PIN haché + login PIN | `modules/identity/auth.service.ts`, migration 025 | ✅ |
| 7.3 | FCM HTTP v1 (service account) + APNs HTTP/2 direct (JWT ES256) dans le worker ; échec explicite `FCM_NOT_CONFIGURED`/`APNS_NOT_CONFIGURED` sans secret ; jamais de faux statut `sent` (`PUSH_NOT_CONFIGURED_OR_NO_DEVICE`) | `apps/worker/src/main.ts` | ✅ |
| 7.4 | **Suite `phase7-parent.api.test.mjs` : 11 cas obligatoires, tous verts** | `tests/tenant-isolation/phase7-parent.api.test.mjs` | ✅ |

### Corrections réelles faites pendant la Phase 7 (bugs détectés par les tests)
1. **Liste enfants** : l'API renvoyait les enfants d'un parent même sans `can_view_journal` → filtre ajouté (le plan exige « uniquement les enfants dont le parent est child_guardians avec can_view_journal »).
2. **Téléchargement photo** : double `@Param()` cassait la validation (400 permanent) → `@Param('childId')`/`@Param('mediaId')`.
3. **Révocation consentement INEFFECTIVE** : `photoUrl`/`setVisibility` matchaient n'importe quel ancien enregistrement `granted=true` → « dernier consentement gagne » (DISTINCT ON child_id) — une révocation coupe immédiatement les URLs.
4. **Login OTP/PIN cassé sous NOBYPASSRLS** : la recherche « user + guardian » interrogeait `guardians` (RLS) sans tenant → toujours 401 en production avec le rôle applicatif → fonction SECURITY DEFINER `auth_parent_lookup_by_phone` (migration 025).

### DoD Phase 7
- [x] 11/11 cas du GATE parent (feed, absence, photos, révocation, org B, préférences, quiet hours, OTP ×3, PIN, NOBYPASSRLS)
- [x] Aucune régression : S2, S3, P4, P5, P6 rejoués verts
- [ ] parent-mobile Flutter : squelette à compléter (SDK absent — `flutter analyze`, widget tests, golden RTL non exécutés)
- [ ] SMS OTP : Twilio implémenté mais **déclaré non configuré** (erreur `SMS_UNAVAILABLE` 503 sans secrets)

---

## 7. Phase 8 — FACTURATION (TERMINÉE ✅ — API + worker)

### Tâches (faites et validées sur PostgreSQL 18 réel, rôle NOBYPASSRLS)

| # | Tâche | Fichiers | Statut |
|---|---|---|---|
| 8.1 | CRUD contrats + GET listes/détails ; génération mensuelle idempotente (409 + index unique partiel 021) ; job `send_monthly_invoices` (worker) idempotent (ON CONFLICT DO NOTHING) | `modules/billing/*`, `apps/worker/src/main.ts` | ✅ |
| 8.2 | Paiements espèces (statut `partially_paid`/`paid`), allocations API (bornes paiement puis facture, mêmes règles que le trigger 023), reçus (`receipt_number`), détail paiement + allocations | `billing.service.ts` | ✅ |
| 8.3 | Caisse quotidienne : ouverture (409 si double), clôture (409 si double, total = somme espèces confirmés du jour/site) | `billing.service.ts` | ✅ |
| 8.4 | Webhook de paiement : HMAC-SHA256 sur corps brut (`PAYMENT_WEBHOOK_SECRET`), idempotent par `external_reference` (3× = 1 paiement), 401 signature invalide, 503 si non configuré — fonction SECURITY DEFINER `billing_webhook_apply` (migration 024) | `billing.controller.ts`, migration 024 | ✅ |
| 8.5 | PDF facture : généré par le worker (écrivain PDF réel, zéro dépendance lourde), stocké backend explicite (`STORAGE_BACKEND=local` ou `s3`), servi par endpoint autorisé (directeur/comptable + parent `can_receive_invoices`), accès journalisé (data_access_logs) | `apps/worker/src/pdf.ts`, `billing/pdf-storage.service.ts` | ✅ |
| 8.6 | Worker sous NOBYPASSRLS : claim/fin de jobs via `jobs_claim_next()`/`jobs_finish()` (SECURITY DEFINER 024, corrigées 026-028), accès données via `SET LOCAL app.tenant_id` | `apps/worker/src/main.ts` | ✅ |
| 8.7 | Accès parent lecture seule : `GET /parent/invoices`, `/parent/invoices/:id`, `/parent/invoices/:id/pdf`, `/parent/receipts`, `/parent/receipts/:id` — permission `can_receive_invoices` | `modules/parents/*` | ✅ |
| 8.8 | **Suite `phase8-billing.api.test.mjs` : 16 cas obligatoires, tous verts** | `tests/tenant-isolation/phase8-billing.api.test.mjs` | ✅ |

### Migrations ajoutées (immutables, ADR-007)
- **024** : `billing_webhook_apply` (SECURITY DEFINER), `jobs_claim_next`, `jobs_finish`, index `idx_payments_child`
- **025** : `auth_parent_lookup_by_phone` (SECURITY DEFINER — bootstrap login parent)
- **026-028** : corrections `CREATE OR REPLACE` de `jobs_claim_next` (ambiguïtés de colonnes OUT — jamais de modification des migrations déjà appliquées)

### DoD Phase 8
- [x] 16/16 cas du GATE facturation (isolation A/B, idempotence mensuelle, solde, bornes DB, immuabilité, webhook ×3, caisse ×2, PDF worker, accès parent)
- [x] Aucune régression : S2, S3, P4, P5, P6, P7 rejoués verts
- [ ] PDF bilingue AR : la composition arabe exige l'embedding d'une police GSUB (corps FR en Helvetica/WinAnsi — limitation documentée)
- [ ] Exports Excel (worker) : stub `NOT_IMPLEMENTED`
- [ ] `send_monthly_invoices` job : implémenté, non couvert par un test dédié (l'idempotence mensuelle est testée via l'API + index 021)

---

## 8. Phase 9 — ADMINISTRATION WEB COMPLÈTE (API ✅ + écrans web ✅, e2e ⏳)

### Tâches (faites et validées)

| # | Tâche | Fichiers | Statut |
|---|---|---|---|
| 9.1 | **Tableau de bord** : `GET /dashboard/summary` — présences du jour par salle (site/salle/total/présents/départs/absents/attendus) + alertes (enfants non pointés, documents expirant 30 j, factures impayées, incidents 24 h), strictement tenant-scoped | `apps/api/src/modules/dashboard/*`, `DashboardPage.tsx` | ✅ |
| 9.2 | **Présences web** : vue jour par salle, arrivée/départ/absent/correction tracée (motif obligatoire), statuts colorés | `AttendancePage.tsx` | ✅ |
| 9.3 | **Journal + modération** : liste par enfant/date, correction append-only signalée, bascule de visibilité parent par la directrice ; note privée jamais visible (422 `NOTE_IS_PRIVATE`) | `PATCH /journal/events/:id/visibility`, `JournalPage.tsx` | ✅ |
| 9.4 | **Photos** : validation visibilité parents (consentement re-vérifié), téléchargement URL signée | `MediaPage.tsx` | ✅ |
| 9.5 | **Facturation web** : contrats (création + liste), factures (génération + statuts + PDF), paiements espèces, caisse (ouverture/clôture + registres) | `BillingPage.tsx` | ✅ |
| 9.6 | **Fiche enfant** : historique `room_moves` + `child_status_history` ajouté à `GET /children/:id` | `children.service.ts`, `ChildrenPage.tsx` | ✅ |
| 9.7 | **Paramètres org + tarifs** (affichage exigé 19-253) : infos org + contrats actifs affichés | `OrgSettingsPage.tsx` | ✅ |
| 9.8 | **i18n AR/FR** : ~150 nouvelles clés (dashboard, présences, journal, photos, facturation, fiche, paramètres) ; RTL via `dir` existant | `packages/i18n/src/index.ts` | ✅ |
| 9.9 | **Performance** : pages Phase 9 en `React.lazy` — bundle principal **63,7 kB gzip** (< 250 kB) | `App.tsx` | ✅ |
| 9.10 | **E2E Playwright** : config à 2 webServer (API 3000 + Vite 4000), spec `director-flow.spec.ts` (login → pointage → facture), seed-e2e enrichi (site/salle/enfant/contrat, bug ESM `return` corrigé) | `playwright.config.ts`, `e2e/director-flow.spec.ts`, `seed-e2e.mjs` | ⏳ **écrit, non exécuté** (aucun navigateur installable dans la sandbox) |
| 9.11 | **Test d'isolation Phase 9** : `phase9-dashboard.api.test.mjs` — 7 cas (22 assertions) verts sur PostgreSQL réel NOBYPASSRLS | `tests/tenant-isolation/phase9-dashboard.api.test.mjs` | ✅ |

### DoD Phase 9
- [x] Tous les flux métier du quotidien réalisables via l'API (dashboard, pointage, journal, photos, facturation, caisse — smoke testé via proxy Vite)
- [x] Isolation : dashboard/modération/fiche de A invisibles pour B (404/vides, testé)
- [x] AR RTL : clés complètes + `dir` document-wide (golden RTL ⏳ SDK absent)
- [x] Correction de présence tracée (motif obligatoire, événements append-only Phase 5)
- [ ] Playwright e2e exécuté (bloqué : navigateur indisponible)
- [ ] Messagerie (écran web) : non implémentée (backend non implémenté)

---

## 6. Phases suivantes (résumé exécutif — détail dans PLAN_IMPLEMENTATION.md §3)

| Phase | S | Livrable clé | Critère de sortie |
|---|---|---|---|
| **P5 — Présences + sync** | ✅ FAIT | Machine à états, push/pull (curseur sync_seq), idempotence, 200 ops offline | 34/34 tests verts |
| **P6 — Journal + médias** | ✅ FAIT | Événements journal, photos via URL signée MinIO, actions groupées, consentements photo | Repas groupé 12 enfants < 30 s ; 200 événements offline |
| **P7 — App parents** | ✅ FAIT (API) | Portail `/parent/*` (feed, absence, consentements à révocation immédiate, préférences/quiet hours, photos signées), OTP téléphone + PIN, FCM HTTP v1 + APNs direct (worker) | **11/11 cas verts** sur PostgreSQL réel NOBYPASSRLS ; Flutter parent-mobile + golden RTL non exécutés (SDK absent) ; SMS Twilio déclaré non configuré |
| **P8 — Facturation** | ✅ FAIT (API + worker) | Contrats, génération mensuelle idempotente (index 021), paiements espèces, allocations bornées (trigger 023), caisse, reçus, webhook signé/idempotent (024), PDF worker (local/S3) | **16/16 cas verts** sur PostgreSQL réel NOBYPASSRLS ; PDF AR (composition arabe) et exports Excel non implémentés |
| **P9 — Admin web** | ✅ API + écrans web | Dashboard réel (présences/jour + alertes), présences (pointage + corrections), journal (modération directrice), photos (validation visibilité), facturation (contrats/factures/paiements/caisse), fiche enfant (historique), paramètres org (tarifs 19-253) — bundle 63,7 kB gzip (lazy) | **7 cas phase9 verts** sur PostgreSQL réel NOBYPASSRLS ; Playwright e2e écrit mais NON exécuté (navigateur indisponible dans la sandbox) ; messagerie non implémentée |

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
