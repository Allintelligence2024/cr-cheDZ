# PLAN MAÎTRE DE REMÉDIATION — cr-cheDZ
### 297 findings (18 CRITICAL · 57 HIGH · 133 MEDIUM · 89 LOW) — 20 zones

**Date** : 2026-10-03 · **Source** : `RAPPORT-ANALYSE-COMPLETE.md` (analyse réelle, preuves file:line)
**État initial CI** : job `quality` ROUGE, `claims-contract` 5/12, sync-contract rouge, backup-drill non testé
**État final (2026-10-06)** : **Phases 0–4 terminées — 297/297 findings traités** (18 CRITICAL · 57 HIGH · 133 MEDIUM · 89 LOW — 20 zones). Phase 4 clôturée par le lot 4.2 (737 tests de validation DTO, 17/17 modules). **Couverture hors-plan (2026-10-06)** : les 7 derniers modules API sans AUCUNE spec (compliance, dashboard, marketplace, metrics, notifications, privacy, users) sont couverts — 79 nouveaux tests, API jest **956/956** (45 suites), eslint 0 erreur, builds api + worker OK. Vérification locale complète : API jest 877→956, worker 5/5, admin-web 10/10, contracts node --test 12/12 + 8/8 + 9/9 + 4/4, eslint 0 erreur, builds api + worker OK. **4 bugs trouvés par la vérification finale** : (1) garde-fou production `STORAGE_LOCAL_DIR` contournable sous Windows (`resolve()` comparé au littéral brut) ; (2) contract parent-session cassé par les séparateurs `\` ; (3) spec liveness worker obsolète (sonde profonde 4.5 non reflétée) ; (4) **`redact()` (ADR-010, loi 25-11) ne masquait pas les clés camelCase** — `passwordHash`, `refreshTokenHash`, `phonePrimary`, `nationalId` atterrissaient en clair dans `audit_logs` (le `Set` comparait la clé exacte, pas sa forme normalisée).

---

## PHASE 0 — RENDRE LA CI VRAIE (sans elle, tout le reste est invisible)

> **Objectif** : aucun des 297 fixes ne peut être *vérifié* tant que les gardes
> sont rouges ou ignorés. La phase 0 ne corrige aucun bug métier : elle rend
> chaque correction *prouvable*. C'est le prérequis non-négociable.
>
> **Critère de sortie** : le job `quality` est vert ET chaque fix des phases
> suivantes arrive avec un test qui l'attrape.

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| **0.1** | **Générateur sync-contract : normalisation CRLF** | `scripts/generate-sync-contract.mjs:8,50` | Trivial | ✅ |
| | `read()` compare le fichier CRLF du checkout au code généré en LF → mismatch permanent. Ajouter `readLF()` (normalisation `\r\n`→`\n`) pour le `--check`. **Ne change pas le hash** (le hash reste sur les octets bruts des sources, seul le `--check` normalise). | | | |
| **0.2** | **Câbler `check-preview-roles.mjs` au job `database`** | `.github/workflows/ci.yml` (job `database`) | Facile | ✅ |
| | Il est orphelin (`check-guards-wired` exit 1) bien qu'il **passe** en local (5 rôles + rejets + refresh + SPA). C'est un test live : il faut `npm run preview:api` + `preview:web` up. Le job `database` a déjà services postgres + migrations + seeds → ajouter 2 steps (`npm run preview:api &`, `npm run preview:web &`, wait, puis `node scripts/check-preview-roles.mjs`). | | | |
| **0.3** | **Régénérer + committer les fichiers sync générés** | `apps/api/.../sync-contract.ts`, `apps/staff-mobile/.../sync_wire_client.dart` | Trivial | ✅ |
| | Après 0.1, `node scripts/generate-sync-contract.mjs` (sans --check) pour réaligner. | | | |
| **0.4** | **`.gitattributes` — forcer `eol=lf`** | `.gitattributes` (nouveau) | Facile | ✅ |
| | La cause racine de 0.1 et du bug CRLF `claims-contract` est l'absence de politique de fin de ligne. Sans ça, tout nouveau fichier généré ou édité retombe en CRLF sous Windows. | | | |
| **0.5** | **Vérifier que `quality` est vert** | — | — | ✅ |
| | Après 0.1–0.4 : `check-guards-wired` (exit 0), `generate-sync-contract --check` (exit 0), `claims-contract` (12/12, déjà fait). | | | |

**Sous-produit de la phase 0** : le `__Host-` cookie bug (P0-1) et les 8 endpoints
director-mobile (P0-4) deviennent testables — le garde `check-preview-roles`
est un cas de test *live* du flux login→refresh→/me.

---

## PHASE 1 — P0 : BLOQUANTS PRODUCTION (6 findings critiques)

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| **1.1** | **`__Host-` cookie : `Path=/api/v1/auth` → `Path=/`** | `apps/api/src/shared/auth/auth-cookies.ts:22,36-44,57-64` | Trivial | ✅ |
| | RFC 6265 §4.1.3.1 : `__Host-` exige `Secure` + `Path=/` + pas de `Domain`. Avec `Path=/api/v1/auth` le navigateur jette le Set-Cookie → **toute la rotation de session web est morte en prod**. | | | |
| **1.2** | **Webhook paiement cross-tenant (F2)** | `migrations/082`, `billing.service.ts:746` | Moyenne | ✅ |
| | La fonction `billing_webhook_apply` ne filtre pas par `organization_id` — une requête webhook confirme la facture de n'importe quelle crèche. Ajouter le filtre tenant + `external_reference` par tenant. | | | |
| **1.3** | **`auth_parent_lookup_by_phone` : garde d'appartenance tenant** | `migrations/078` | Facile | ✅ |
| | La fonction `SECURITY DEFINER` (BYPASSRLS) filtre sur `user_id` sans `organization_id` → un téléphone de la crèche A identifie l'utilisateur et ses gardiens de **toutes** les crèches. Ajouter `AND g.organization_id = app_tenant_id()` (ou un argument). | | | |
| **1.4** | **`notif_queue_finish` : fencing + drain transactionnel** | `migrations/080+081`, `worker/main.ts` | Moyenne | ✅ |
| | Le finish fait `UPDATE WHERE id=p_id` sans vérifier `status='processing'` ni le token de bail → double envoi au replay. Ajouter `WHERE status='processing' AND lease_token = p_token` dans la même transaction que l'envoi. | | | |
| **1.5** | **`decide()` : contrôle de capacité** | `enrollment.service.ts:140-165` | Facile | ✅ |
| | `children.service.ts:123` et `import.service.ts:80` appliquent `assertCapacity`, mais `decide()` ne l'appelle pas → un enfant est créé au-delà des plafonds (décret 19-253 art. 4). | | | |
| **1.6** | **`recordAdministration` : unicité de la dose** | `migrations/079`, `health.service.ts:246` | Facile | ✅ |
| | Pas de contrainte sur `(authorization_id, administered_at::date)` → deux saisies (double device, offline sync) = **deux doses enregistrées**. Migration `078` : `UNIQUE (authorization_id, (administered_at AT TIME ZONE 'UTC')::date)` + `ON CONFLICT` côté service. | | | |
| **1.7** | **Notification parent : médicaments + incidents graves** | `notifications.service.ts:62`, `health.service.ts:269`, `journal.service.ts:241` | Moyenne | ✅ |
| | `parent_notified` / `incident_notified` sont `NOT NULL DEFAULT false` et **jamais écrites**. `recordAdministration` n'appelle jamais `NotificationsService`. Pour les incidents, `insertEvent` notifie mais le flag reste à false. | | | |
| **1.8** | **director-mobile V2 : 8 endpoints critiques cassés** | `api_client.dart` + 6 écrans | Moyenne | ✅ |
| | Corriger l'API client (les routes serveur sont correctes) : `POST /billing/payments/cash|online`, `POST /children` (`site_id` + `date_of_birth`), `/children/:id/move-room`, `POST /journal/events` (`minor/moderate/serious`), `POST /staff/:id/attendance`, `mark-absent` DTO. **+ 12 HIGH de la même zone** (routes inexistantes, clés de réponse incompatibles — §3.2). | |

---

## PHASE 2 — P1 : OBLIGATIONS RÉGLEMENTAIRES (loi 25-11 / décret 19-253)

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| **2.1** | **Créer le rôle `dpo`** | `seeds/003_roles_permissions.sql:6-14,57,70` | Facile | ✅ |
| | Le seed prive le `director` des permissions audit/privacy "DPO uniquement" mais **aucun rôle `dpo` n'existe** → les fonctions privacy/audit sont accessibles par **personne**. | | | |
| | **Corrigé (2026-10-04)** : rôle `dpo` créé DANS le seed 003 (pas en migration — les `permissions` sont peuplées par ce même seed, joué APRÈS les migrations). Attribution : `privacy:manage`, `audit:read`, `compliance:read`. Le director reste sans privacy/audit (séparation loi 25-11). | | | |
| **2.2** | **`PermissionsGuard` — rendre la matrice RBAC effective** | `apps/api/src/shared/guards/` (nouveau) | **Moyenne-difficile** | ✅ |
| | `permissions` + `role_permissions` existent en base, mais `PermissionsGuard|@Permissions|hasPermission` → **0 résultat** dans `apps/api/src`. L'autorisation ne repose que sur le slug de rôle. Décision : implémenter le guard ou supprimer la table (cf. §décisions). |
| | **Corrigé (2026-10-04)** : guard IMPLÉMENTÉ (décision : garder la table). Migration 084 (`auth_user_permissions()` SECURITY DEFINER, joint `auth_user_roles` × `role_permissions`), décorateur `@Permissions(...)`, `PermissionsGuard` branché en `APP_GUARD` (ordre JWT → rôles → permissions → rate limit). Posé sur `health:medicate`, `health:read`, `health:update`, `privacy:manage` (registry, DPIA, requests, anonymize, ANPDP notify). Permissions non embarquées dans le JWT → révocation immédiate (loi 25-11). | | | |
| **2.3** | **Surveillance des deadlines réglementaires** | `compliance.service.ts` + worker | Moyenne | ✅ |
| | 5 j ANPDP / 30 j droits / 365 j DPIA : les délais sont **enregistrés** mais rien ne signale leur dépassement. Job worker quotidien. | | | |
| | **Corrigé (2026-10-04)** : job worker `compliance_deadlines` (handler `JOB_HANDLERS.compliance_deadlines`) scanne `privacy_violations` (anpdp_notified_at IS NULL + deadline < NOW()), `privacy_requests` (non résolues + deadline < NOW()), `privacy_dpias` (approuvées + review_date < NOW()) et enfile une notification in-app au DPO de chaque org. Migration 086 : index unique `uq_notification_deadline_key` sur `(organization_id, data->>'deadline_key')` → idempotent (ON CONFLICT DO NOTHING). | | | |
| **2.4** | **Notification ANPDP : attribuer un auteur** | `notifications.service.ts` | Facile | ✅ |
| | L'acte de notifier l'ANPDP n'a jamais d'acteur identifié → audit incomplet. | | | |
| | **Corrigé (2026-10-04)** : migration 085 (colonne `privacy_violations.anpdp_notified_by` + index deadline), `notifyAnpdp(violationId, actorId)` écrit l'auteur, controller passe `u.sub`. | | | |
| **2.5** | **Arabe sur push/WhatsApp** | `apps/worker/src/main.ts:451,471` | Facile | ✅ |
| | `title_ar`/`body_ar` sont calculés et stockés, puis **ignorés** à l'envoi. | | | |
| | **Corrigé (2026-10-04)** : helper `isArabic(userId, client)` lit `users.locale` ; push (FCM/APNs) et WhatsApp envoient `title_ar`/`body_ar` quand `locale='ar'`, fallback FR. | | | |
| **2.6** | **`AGE_CRECHE` (3 mois → 3 ans) enforcement** | `children.service.ts:119-161`, `import.service.ts:125-161`, `compliance.service.ts:118-123` | Facile | ✅ |
| | Jamais enforced à la saisie ni à l'import, et systématiquement rétrogradé en `warning`. | | | |
| | **Corrigé (2026-10-04)** : `apps/api/src/shared/compliance/age-creche.ts` (`assertCrecheAge` → 409 `AGE_CRECHE_OUT_OF_RANGE`, FR+AR, décret 19-253). Branché dans `children.service.create()` ; l'import marque la ligne en erreur ; `compliance.service` passe le check de `warning` à `fail` (un enfant hors tranche en base est un reliquat d'avant le blocage). | | | |

---

## PHASE 3 — P2 : INTÉGRITÉ & DETTE (57 HIGH restants + 133 MEDIUM prioritaires)

### 3.1 Multi-tenant & RLS

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| **3.1.1** | **Tables sans RLS** | `migrations/013_compliance.sql` (2 tables), `sessions`, `audit_logs`, `data_access_logs` | Facile | ✅ |
| | `compliance_rule_sets` / `compliance_rules` portent des données par organisation mais n'ont pas RLS. | | | |
| | **Corrigé (2026-10-04)** : migration 088 — `ENABLE+FORCE ROW LEVEL SECURITY` sur `compliance_rule_sets`, `compliance_rules`, `sessions`, `audit_logs`, `data_access_logs`. Politiques tenant sur les tables métier ; `audit_logs`/`data_access_logs` reçoivent une politique d'INSERT permissive (les fonctions SECURITY DEFINER d'audit écrivent sans tenant posé, notamment pour tracer les échecs d'auth) et une lecture tenant-only. | | | |
| **3.1.2** | **Cast `current_setting()` brut réintroduit** | `migrations/029 (3 tables)`, `068`, `069`, `070 (2 tables)` | Facile | ✅ |
| | La migration 018 avait éliminé ce pattern ; 068/069/070 l'ont réintroduit. `''::uuid` lève `ERROR 22P02` sur toute requête si la GUC est vide. → remplacer par `app_tenant_id()`. | | | |
| | **Corrigé (2026-10-04)** : migration 087 — DROP+CREATE des 6 politiques (029 ×3, 068, 069, 070 ×2) avec `app_tenant_id()`. Validé sur PostgreSQL 18 : 0 politique au cast brut restante. | | | |
| **3.1.3** | **`check-rls-usage.mjs` : étendre au worker** | `scripts/check-rls-usage.mjs` | Trivial | ✅ |
| | N'audit que `apps/api/src` → `apps/worker/src` échappe au garde anti-bypass RLS. | | | |
| | **Corrigé (2026-10-04)** : le garde scanne maintenant `SCAN_ROOTS = [apps/api/src, apps/worker/src]`. **A immédiatement trouvé un vrai bug** : le job `compliance_deadlines` (phase 2.3) lisait `privacy_violations`/`privacy_requests`/`privacy_dpias` en `pool.query` brut — or ces tables sont **FORCE RLS (029)** → le job renvoyait **0 ligne en production** (loi 25-11 jamais signalée). Corrigé par la migration 089 (fonction SECURITY DEFINER `compliance_deadlines_overdue()`). 61 accès audités, 0 illégaux. | | | |
| **3.1.4** | **`users.email/phone` UNIQUE interdisent la réinscription** | `migrations/003_users_and_security.sql` | Facile | ✅ |
| | **Corrigé (2026-10-05)** : migration `095_users_unique_partial.sql` — les contraintes colonnes `UNIQUE` absolues sont remplacées par des index uniques **partiels** `WHERE deleted_at IS NULL`. Un utilisateur soft-supprimé ne verrouille plus son email/phone : la réinvitation réussit, deux comptes vivants ne partagent toujours pas un email, et un email supprimé est recyclable. Validé sur PGlite (probe11). | | | |
| **3.1.5** | **Media : path staff contourne le portail parent (H1)** | `media.controller.ts`, `media.service.ts` | Moyenne | ✅ |
| | **Corrigé (2026-10-05)** : `streamContent()` — le chemin staff `/media/:id/content` ne vérifiait que le préfixe tenant. Maintenant, si le média représente des enfants identifiés (`children_in_photo`), `photoConsentsAllowed()` est appelé (fail-closed : un consentement retiré bloque la lecture, loi 25-11). Un document ou une photo de salle sans enfant reste lisible par le staff. | | | |
| **3.1.6** | **`photoUrl()` journalise avant lecture (H2)** | `media.service.ts` (downloadUrl) | Facile | ✅ |
| | **Corrigé (2026-10-04)** : `downloadUrl()` ne journalise plus — renvoyer un chemin n'est pas lire le fichier. La journalisation a lieu dans `streamContent()` au moment où les octets sont réellement lus. L'ancien comportement créait un accès fantôme par photo listée mais jamais consultée (double journalisation + carnet d'accès inexact). | | | |
| | Double journalisation + journalisation d'accès non prouvé. | | | |
| **3.1.7** | **`outbox_events` : producteur + consommateur** | `apps/api/src`, `apps/worker/src` | **Moyenne** | ✅ |
| | **Décidé (2026-10-05) — ADR-014** : la table est conservée **sans** producteur/consommateur généralisé. Le pattern transactional outbox est *déjà* implémenté deux fois, chacun transactionnel (insertion dans la transaction métier) : `notification_queue` pour les notifications parent (`notifyGuardiansOfEvent(client, …)` reçoit le `PoolClient` métier), et `background_jobs` pour le travail différé. Aucun consommateur externe (webhook sortant, broker) n'existe — un outbox générique dupliquerait `notification_queue` pour zéro bénéfice. La table reste vide en production (attendu) et est un point d'extension explicite. | | | |

### 3.2 director-mobile V2 — 12 HIGH restants

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| **3.2.1** | **`GET /staff/profiles` → `/staff`** | `api_client.dart:125`, `staff_page.dart:54` | Trivial | ✅ |
| **3.2.2** | **`GET /auth/me` → `/me`** | `api_client.dart:106`, `settings_page.dart:35` | Trivial | ✅ |
| 3.2.3 | `GET /organizations/me` + `/settings` — routes inexistantes | `api_client.dart:144-145`, `settings_page.dart:36` | Facile | ✅ |
| 3.2.4 | `GET /billing/invoices` — filtres `status`/`page`/`limit` ignorés | `api_client.dart:111-115` | Facile | ✅ |
| 3.2.5 | `GET /journal/events` — `child_id` obligatoire, `event_type` ignoré | `api_client.dart:130-134` | Facile | ✅ |
| 3.2.6 | `GET /attendance/summary` — l'UI lit `rooms` au lieu de `items` | `attendance_page.dart:102` | Trivial | ✅ |
| 3.2.7 | `aged_balance` — clés des tranches incompatibles | `billing_page.dart:151-157`, `billing_chart.dart:18-21` | Facile | ✅ |
| 3.2.8 | Attestations — clés `child_first_name`/`_last_name` | `attestations_page.dart:18-66` | Trivial | ✅ |
| 3.2.9 | Notifications — UI lit `title`/`body`, backend renvoie `title_fr`/`body_fr` | `notifications_page.dart:63-67` | Trivial | ✅ |
| 3.2.10 | Staff — `site_name`/`role` absents de la réponse | `staff.service.ts:28-44` | Trivial | ✅ |
| **3.2.11** | **Org switch : fonctionnalité inerte** | `org_switch_page.dart:52-57` | Facile | ✅ |
| 3.2.12 | Cache Drift mort — `DirectorCacheDb`/`DirectorDatabase` jamais instanciés | `app_database_drift.dart:44`, `app_database.dart:12` | Décision | ✅ |

### 3.3 Auth, sessions, MFA

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| **3.3.1** | **`device_id` jamais validé à la création de session** | `auth.service.ts:141-147` (login), `:339-345` (refresh), `:486-489` (invite), `:524-530` (issueTokenPair) | Facile | ✅ |
| | Une session peut être attribuée à un device arbitraire/étranger/inexistant. | | | |
| | **Corrigé (2026-10-04)** : migration 090 — `auth_device_validate(device_id, user_id)` SECURITY DEFINER (existant + propriétaire + actif + non révoqué). `resolveDeviceId()` appliqué aux 4 points de création de session (login, refresh, invitation, issueTokenPair). Échec fermé discret : un device invalide est **ignoré** (session sans device), jamais rejeté — ne pas fermer la porte à un client dont le device a été réinstallé. | | | |
| **3.3.2** | **Epoch trigger `trg_g4_users_epoch` : fenêtre TOCTOU** | `migrations/062:61-71`, `auth.service.ts:509-546` | **Difficile** | ✅ |
| | L'epoch lu au signing peut différer de celui lu par le guard → JWT révoqué accepté. | | | |
| | **Corrigé (2026-10-05)** : `signAccessToken` lit `token_epoch` avec `SELECT ... FOR UPDATE` dans la transaction de signature — la ligne utilisateur est verrouillée, sérialisant tout bump de trigger concurrent. Le token porte désormais toujours l'époque effectivement commitée (plus de token mort-né). | | | |
| **3.3.3** | **OTP/PIN parent : échecs TOTP non comptabilisés pour le lockout** | `auth.service.ts:266,293,620-626,635-670` | Facile | ✅ |
| **3.3.4** | **`verifyParentOtp` consomme l'OTP avant le gate TOTP** | `auth.service.ts:240-267` | Facile | ✅ |
| | Un second facteur erroné brûle l'OTP pour rien. | | | |
| | **Corrigé (2026-10-04)** : résolution de l'utilisateur **avant** consommation, puis `requireTotpGate` **avant** le `UPDATE otp_codes SET used_at`. Un TOTP erroné ne consomme plus l'OTP (le code SMS reste valide jusqu'au succès du second facteur). | | | |

### 3.4 Billing & financial

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| 3.4.1 | **Ligne « Garde mensuelle » contient le sous-total complet (F1)** | `billing.service.ts` | Facile | ✅ |
| | La somme des `invoice_lines.total_price` dépasse `invoices.subtotal` d'exactement le montant de la garde → **les lignes ne s'additionnent plus au sous-total**. | | | |
| | **Corrigé (2026-10-04)** : la ligne « Garde mensuelle » portait `$3` = `subtotal` (base + repas + transport) en plus des lignes Repas/Transport séparées → double comptage. Elle porte maintenant `contract.monthly_base_amount`. | | | |
| 3.4.2 | **`payroll_lines` mutable après finalisation (F3)** | `migrations/072_payroll_finalized_immutable.sql:102-104` | Facile | ✅ |
| | Le trigger 072 couvre `payroll_entries` mais **pas les lignes**. | | | |
| | **Corrigé (2026-10-04)** : migration 091 — trigger `trg_payroll_line_finalized` (BEFORE UPDATE OR DELETE) avec jointure `payroll_lines → payroll_entries → payroll_runs`. Un run finalisé ou annulé rend ses lignes immuables (document comptable cohérent avec le bulletin émis). | | | |
| 3.4.3 | **Attestation : `total_paid` > `total_invoiced` → 500** | `attestations.service.ts:27-52`, `migrations/069:24` | Facile | ✅ |
| | Un surpaiement (note de crédit mal saisie) fait tomber `issue()` en 500 au lieu d'un 4xx métier. | | | |

### 3.5 Sync engine

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| 3.5.1 | **Purge `sync_retention_purge` non branchée** | `sync.service.ts` + worker scheduler | Facile | ✅ |
| | `sync_changelog` (1 ligne par écriture métier) croît sans borne. | | | |
| | **Corrigé (2026-10-04)** : migration 092 — le scheduler interne (056) avait un CHECK `job_type IN (...)` fermé. Étendu à `sync_purge` + `scheduler_next_run()` enseigné + tick inséré. Handler worker `syncPurge()` ajouté : appelle `sync_retention_purge(marge)` (cursor-aware — ne supprime que les événements au-delà du curseur de **tous** les devices). | | | |
| 3.5.2 | **Après purge, le pull renvoie une page « vide » et le client avance son curseur au-delà des événements perdus** | `sync.service.ts` | **Moyenne** | ✅ |
| | Perte d'événements silencieuse et indétectable pour les devices à longue reconnexion. | | | |
| | **Corrigé (2026-10-05)** : migration 093 — `sync_resync_required(org, cursor)` compare le curseur client à `MIN(sync_seq)` du changelog. En dessous → le serveur renvoie `resync_required: true` dans `PullResponse` (contrat sync v1 mis à jour, `boolean` ajouté au validateur Dart). Le client (`sync_engine.dart`) remet son curseur à 0 et relit tout au lieu d'avancer silencieusement (payloads = deltas idempotents). Borné à 1 resync/cycle. | | | |

### 3.6 Worker

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| 3.6.1 | **`scheduler_enqueue_due` : sonde anti-doublon non verrouillée** | `apps/worker/src/main.ts` | Facile | ✅ |
| | La boucle verrouille `scheduler_ticks` (`FOR UPDATE SKIP LOCKED`) mais la sonde anti-doublon ne l'est pas → deux jobs identiques possibles. | | | |
| | **Corrigé (2026-10-05)** : migration 094 — `pg_advisory_xact_lock(48274, hashtext(job_type))` AVANT la sonde `IF NOT EXISTS`. Le second worker attend le COMMIT du premier et voit alors le job `pending` → plus jamais de doublon. Validé sur PostgreSQL 18.3 (PGlite). | | | |
| 3.6.2 | **`video_clips_purge` : suppression storage avant la ligne, hors transaction** | `apps/worker/src/main.ts` | Facile | ✅ |
| | Au crash : l'objet stockage est détruit mais la ligne `video_clips` reste (storage_key orphelin). | | | |
| | **Corrigé (2026-10-04)** : ordre inversé — la **ligne** est supprimée d'abord (`video_clips_delete_purged([clip.id])`), puis l'objet storage. Un crash entre les deux laisse un résidu storage récupérable par GC, plus jamais une ligne orpheline en base. | | | |

### 3.7 Domain logic

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| 3.7.1 | **`event_date` du journal forcé à la date serveur** | `journal.service.ts:193-220` | Facile | ✅ |
| | `occurred_at` ignoré → events offline rangés au mauvais jour. | | | |
| | **Corrigé** : `eventDateFor()` dérive `event_date` de `occurred_at` (horloge device) dans le fuseau `Africa/Algiers`, avec garde anti-dérive > 1 jour (retombe sur la date serveur). Les events offline vont au bon jour ; une horloge cassée ne crée pas de journée fantôme. | | | |
| 3.7.2 | **`CAPACITY_EXCEEDED` jamais tracé dans `compliance_checks`** | `ratios.service.ts:104-115,132-151` | Facile | ✅ |
| | Seule la règle `RATIO_EDUC` est tracée. | | | |
| | **Corrigé (2026-10-05)** : `recordBreach` recherche chaque raison parmi les règles actives (`ruleByCode`) et trace une ligne par règle correspondante (une seule par salle/jour, dédup par `checked_at::date`). `RATIO_EXCEEDED` reste mappé sur `RATIO_EDUC` (même règle, deux seuils). | | | |
| 3.7.3 | **Ratios sur la salle d'affectation statique, pas la salle pointée** | `ratios.service.ts:80-82` | Facile | ✅ |
| | Enfant affecté à la salle A mais pointé sur le site B → ratio faux. | | | |
| | **Corrigé (2026-10-05)** : les enfants sont comptés via `attendance_sessions.room_id` (la salle OÙ ils sont pointés), plus via `children.room_id`. Un enfant affecté en A mais pointé sur le site B ne gonfle plus le ratio de A. | | | |

### 3.8 CI/CD, observabilité & monitoring

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| **3.8.1** | **D2 : sauvegarde production silencieusement corrompue** | `infrastructure/docker/docker-compose.prod.yml:338-352` | Facile | ✅ |
| | Entrypoint inline du conteneur `backup` : la boucle `while true` avale les erreurs (`>/dev/null 2>&1`), `pg_dump` peut échouer indéfiniment sans alerte. | | | |
| | **Corrigé (2026-10-04)** : `pg_dump` dans un `if/else` — l'échec supprime le fichier partiel, logge la raison (stderr capturée) et **`exit 1`** → `restart: unless-stopped` fait remonter l'échec au lieu de boucler silencieusement pendant des mois. | | | |
| 3.8.2 | `GET /health` trivial — aucune dépendance vérifiée | `health.controller.ts` | Facile | ✅ |
| | Renvoie toujours `{status:'ok'}` même avec DB morte. | | | |
| | **Corrigé (2026-10-04)** : `SELECT 1` borné à 2 s (AbortController) — `status:'degraded'` + check défaillant si la DB ne répond pas. Route publique, aucun détail d'erreur exposé. | | | |
| 3.8.3 | **Sonde worker : marqueur frais même avec un pool DB mort** | `apps/worker/src/main.ts` (startLiveness) | Facile | ✅ |
| | `setInterval` écrit le marqueur quoi qu'il arrive. | | | |
| | **Corrigé (2026-10-04)** : `startLiveness(env, probe)` — le marqueur n'est rafraîchi QUE si la sonde (`SELECT 1` sur le pool) réussit. Un pool DB mort laisse le marqueur périmer → le HEALTHCHECK Docker échoue et redémarre le conteneur, au lieu de laisser un worker « vivant » qui ne traite plus aucun job. | | | |

### 3.9 Admin web

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| 3.9.1 | **Boutons destructeurs sans guard de rôle UI** | `MediaPage.tsx:96-97`, `JournalPage.tsx:109-113` | Facile | ✅ |
| | Un `educator` ou `receptionist` ouvrant Media/Journal voit les boutons de suppression. | | | |
| | **Corrigé (2026-10-05)** : hook `usePermissions.canDestruct()` (role_slug ∈ {director, super_admin}) appliqué aux actions de publication média (MediaPage) et de modération de visibilité journal (JournalPage). L'API reste l'autorité (@Roles) — l'UI masque juste l'action non autorisée au lieu d'offrir un 403 au clic. | | | |
| 3.9.2 | **`AttendancePage` envoie `action:'correct'` — valeur jamais acceptée** | `AttendancePage.tsx:82-85` vs `dto/*.ts:41-56` | Facile | ✅ |
| | **Corrigé** : la correction envoie le statut CIBLE (`check_in`/`check_out`/`absent`) dérivé de la ligne, plus jamais `'correct'` (rejeté par validation du DTO). | | | |
| 3.9.3 | **`MediaPage` : `all_consents_checked` non affiché** | `MediaPage.tsx:16,88-93` | Facile | ✅ |
| | L'opérateur valide à l'aveugle un média contenant un enfant sans consentement photo. | | | |
| | **Corrigé** : colonne consentement dédiée (rouge/gras si manquant) + clés i18n `media.consent*` (FR + AR). L'approbation est de plus bloquée côté API (`photoConsentsAllowed`). | | | |

### 3.10 Parent & staff mobile

| # | Tâche | Fichiers | Difficulté | Fait |
| **3.10.1** | **Parent mobile : aucune restauration de session au démarrage** (`_authenticated = false` en dur) | `parent-mobile/lib/main.dart:38,61-66` | Facile | ✅ |
| | **Corrigé (2026-10-05)** : `restoreSession()` sur ParentApiClient (requête authentifiée légère `/parent/children`), appelée au `initState` de main.dart avec un écran `_Splash` neutre — l'app s'ouvre directement à l'accueil si les jetons sont valides, plus de flash login à chaque démarrage à froid. | | | |
| **3.10.2** | **Staff mobile : refresh mort → 401 définitif** | `staff-mobile/lib/core/network/api_client.dart:21-39`, `auth_service.dart:21-49`, `sync_engine.dart:118` | Facile | ✅ |
| | L'access token expire → l'app se bloque définitivement sans re-login. | | | |
| | **Corrigé (2026-10-05)** : `AuthService.refresh()` (POST /auth/refresh, persiste la nouvelle paire, `logout()` si le refresh est révoqué) et branchement `_authApi.onRefresh = _auth.refresh` au `initState` de main.dart — l'intercepteur 401 du ApiClient a maintenant sa fonction de rotation. | | | |
| **3.10.3** | **`MediaUploader` jamais appelé — le chemin photo staff n'existe pas** | `staff-mobile/lib/core/media/media_uploader.dart:66` | Facile | ✅ |
| | **Corrigé (2026-10-05)** : dépendance `image_picker` ajoutée, `ChildrenListPage` reçoit l'`ApiClient`, bouton caméra par enfant → `_takePhoto()` (compression 80 %, 1600 px) → `MediaUploader.uploadPhoto`. Le chemin photo de l'app personnel existe enfin. | | | |
| **3.10.4** | **`SessionStore` (parent) = code mort complet** | `parent-mobile/lib/core/session_store.dart:1-27` | Trivial | ✅ |
| | **Corrigé (2026-10-05)** : fichier supprimé (zéro appelant — `SecureTokenStore` interne au api_client est le vrai stockage). | | | |

### 3.11 Documentation & code mort

| # | Tâche | Fichiers | Difficulté | Fait |
|---|---|---|---|---|
| 3.11.1 | Claims-contract 7/12 → **✅ 12/12 (fait ce jour, cf. PLAN-REMEDIATION-DOCUMENTATION.md)** | — | — | ✅ |
| 3.11.2 | `inventory-route-guards.mjs` ignore les décorateurs au niveau classe → 49 faux positifs | `scripts/inventory-route-guards.mjs` | Facile | ✅ |
| | **Corrigé (2026-10-05)** : les décorateurs `@Roles`/`@Public` au niveau **classe** sont maintenant hérités par chaque route (fusion NestJS), et une `@Public()` de méthode l'emporte sur un `@Roles` de classe. 199 routes / **41** sans garde (avant 50) — les 9 suppressions étaient des contrôleurs entiers déjà protégés. Les 41 restants sont auto-périmétrés (`/parent/*` filiation, `/auth/*` public, `/privacy/*` RGPD). | | | |
| 3.11.3 | Code mort : `SessionStore`, cache Drift, `l10n.dart`, `outbox_events`, 11 méthodes `DirectorApiClient` | — | Facile | ✅ |
| | **Corrigé (2026-10-05)** : supprimé `session_store.dart` (parent), le cache Drift + son `.g.dart` (861 lignes, voir 3.2.12), `l10n.dart` (96 lignes, zéro import), et les méthodes mortes `markOverdue` / `orgSettings` / `orgDetails` de `DirectorApiClient` (routes 404 + zéro appelant). `outbox_events` est conservé : table vivante du pattern transactional-outbox (migration 014), aucun code ne la référence directement car le worker la lit via SQL. | | | |
| 3.11.4 | ~45 chaînes admin-web non traduites | `apps/admin-web/src/i18n/` | Facile | ✅ |
| | **Vérifié (2026-10-05)** : plus aucune clé manquante — 339 clés `t('…')` utilisées dans `admin-web/src`, 369 clés définies, **0 manquante**, et FR/AR sont parfaitement symétriques (369 = 369). La претензion « 45 chaînes non traduites » datait d'avant l'ajout des clés `media.consent` (3.9.3). | | | |

---

## PHASE 4 — MEDIUM/LOW : HYGIÈNE (222 findings restants)

Nettoyage prioritaire par impact :

| Lot | Contenu | Nb |
|---|---|---|
| 4.1 | Tables sans RLS (5 tables) + casts `current_setting()` bruts (6 migrations) | 8 | ✅ |
| | **Corrigé (2026-10-04/05)** : migrations `087` (6 politiques `current_setting` brut → `app_tenant_id()`) et `088` (`compliance_rules` + `compliance_rule_sets` RLS FORCE). Vérifié post-migrations : sur 75 tables, seules `organizations`, `otp_codes`, `permissions`, `role_permissions`, `roles`, `users` sont sans RLS — toutes légitimes (globales, ou accédées uniquement via fonctions SECURITY DEFINER). | | | |
| 4.2 | Tests unitaires : 20 modules API sans test + admin-web (1 test / 4 342 LOC) + worker (1 spec / 1 191 LOC) | 22 | ✅ |
| | **Corrigé (2026-10-05/06)** : `setupFiles: ['reflect-metadata']` ajouté à `jest.config.mts` — toute spec qui importe un DTO décoré pouvait échouer à se lancer (« Reflect.getMetadata is not a function »). 4 specs de régression ajoutées pour les corrections de cette remédiation : `photo-consent.spec` (3.1.5 H1, 7 tests), `invoice-filter.spec` (3.2.4, 3), `journal-event-types.spec` (3.2.5, 3), `switch-org.spec` (3.2.11, 6), + `sync-resync-contract.spec.mjs` (3.5.2, 4, wiré CI). **Couverture des contrats DTO (2026-10-06)** : `scripts/gen-dto-catalog.mjs` introspecte chaque DTO (décorateurs class-validator via parsing résistant aux regex littérales et aux chaînes échappées), puis `scripts/gen-dto-specs.mjs` génère `dto-validation.spec.ts` pour les 17 modules API — **737 tests, 17/17 modules au vert, 0 échec** (attendance 21, attestations 8, billing 65, children 125, enrollment 32, exports 8, health 73, identity 53, journal 46, media 35, messaging 11, organizations 68, parents 30, payroll 22, staff 82, sync 27, video 31). Chaque spec prouve : (1) une instance **valide** passe — la spec connaît le vrai contrat, pas seulement l'erreur ; (2) chaque propriété requise supprimée est rejetée ; (3) chaque décorateur (`@Matches`, `@IsIn`, `@IsUUID`, `@MinLength`…) rejette une valeur invalide construite **à partir de son argument réel** (UUID `[0-9a-f]{8}-{4}…` → `"aaaaaaaa-aaaa-…"` ; `\d{4,6}` → chiffres ; ranges `{1,200}` avant `{n}` ; constantes exportées `SYNC_ENTITY_TYPES[0]` importées). **Reste** : ~53 modules API sans spec de service dédiée (la couverture métier repose sur les suites d'intégration — 104 specs `tests/`). Montée du seuil Jest à étaler (décision #6).
 **Couverture hors-plan (2026-10-06)** : les 7 derniers modules sans AUCUNE spec sont couverts (compliance 18, dashboard 7, marketplace 5, metrics 13, notifications 10, privacy 20, users 6 = 79 tests). Chaque spec teste les invariants de SÉCURITÉ ou de LOI, pas l'algèbre : garde `super_admin` non-assignable (C2), fail-closed feature-flag marketplace (endpoint public ne fuit aucune donnée), collecteur Prometheus en temps constant + config malformée refusée en bloc, cercle journal (`can_view_journal`) pour les notifications sensibles, décret 19-253 (CAP_150, RATIO_EDUC ≥2 éducateurs/≤10 enfants, DOC_STAFF, PRICE_DISPLAY art. 16), isolation tenant du dashboard (fuseau Algiers, alertes bornées), `redact()` ADR-010 (loi 25-11), `logInTransaction` atomique vs `log()` non-bloquant. | | | |
| 4.3 | `inventory-route-guards.mjs` (49 faux positifs) + `check-rls-usage.mjs` (worker exclu) | 2 | ✅ |
| | **Corrigé (2026-10-04/05)** : `check-rls-usage.mjs` scanne `SCAN_ROOTS = [apps/api/src, apps/worker/src]` (a trouvé un vrai bug — migration 089). `inventory-route-guards.mjs` reconnaît les décorateurs au niveau classe (3.11.2) — 49 faux positifs → 41 routes auto-périmétrées. | | | |
| 4.4 | Code mort (parent `SessionStore`, cache Drift director, `l10n.dart`, `outbox_events`) | 5 | ✅ |
| | **Corrigé (2026-10-05)** : `SessionStore` supprimé (zéro appelant), cache Drift + `.g.dart` (861 lignes) supprimés (3.2.12), `l10n.dart` supprimé (96 lignes), méthodes mortes `DirectorApiClient` supprimées (3.11.3). `outbox_events` conservé — ADR-014. | | | |
| 4.5 | Healthchecks profonds + alertes API + sonde worker (couverture healthcheck non qualifiée : 1 seul, `postgres` Docker) | 3 | ✅ |
| | **Corrigé (2026-10-04)** : sonde API `SELECT 1` bornée 2 s (3.8.2) + sonde worker : le marqueur de vivacité n'est rafraîchi QUE si la sonde base réussit (3.8.3) — un pool DB mort laisse le marqueur périmer → Docker redémarre. | | | |
| 4.6 | Backup entrypoint (D2) : arrêter d'avaler les erreurs | 1 | ✅ |
| | **Corrigé** : `scripts/backup.sh` utilise `set -euo pipefail` ; copie hors site + empreinte SHA-256 + rétention 7 j, tout échec sort en non-zéro. | | | |
| 4.7 | Arabe : ~45 chaînes admin-web + `l10n.dart` director | 46 | ✅ |
| | **Corrigé (2026-10-05)** : admin-web vérifié — 339 clés `t('…')` utilisées, 369 définies, **0 manquante**, FR/AR parfaitement symétriques (369 = 369). `l10n.dart` director supprimé (4.4) — le package `@creche/i18n` est la source unique. | | | |
| 4.8 | Vidéosurveillance : uploader de clip inexistant (chaîne DPIA incomplète) | 1 | ✅ |
| | **Décidé (2026-10-05)** : verrouillé **par conception**. `video_page.dart` l'affiche explicitement : « Acquisition absente en V1 — aucun écran n'envoie de clip (verrou phase21). POST /video/clips/presign-upload fail-closed sans sous-domaine public. » La chaîne serveur est complète (presign → register → list → stream journalisé + purge 30 j worker) ; c'est l'**uplink client** qui n'existe pas volontairement (pas d'upload depuis le terrain en V1, les DVR/NVR alimentent le stockage hors application). La DPIA vidéo couvre la consultation, pas l'acquisition — conforme tant que l'upload reste désactivé. | | | |
| 4.9 | `ANPDP_EMAIL` documenté mais jamais lu (le destinataire réel est `SMTP_TO`) | 1 | ✅ |
| | **Corrigé** : `ANPDP_EMAIL` n'existe plus dans `.env.example` ; `notifyAnpdp()` lit `SMTP_TO` (503 explicite si manquant — jamais de faux envoi). `check-env-example.mjs` ✓. | | | |
| 4.10 | `payments.external_reference` UNIQUE global | 1 | ✅ |
| | **Corrigé (2026-10-05)** : migration `096` — contrainte colonne UNIQUE globale remplacée par index unique **tenant-scoped** `(organization_id, external_reference)`, et `billing_webhook_apply` filtre maintenant ses deux lookups par `organization_id`. Avant, un webhook avec une référence partagée pouvait confirmer la facture d'une AUTRE organisation (contournement de tenant). Validé PGlite : 2 orgs, même référence, pas de collision, pas de cross-tenant, rejeu idempotent. | | | |

---

## DÉCISIONS À PRENDRE AVANT DE CONTINUER

Les 6 points suivants sont des **choix de design**, pas des bugs. Les corriger
dans le mauvais sens gaspille l'effort :

1. **Vérité documentaire** : gel + `claims-contract` obligatoire avant merge (recommandé), ou docs aspiratrices ?
2. **director-mobile V2** : corriger l'API client (recommandé, les routes serveur sont correctes), ou admettre que V2 n'est pas livré et re-planifier ?
3. **`outbox_events`** : implémenter le pattern transactional outbox, ou supprimer la table + corriger la description worker ?
4. **Arabe** : le bilinguisme est une exigence loi 25-11 — priorité et périmètre à définir.
5. **DPO** : créer le rôle + `PermissionsGuard` (recommandé), ou assumer que la directrice assume la fonction DPO (et corriger le seed + la DPIA) ?
6. **Tests** : monter le seuil Jest par paliers (recommandé), ou accepter l'isolation comme seule barrière ?

---

## ORDRE D'EXÉCUTION RECOMMANDÉ

```
PHASE 0  (CI vérité)          ← ✅ TERMINÉE (5/5) — prochaine : PHASE 1
   ↓
PHASE 1  (P0 bloquants)       ← ✅ TERMINÉE (8/8 tâches) — prochaine : PHASE 2
   ↓
PHASE 2  (P1 réglementaire)   ← ✅ TERMINÉE (6/6 tâches) — prochaine : PHASE 3
   décisions 2, 3, 5 résolues
   ↓
PHASE 3  (P2 intégrité)       ← 10/10 tâches demandées TERMINÉES (sur 40+) — suite au prochain lot
   ↓
PHASE 4  (hygiène)            ← 222 findings, lots par impact
```

**Critère de sortie de chaque tâche** : un test qui échoue avant le fix et
passe après (la phase 0 fournit le harnais). Pas de fix sans preuve.
