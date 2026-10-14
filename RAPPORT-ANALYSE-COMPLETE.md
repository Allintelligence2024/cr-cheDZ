# RAPPORT D'ANALYSE COMPLÈTE — cr-cheDZ (SaaS gestion de crèche, Algérie)

**Date** : 2026-10-03  ·  **Périmètre** : monorepo entier (apps/api, worker, admin-web, parent-mobile, director-mobile, staff-mobile, support-console, packages, infrastructure, tests, docs)
**Méthode** : 20 analyses profondes en parallèle, chacune lisant réellement le code (read_file/grep/exécution de gardiens) et ne rapportant que des défauts vérifiés avec preuve file:line.
**Aucune correction appliquée** — analyse uniquement, comme demandé.

---

## 1. Synthèse exécutive

Le projet est **considérable et largalement abouti sur le papier** : architecture RLS multi-tenant sérieuse, 77 migrations, ~91 suites d'isolation, sécurité réfléchie (JWT epoch, TOTP, cookies `__Host-`, upload par l'API, contenu same-origin).

**Cependant, l'analyse révèle un décalage systémique entre ce que les documents affirment et ce que le code fait réellement.** Presque chaque couché présente des défauts concrets qui contredisent les runbooks :

- **L'application directrice mobile V2 est largement non fonctionnelle** : 8 endpoints critiques appelés n'existent pas ou reçoivent un payload rejeté (encaissement, génération de factures, création d'enfant, pointage staff, incidents).
- **Le backend a des failles d'isolation cross-tenant vérifiées en base** (webhook de paiement, lookup téléphone parent, tables sans RLS).
- **Des obligations de la loi 25-11 / décret 19-253 ne sont pas implémentées** (rôle DPO inexistant, notifications ANPDP sans auteur, deadlines sans surveillance, double dose de médicament possible, notification parent jamais envoyée pour les incidents graves).
- **La CI est rouge aujourd'hui** (job `quality` en échec, `claims-contract` 7/12 rouge) et la couverture de test réelle est très faible (20/25 modules API sans test unitaire, admin-web 1 test pour 4 342 LOC).

### Décompte des 297 findings

| Sévérité | Nombre |
|---|---|
| 🔴 CRITICAL | 18 |
| 🟠 HIGH | 57 |
| 🟡 MEDIUM | 133 |
| 🟢 LOW | 89 |
| **Total** | **297** |

### Répartition par zone

| # | Zone | Crit | High | Med | Low | Total |
|---|---|---|---|---|---|---|
| 01 | API architecture & module boundaries | 0 | 0 | 4 | 5 | 9 |
| 02 | Multi-tenant isolation & RLS | 0 | 2 | 3 | 3 | 8 |
| 03 | Authentication, JWT, sessions, MFA/TOTP | 1 | 4 | 5 | 4 | 14 |
| 04 | Authorization, RBAC, guards & disclosure | 0 | 2 | 5 | 4 | 11 |
| 05 | Billing, payments, SATIM & financial integrity | 0 | 3 | 4 | 3 | 10 |
| 06 | Sync engine & offline-first architecture | 1 | 2 | 3 | 5 | 11 |
| 07 | Parent mobile app (Flutter) | 0 | 2 | 5 | 7 | 14 |
| 08 | Director mobile app V2 (Flutter) | 8 | 12 | 12 | 8 | 40 |
| 09 | Staff mobile app (Flutter offline-first) | 0 | 2 | 5 | 4 | 11 |
| 10 | Admin web console (React 19) | 0 | 3 | 6 | 4 | 13 |
| 11 | Worker & background jobs | 1 | 3 | 5 | 2 | 11 |
| 12 | DB migrations, schema & data integrity | 1 | 4 | 8 | 3 | 16 |
| 13 | Media, storage, photo consent & privacy | 0 | 2 | 5 | 2 | 9 |
| 14 | Domain business logic (journal/ratios/health) | 3 | 5 | 8 | 4 | 20 |
| 15 | Notifications & messaging | 0 | 1 | 4 | 5 | 10 |
| 16 | CI/CD, Docker, nginx & monitoring | 0 | 2 | 4 | 9 | 15 |
| 17 | Observability, errors, metrics & health | 0 | 2 | 6 | 3 | 11 |
| 18 | Test suite quality & coverage gaps | 1 | 1 | 26 | 1 | 29 |
| 19 | Packages, contracts & documentation | 0 | 1 | 10 | 9 | 20 |
| 20 | Regulatory compliance & production readiness | 2 | 4 | 5 | 4 | 15 |

---

## 2. Les 18 findings CRITICAL

### 🔴 Zone 03 — Authentification

**1. `__Host-creche_refresh` cookie avec `Path=/api/v1/auth` — tous les refresh web sont cassés en production**
- `apps/api/src/shared/auth/auth-cookies.ts:22, 36-44, 57-64`
- **Déclencheur** : `NODE_ENV=production` + navigateur conforme (Chrome/Firefox/Safari/Edge).
- **Conséquence** : le préfixe `__Host-` exige `Secure`, `Path=/` et pas de `Domain`. Avec `Path=/api/v1/auth`, le navigateur **jette le Set-Cookie** (RFC 6265 §4.1.3.1). En prod, `POST /auth/login` (web_client=true) n'installe jamais le cookie ; `POST /auth/refresh` ne le reçoit jamais → **toute la rotation de session web est morte en production**.

### 🔴 Zone 06 — Sync

**2. Le gate `generate-sync-contract --check` échoue sur ce checkout (staleness permanent)**
- `scripts/generate-sync-contract.mjs:26,50` ; `apps/api/src/modules/sync/generated/sync-contract.ts:2`
- **Cause** : le hash est calculé sur les octets bruts sans normalisation des fins de lignes ; le repo a `core.autocrlf=true` → le hash calculé sous Windows ne correspond jamais à celui commité. **La CI échoue ou le check est inopérant.**

### 🔴 Zone 08 — Application directrice mobile V2 (8 findings critiques)

**3. `POST /billing/invoices/:id/payments` — endpoint inexistant** — `lib/core/api_client.dart:164`. Les vraies routes sont `/billing/payments/cash` et `/billing/payments/online`. **Aucun paiement ne peut être encaissé depuis le mobile** (404), bien que marqué `[x] livré` dans le plan V2.3.

**4. `POST /billing/invoices/:id/mark-overdue` — endpoint inexistant** — `lib/core/api_client.dart:113`. La transition est automatique côté serveur ; le bouton renvoie un 404 permanent.

**5. `POST /billing/invoices/generate` — payload rejeté (400)** — `lib/core/api_client.dart:149`. L'app envoie `{'month':'YYYY-MM'}` mais le DTO exige `contract_id`, `period_year`, `period_month`, `due_date`. La génération mobile de factures ne fonctionne pas.

**6. `POST /children` — `site_id` obligatoire absent** — `lib/core/api_client.dart:154`. L'app envoie `birth_date` au lieu de `date_of_birth` et omet `site_id` → 400 systématique. La création d'enfant est impossible.

**7. `POST /children/:id/room-moves` — mauvaise route** — `api_client.dart:155`. La route est `/children/:id/move-room`. 404 à chaque changement de salle.

**8. `POST /journal/events` — sévérité d'incident hors whitelist** — `create_incident_sheet.dart:60-66`. L'UI envoie `low/medium/high/critical`, le backend n'accepte que `minor/moderate/serious` → **la création d'incident est entièrement non fonctionnelle**.

**9. `POST /staff/attendance/check-in` & `/check-out` — routes inexistantes** — `api_client.dart:168-169`. La route réelle est `POST /staff/:id/attendance` avec un DTO différent → 404.

**10. `POST /attendance/mark-absent` — payload invalide** — `attendance_page.dart:108`. `MarkAbsentDto` n'accepte pas `date` → 400. Le pointage d'absence échoue.

### 🔴 Zone 11 — Worker

**11. `notif_queue_finish` sans fencing + drain sans transaction → double envoi**
- `apps/worker/src/main.ts:431-488` ; `migrations/054:10-18`, `043:8-29`
- **Conséquence** : le finish fait `UPDATE ... WHERE id=p_id` sans vérifier `status='processing'` ni le token de bail. Si `notif_queue_reclaim` rejoue une ligne (batch > 300 s, crash, deux workers), **la notification est envoyée deux fois** et le statut est écrasé.

### 🔴 Zone 12 — Base de données

**12. `auth_parent_lookup_by_phone` — garde d'appartenance tenant absente (bypass RLS cross-tenant)**
- `infrastructure/database/migrations/025_parent_phone_lookup.sql:12-20`, appelée par `auth.service.ts:258, 282`
- **Conséquence** : la fonction est `SECURITY DEFINER` (BYPASSRLS) et son `EXISTS (SELECT 1 FROM guardians g WHERE g.user_id = u.id)` n'a **aucun filtre `organization_id`**. Un numéro de téléphone parent d'une crèche A permet donc d'identifier l'utilisateur et ses gardiens de **toutes les crèches** — fuite cross-tenant à l'étape de login.

### 🔴 Zone 14 — Logique métier

**13. `decide()` crée un enfant sans contrôle de capacité (décret 19-253 art. 4)**
- `apps/api/src/modules/enrollment/enrollment.service.ts:140-165`
- `children.service.ts:123` et `import.service.ts:80` appliquent `assertCapacity`, mais **`decide()` ne l'appelle pas** → un enfant est créé au-delà des plafonds établissement et site.

**14. `recordAdministration` ne vérifie pas l'unicité → double dose de médicament possible**
- `apps/api/src/modules/health/health.service.ts:225-255`
- Aucune contrainte d'unicité sur `(authorization_id, administered_at::date)` dans `medication_administrations`. Deux saisies (double device, HTTP + sync offline) enregistrent **deux administrations distinctes pour la même dose** — conséquence médicale directe pour un enfant.

**15. Aucune notification parent pour les administrations de médicaments et incidents graves**
- `health.service.ts:246-253` ; `journal.service.ts:194-220`
- Les colonnes `parent_notified` et `incident_notified` sont `NOT NULL DEFAULT false` et **ne sont jamais écrites**. `recordAdministration` n'appelle jamais `NotificationsService`. `insertEvent` ne notifie que pour `{'meal','nap_end','incident'}` — mais pour les incidents, `incident_notified` reste à false.

### 🔴 Zone 18 — Qualité de test

**16. C1 — 20 modules API sur 25 n'ont AUCUN test unitaire** ; **C2 — le seuil de couverture Jest est un plancher de 1 %, donc inopérant** ; **C4 — worker : 1 spec pour 1 191 LOC** ; **C5 — `scripts/check-preview-roles.mjs` est un gardien orphelin (rouge, confirmé par le dépôt lui-même)**.

### 🔴 Zone 20 — Conformité

**17. Le rôle DPO, prévu par la matrice d'autorisation et exigé par la DPIA, n'existe pas**
- `seeds/003_roles_permissions.sql:6-14, 57, 70` ; `docs/regulatory/DPIA-VIDEOSURVEILLANCE.md:52, 83, 107, 143`
- Le seed déclare « audit/privacy : DPO uniquement » et prive le `director` de ces permissions, mais **aucun rôle `dpo` n'est créé** dans les 7 rôles système → les fonctions privacy/audit ne sont accessibles par **personne**.

**18. Permissions RBAC granulaires calculées en base mais jamais vérifiées par l'application**
- `seeds/003_roles_permissions.sql:16-104` ; `apps/api/src/shared/guards/roles.guard.ts`
- La table `permissions` et la matrice `role_permissions` existent, mais recherche `PermissionsGuard|@Permissions|hasPermission` dans `apps/api/src` → **0 résultat**. L'autorisation repose uniquement sur le slug de rôle du JWT. La matrice est une déclaration sans effet.

---

## 3. Les 57 findings HIGH (résumé)

### 🟠 02 — Multi-tenant isolation & RLS

- **Quatre tables tenant utilisent encore le cast direct `current_setting('app.tenant_id', true)::uuid` au lieu de l'helper `app_tenant_id()` — régression silencieuse du correctif de la migration 018** — 
  - `''::uuid` lève `ERROR 22P02 invalid input syntax for type uuid` sur **toute**
- **`scripts/check-rls-usage.mjs` n'audit que `apps/api/src` — le worker (`apps/worker/src`) échappe entièrement au garde anti-bypass RLS** — 
  - la garantie « tout accès pool brute ne porte que sur une fonction SECURITY

### 🟠 03 — Authentication, JWT, sessions, MFA/TOTP

- **`device_id` is never validated when a session is created — sessions can be attributed to arbitrary, foreign, or non-existent devices** — 
  - - Files: `auth.service.ts:141-147` (login), `:339-345` (refresh), `:486-489` (accept-invitation), `:524-530` (issueTokenPair); `sessions.service.ts:36-50`; DTOs `dto/auth.dto.ts:16-18`, `:45-47`, `:13
- **Epoch trigger `trg_g4_users_epoch` creates a TOCTOU window: the epoch read at signing can differ from the epoch the guard reads** — 
  - - Files: `infrastructure/database/migrations/062_principal_token_epoch.sql:61-71`; `auth.service.ts:509-546` (`issueTokenPair`), `:635-670` (`consumeTotp`), `:742-764` (`signAccessToken`), `:133-139` 
- **Parent OTP and parent-PIN channels never count TOTP failures toward account lockout** — 
  - - Files: `auth.service.ts:266` (OTP gate), `:293` (PIN gate), `:620-626` (`requireTotpGate`), `:635-670` (`consumeTotp`); rate limits `auth.controller.ts:48`, `:62`; `infrastructure/nginx/nginx.conf:1
- **`verifyParentOtp` consumes the one-time OTP before the TOTP gate, so a failed second factor burns the primary proof for free** — 
  - - File: `auth.service.ts:240-267` (`verifyParentOtp`), `:278-295` (`loginParentPin`), `:250-254` (OTP consume), `:197` (OTP request) - Triggering condition: A valid OTP is submitted with a wrong/missi

### 🟠 04 — Authorization, RBAC, guards & disclosure

- **H1 — `inventory-route-guards.mjs` ignore les décorateurs au niveau classe : 49 faux positifs** — 
  - le script d'audit des routes sans garde produit une sortie majoritairement fausse.
- **H2 — `GET /feature-flags` : aucune garde de rôle (lecture admin accessible à tout rôle authentifié)** — 
  - énumération de la configuration de fonctionnalités de l'organisation : clés de flags,

### 🟠 05 — Billing, payments, SATIM & financial integrity

- **F1 — La ligne « Garde mensuelle » contient le sous-total complet, pas la base de garde → les lignes ne s'additionnent plus au sous-total** — 
  - la somme des `invoice_lines.total_price` dépasse `invoices.subtotal` d'exactement
- **F2 — Le webhook de paiement confirme la facture de N'IMPORTE QUELLE organisation (pas de vérification de tenant)** — 
  - **vérifié en base** (rôle `creche_app_test` NOBYPASSRLS, tenant A posé) :
- **F3 — `payroll_lines` est mutable après finalisation : le trigger 072 ne couvre pas les lignes** — 
  - **Fichier** : `infrastructure/database/migrations/072_payroll_finalized_immutable.sql:102-104`  ```sql CREATE TRIGGER trg_payroll_entry_finalized   BEFORE UPDATE OR DELETE ON payroll_entries     -- ← 

### 🟠 06 — Sync engine & offline-first architecture

- **Purge `sync_retention_purge` non branchée à aucun planificateur — le `sync_changelog` croît sans borne** — 
  - la table `sync_changelog` (une ligne par écriture métier : présence, journal, enfant,
- **Après purge de `sync_changelog`, le pull renvoie une page « vide » et le client avance son curseur au-delà des événements perdus** — 
  - perte d'événements silencieuse et indétectable pour les devices à longue reconnexion —

### 🟠 07 — Parent mobile app (Flutter)

- **Aucune restauration de session au démarrage — `lib/main.dart:38,61-66`** — 
  - `_authenticated` est initialisé à `false` en dur et `main.dart` ne consulte
- **`SessionStore` est du code mort complet — `lib/core/session_store.dart:1-27`** — 
  - 27 lignes (classe + 3 méthodes) sans **aucun** import, référence ou appel dans

### 🟠 08 — Director mobile app V2 (Flutter)

- **9. `GET /staff/profiles` — route inexistante (c'est `/staff`)** — 
  - - **Fichier** : `lib/core/api_client.dart:125` - **Déclencheur** : à chaque ouverture de l'onglet Personnel (`staff_page.dart:54`) et du bottom sheet de pointage. - **Conséquence** : La route est `GET
- **10. `GET /auth/me` — route inexistante (c'est `/me`)** — 
  - - **Fichier** : `lib/core/api_client.dart:106` (`me()`), appelé par `lib/features/settings/settings_page.dart:35` - **Déclencheur** : ouverture de "Paramètres". - **Conséquence** : La route profil est
- **11. `GET /organizations/me` et `/organizations/me/settings` — routes inexistantes** — 
  - - **Fichier** : `lib/core/api_client.dart:144` (`orgSettings`) et `:145` (`orgDetails`), `orgDetails` utilisé par `settings_page.dart:36` - **Déclencheur** : ouverture de "Paramètres" (orgDetails) ; o
- **12. `GET /billing/invoices?status=...&page=...&limit=...` — filtres ignorés côté backend** — 
  - - **Fichier** : `lib/core/api_client.dart:111-115` - **Déclencheur** : changement du filtre statut (Tous/Envoyées/En retard/…) sur la page Facturation. - **Conséquence** : `listInvoices(childId?)` ign
- **13. `GET /journal/events` — `child_id` obligatoire et `event_type` ignoré** — 
  - - **Fichier** : `lib/core/api_client.dart:130-134` (`journalEvents`), `lib/features/journal/journal_page.dart:44` - **Déclencheur** : ouverture de l'écran Journal (plusieurs fois par jour). - **Conséq
- **14. `GET /attendance/summary` — l'UI lit la mauvaise clé (`rooms` vs `items`)** — 
  - - **Fichier** : `lib/features/attendance/attendance_page.dart:102` - **Déclencheur** : ouverture de l'onglet Présences. - **Conséquence** : `summary()` renvoie `{date, items: [...]}` où chaque item es
- **15. Écran Facturation : `aged_balance` — clés des tranches incompatibles (affichage 0 partout)** — 
  - - **Fichier** : `lib/features/billing/billing_page.dart:151-157` (`_AgedBalanceCard`) et `lib/features/dashboard/widgets/billing_chart.dart:18-21` - **Déclencheur** : affichage de la balance âgée (das
- **16. Écran Attestations : clés de réponse incompatibles** — 
  - - **Fichier** : `lib/features/attestations/attestations_page.dart:60-66` - **Déclencheur** : ouverture de "Attestations". - **Conséquence** : Le service renvoie `child_first_name`/`child_last_name` (a
- **17. Écran Notifications : l'UI lit `title`/`body`, le backend renvoie `title_fr`/`body_fr`** — 
  - - **Fichier** : `lib/features/notifications/notifications_page.dart:63-67` - **Déclencheur** : ouverture de "Notifications". - **Conséquence** : `inbox()` renvoie `title_fr, title_ar, body_fr, body_ar
- **18. Écran Staff : `site_name` et `role` lus mais absents de la réponse** — 
  - `staff.service.ts:28-44` renvoie `qualification`, `employee_number`, `first_name`, `last_name`, `active_assignments` — **pas de `site_name`, pas de `role`**. La ligne affiche donc `qualification` + " — " (suffixe vide). Dégrade l'UX sans casser.
- **19. Org switch : fonctionnalité inerte (le "switch" n'existe pas)** — 
  - - **Fichier** : `lib/features/org_switch/org_switch_page.dart:52-57` - **Déclencheur** : tap sur une organisation de la liste. - **Conséquence** : Le tap affiche seulement un SnackBar "à implémenter c
- **20. Cache offline Drift : code mort — `DirectorCacheDb` et `DirectorDatabase` jamais instanciés** — 
  - - **Fichier** : `lib/core/database/app_database_drift.dart:44` (`DirectorCacheDb`), `lib/core/database/app_database.dart:12` (`DirectorDatabase`) - **Déclencheur** : permanent (feature manquante). - *

### 🟠 09 — Staff mobile app (Flutter offline-first)

- **Le rafraîchissement de session est mort : 401 → blocage définitif sans re-login** — 
  - **Fichier :** `lib/core/network/api_client.dart:21-39` + `lib/core/auth/auth_service.dart:21-49` + `lib/core/sync/sync_engine.dart:118`  **Déclencheur :** l'access token JWT expire (durée de vie norma
- **`MediaUploader` n'est appelé par aucun écran : le chemin photo de l'app n'existe pas** — 
  - **Fichier :** `lib/core/media/media_uploader.dart:66` (non référencé) ;  **Déclencheur :** exécution normale de l'app.  **Conséquence :** `uploadPhoto()` n'est appelé de nulle part (vérifié : les seul

### 🟠 10 — Admin web console (React 19)

- **Boutons « action destructive / irréversible » sans guard de rôle côté UI** — 
  - **— `src/pages/MediaPage.tsx:96-97` ; `src/pages/JournalPage.tsx:110-113`**  - **Trigger :** un utilisateur dont le rôle est `educator` ou `receptionist` ouvre la page Media ou   Journal (toute la pag
- **`AttendancePage` envoie `action: 'correct'` — valeur jamais acceptée par le DTO serveur** — 
  - **— `src/pages/AttendancePage.tsx:82-85` vs `apps/api/src/modules/attendance/dto/*.ts:41-56`**  - **Trigger :** l'utilisateur remplit le motif de correction et clique sur « Confirmer ». - **Consequenc
- **`MediaPage` : `all_consents_checked` non affiché — l'opérateur valide à l'aveugle** — 
  - **— `src/pages/MediaPage.tsx:16, 88-93`**  - **Trigger :** un média a `all_consents_checked = false` (photo contenant un enfant sans   consentement photo valide). - **Consequence :** la colonne « Visi

### 🟠 11 — Worker & background jobs

- **outbox_events : table promise, indexée, RLS — mais aucun producteur ni consommateur** — 
  - — grep sur `INSERT INTO outbox_events` / `published_at` dans `apps/api/src`,
- **scheduler_enqueue_due : sonde anti-doublon non verrouillée → deux jobs identiques possibles** — 
  - — la boucle verrouille bien `scheduler_ticks` (`FOR UPDATE SKIP LOCKED`, ligne 45), mais
- **video_clips_purge : suppression du stockage avant la ligne, hors transaction → ligne orpheline au crash** — 
  - — l'objet stockage est détruit mais la ligne `video_clips` reste, avec un `storage_key`

### 🟠 12 — DB migrations, schema & data integrity

- **2. [HIGH] `users.email` / `users.phone` UNIQUE interdisent toute réinscription après suppression logique** — 
  - **Fichier :** `infrastructure/database/migrations/003_users_and_security.sql` — `email TEXT UNIQUE`, `phone TEXT UNIQUE`  **Déclencheur :** un utilisateur supprimé logiquement (`deleted_at`, `status='
- **3. [HIGH] `compliance_rule_sets` / `compliance_rules` créées sans RLS alors qu'elles portent des données par organisation** — 
  - **Fichier :** `infrastructure/database/migrations/013_compliance.sql`  **Déclencheur :** n'importe quelle requête du rôle applicatif sur ces tables (`grants.sql` accorde `SELECT, INSERT, UPDATE, DELET
- **4. [HIGH] `payments.external_reference` UNIQUE global et recherche webhook non filtrée par tenant** — 
  - **Fichier :** `infrastructure/database/migrations/010_billing.sql:93` — `external_reference TEXT UNIQUE` ; `052_fix_webhook_amount_guard.sql` / `066_payment_register_site.sql` — fonction `billing_webh
- **5. [HIGH] `current_setting('app.tenant_id', true)::uuid` brut réintroduit après la migration 018 qui l'avait explicitement éliminé** — 
  - **Fichiers :** `infrastructure/database/migrations/029_phase10_privacy_support.sql` (3 tables), `068_invoice_reminders.sql`, `069_attestations.sql`, `070_contracts_waitlist_staff_schedule.sql` (2 tabl

### 🟠 13 — Media, storage, photo consent & privacy

- **H1 — Le parent peut lire une photo via le chemin staff `/media/:id/content`, qui ignore la filiation et le consentement** — 
  - contournement total des gardes du portail parent (`assertPhotoAllowed` :
- **H2 — `photoUrl()` appelle `MediaService.downloadUrl()`, ce qui journalise un accès *avant* que le parent ne lise réellement la photo** — 
  - 1. **Double journalisation** systématique pour chaque photo consultée → le carnet d'accès

### 🟠 14 — Domain business logic (journal/ratios/health)

- **`event_date` du journal forcé à la date serveur, ignorant `occurred_at` — events offline rangés au mauvais jour** — 
  - — `apps/api/src/modules/journal/journal.service.ts:193-220` — Déclencheur : sync offline (`sync.service.ts:299-341`) ou HTTP avec `occurred_at` à une date passée (ex. événement saisi la veille hors li
- **`AGE_CRECHE` (3 mois → 3 ans, décret 19-253 art. 3) jamais enforced à la saisie ni à l'import, et systématiquement rétrogradé en `warning`** — 
  - — `apps/api/src/modules/children/children.service.ts:119-161`, `apps/api/src/modules/children/import.service.ts:125-161`, `apps/api/src/modules/compliance/compliance.service.ts:118-123` — Déclencheur 
- **Dépassement de capacité de salle (`CAPACITY_EXCEEDED`) jamais tracé dans `compliance_checks` — seule la règle RATIO_EDUC l'est** — 
  - — `apps/api/src/modules/attendance/ratios.service.ts:104-115` + `recordBreach` lignes 132-151 — Déclencheur : check-in d'un enfant alors que `children_present > room.max_capacity`. — Conséquence : `re
- **Ratios calculés sur la salle d'affectation statique de l'enfant, pas sur la salle réellement pointée** — 
  - — `apps/api/src/modules/attendance/ratios.service.ts:80-82` — Déclencheur : enfant affecté à la salle A (rooms) mais pointé sur le site B / accueillí dans une autre salle (changement de salle temporai
- **Attestation : `total_paid` peut dépasser `total_invoiced` → violation du `CHECK` de la migration 069 → `issue()` tombe en 500** — 
  - — `apps/api/src/modules/attestations/attestations.service.ts:27-52`, contrainte dans `infrastructure/database/migrations/069_*.sql:24` — Déclencheur : enfant ayant un surpaiement (note de crédit mal s

### 🟠 15 — Notifications & messaging

- **Les notifications push et WhatsApp ne sont JAMAIS envoyées en arabe** — 
  - `notifications.service.ts` calcule et stocke soigneusement `title_ar`/`body_ar`

### 🟠 16 — CI/CD, Docker, nginx & monitoring

- **D1 — BLOQUANT : le job `quality` échoue (gardien orphelin)** — 
  - **Preuve d'exécution** (pas une lecture de code) :  ``` $ node scripts/check-guards-wired.mjs ✗ 1 gardien(s) que rien n'appelle en CI :   - scripts\check-preview-roles.mjs $ echo $? 1 ```  - Le job `q
- **D2 — BLOQUANT : sauvegarde production silencieusement corrompue** — 
  - `infrastructure/docker/docker-compose.prod.yml:338-352` — entrypoint inline du conteneur `backup` :  ```sh /bin/sh -c " apk add --no-cache gnupg >/dev/null 2>&1 while true; do   STAMP=$$(date +%F)   p

### 🟠 17 — Observability, errors, metrics & health

- **`GET /api/v1/health` est un health check trivial — aucune dépendance n'est vérifiée** — 
  - l'endpoint renvoie toujours `{ status: 'ok', version:
- **Sonde de vivacité worker : un marqueur frais même avec un pool DB mort** — 
  - `startLiveness()` écrit le marqueur via un `setInterval`

### 🟠 18 — Test suite quality & coverage gaps

- **** — 
  - 

### 🟠 19 — Packages, contracts & documentation

- **claims-contract.test.mjs : 7/12 tests échouent — le garde-fou de véracité documentaire est rouge** — 
  - ce test est la défense déclarée contre le « regonflage

### 🟠 20 — Regulatory compliance & production readiness

- **Notification ANPDP jamais attribuée à un acteur (audit incomplet)** — 
  - l'acte règlementaire de notifier l'ANPDP (loi 25-11 — délai de 5 jours)
- **`ANPDP_EMAIL` documenté comme secret à fournir, mais jamais lu par le code** — 
  - la valeur est **ignorée** — le destinataire réel est `SMTP_TO`
- **Aucune surveillance des échéances règlementaires (5 j ANPDP, 30 j droits, 365 j DPIA)** — 
  - les délais sont **enregistrés** mais rien ne signale leur dépassement —
- **Acquisition des clips vidéo inexistante — la chaîne DPIA est complète sauf l'entrée des données** — 
  - le registre caméras et le visionnage existent, mais **il n'y a aucun moyen

---

## 4. Points à discuter (décisions de design)

1. **Vérité documentaire vs code** : `claims-contract.test.mjs` est rouge 7/12 et 5 findings documentaires HIGH/MEDIUM montrent que les docs (README, SECURITY, runbooks, plans) décrivent souvent un état qui n'est pas celui du code. Décision : faut-il geler les docs et exiger un passage des tests de claims avant merge, ou accepter que les docs soient aspiratrices ?
2. **`director-mobile` V2** : 8 endpoints critiques cassés + cache Drift mort + l10n mort + org switch inert. Il faut décider : corriger l'API client (les routes serveur semblent correctes) ou admettre que V2 n'est pas livré et re-planifier.
3. **`outbox_events`** : table promise (indexée, RLS) mais **aucun producteur ni consommateur** — le pattern transactional outbox n'est pas réellement implémenté. Décision : l'implémenter ou supprimer la table et corriger la description du worker.
4. **Arabe** : push/WhatsApp toujours en français (`main.ts:451,471`), ~45 chaînes admin-web non traduites, `l10n.dart` mort. Décision : le bilinguisme est une exigence loi 25-11 — priorité et périmètre à définir.
5. **DPO** : le rôle n'existe pas alors que la loi 25-11 l'exige pour les traitements à risque. Décision : créer le rôle + PermissionsGuard, ou assumer que la directrice assume la fonction DPO (et corriger alors le seed et la DPIA).
6. **Santé applicative** : `GET /health` est trivial (pas de check DB) et la sonde worker ne vérifie pas la base. Décision : investir dans des healthchecks profonds ou garder la supervision sur les alertes Prometheus (qui n'alertent pas l'API aujourd'hui — D4).
7. **Cookies `__Host-`** : corriger le `Path` en `/` ouvre la porte à la bonne rotation ; mais si personne n'a testé le refresh web en prod, il faut valider l'ensemble du flux après correction.
8. **CI** : job `quality` rouge (gardien orphelin `check-preview-roles.mjs`), `claims-contract` rouge, `migrate.mjs --check` jamais lancé en CI. Décision : ajouter ces gardes aux checks requis de `main` (recommandation SECURITY existante) — mais ils sont rouges aujourd'hui.
9. **Tests** : 20/25 modules API sans test unitaire, seuil Jest à 1 %. Décision : monter le seuil (par paliers) ou accepter l'isolation comme seule barrière.
10. **Vidéosurveillance** : la chaîne DPIA est complète **sauf l'entrée des données** (aucun moyen d'uploader un clip). Décision : livrer l'upload vidéo ou désactiver le flag feature jusqu'à livraison.

---

## 5. Ce qui est solide (à conserver)

- **Isolation RLS** : 64 tables tenant sur 68 ont RLS activée ET forcée avec `USING` + `WITH CHECK` ; rôle `creche_app` `NOBYPASSRLS` vérifié au boot ; helper `app_tenant_id()` immunisé contre la GUC vide.
- **Sécurité des médias** : contenu servi same-origin en flux, plus aucune URL de stockage au client, checksum SHA-256 + signature binaire sur l'upload, whitelist de types (pas de SVG/HTML), consentement photo re-vérifié à chaque lecture.
- **Conformité financière** : factures payées verrouillées par trigger C04, webhook HMAC + idempotence, fichiers PDF générés côté worker.
- **Tests d'isolation** : ~91 suites `tests/tenant-isolation` exécutées sur PostgreSQL 18 réel sous rôles de production — c'est rare et précieux.
- **Setup dev** : compose Docker complet, migrations reproductibles, seeds, gardes anti-dérive (schema-check, RLS check).

---

## 6. Recommandations de priorisation (sans rien exécuter)

**P0 — Bloquant pour la mise en production**
1. Cookie `__Host-` refresh (`Path=/`) — sinon aucune session web en prod.
2. Webhook de paiement cross-tenant (F2 + `payments.external_reference` global + `billing_webhook_apply` sans filtre tenant).
3. `auth_parent_lookup_by_phone` sans garde tenant (fuite au login parent).
4. `director-mobile` : corriger ou désactiver les 8 écrans qui appellent des endpoints inexistants.
5. `notif_queue_finish` sans fencing (double envoi de notifications).
6. Job `quality` CI rouge (gardien orphelin).

**P1 — Obligations réglementaires (loi 25-11 / décret 19-253)**
7. Rôle DPO + PermissionsGuard (ou correction de la matrice).
8. Notification parent pour administrations de médicaments + incidents graves.
9. Unicité des administrations (`recordAdministration`).
10. Surveillance des deadlines (5 j ANPDP, 30 j droits, 365 j DPIA) + auteur de la notification ANPDP.
11. Contrôle de capacité dans `decide()`.

**P2 — Intégrité & dette**
12. Tables sans RLS (`compliance_rule_sets`, `compliance_rules`, `sessions`, `audit_logs`, `data_access_logs`).
13. Cast `current_setting()` brut réintroduit dans 068/069/070 (vs helper 018).
14. `sync_retention_purge` non branchée + comportement après purge.
15. Arabe sur les canaux push/WhatsApp.
16. Healthchecks profonds + alertes API (couverture healthcheck non qualifiée : 1 seul, `postgres` Docker — pas une capacité livrée).
17. Couverture de tests (modules API, admin-web, worker).

**P3 — Hygiène**
18. Docs en désaccord avec le code (README, SECURITY, runbooks, compteurs).
19. Code mort (`SessionStore`, cache Drift, `l10n.dart`, `outbox_events`, 11 méthodes `DirectorApiClient`).
20. `inventory-route-guards.mjs` (49 faux positifs) et autres gardes bruités.

---

## 7. Détail complet par zone

Le détail exhaustif (297 findings avec preuves file:line, conditions déclenchantes et conséquences) se trouve dans les 20 fichiers d'analyse joints :

- `01-*.md` — API architecture & module boundaries
- `02-*.md` — Multi-tenant isolation & RLS
- `03-*.md` — Authentication, JWT, sessions, MFA/TOTP
- `04-*.md` — Authorization, RBAC, guards & disclosure
- `05-*.md` — Billing, payments, SATIM & financial integrity
- `06-*.md` — Sync engine & offline-first architecture
- `07-*.md` — Parent mobile app (Flutter)
- `08-*.md` — Director mobile app V2 (Flutter)
- `09-*.md` — Staff mobile app (Flutter offline-first)
- `10-*.md` — Admin web console (React 19)
- `11-*.md` — Worker & background jobs
- `12-*.md` — DB migrations, schema & data integrity
- `13-*.md` — Media, storage, photo consent & privacy
- `14-*.md` — Domain business logic (journal/ratios/health)
- `15-*.md` — Notifications & messaging
- `16-*.md` — CI/CD, Docker, nginx & monitoring
- `17-*.md` — Observability, errors, metrics & health
- `18-*.md` — Test suite quality & coverage gaps
- `19-*.md` — Packages, contracts & documentation
- `20-*.md` — Regulatory compliance & production readiness

---

*Rapport généré le 2026-10-03 à partir de l'analyse réelle du code. Aucune modification n'a été apportée au dépôt.*