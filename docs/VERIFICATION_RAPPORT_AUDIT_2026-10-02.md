# Vérification du « rapport d'audit technique approfondi » — cr-cheDZ

Date de vérification : 2 octobre 2026
Commit vérifié : `0b70d71` (branche `arena/01a0fd65-cr-chedz`, base `main`)
Méthode : inspection directe du code, des migrations SQL, de la CI et des tests — chaque finding a été confronté au fichier et à la ligne cités.

## Verdict global

**Le rapport est très majoritairement FAUX.** Sur 11 findings détaillés :

| Verdict | Nombre | Findings |
|---|---|---|
| ❌ Réfuté (faux, ou décrit l'inverse du code réel) | 10 | C1, C2, C3, C4/C5, C8, W1, W2, M1, F1, T1 |
| 🟡 Partiellement vrai | 1 | R1 (uniquement le volet « colonnes santé non chiffrées côté application ») |

Autres constats de forme :

- **Métriques annoncées fausses** : « 722 fichiers, ~79 700 lignes ». Réalité au commit : **811 fichiers suivis**, **69 538 lignes** en `.ts/.dart/.sql/.mjs/.js` (88 412 en ajoutant le Markdown).
- **Chemins et lignes cités majoritairement inexistants** : `apps/api/src/modules/storage/storage.service.ts`, `apps/api/src/modules/billing/invoice.entity.ts`, `infrastructure/database/functions.sql`, `apps/parent-mobile/lib/sync/sync.dart`, `tests/e2e/billing.spec.ts` n'existent pas.
- Le score « Sécurité 38 % » ne s'appuie sur aucune méthode ni artefact reproductible : **invérifiable / arbitraire**.

---

## Détail des vérifications

### 1. C1 — « Fuite horizontale dans `children.service.ts` `getById()` » ❌ RÉFUTÉ

- Le fichier existe, mais la **ligne 42 citée est dans `list()`** ; `getById` commence **ligne 76**.
- `getById` s'exécute dans `tenantContext.withTenantConnection(...)` (`children.service.ts:77-79`), qui pose `set_config('app.tenant_id', …, true)` **dans la transaction** (`shared/database/tenant-context.service.ts:48-53`).
- La table `children` est en `ENABLE` + **`FORCE ROW LEVEL SECURITY`** avec la politique
  `USING (organization_id = current_setting('app.tenant_id', true)::uuid)`
  (`infrastructure/database/migrations/005_children_and_families.sql:152-158`).
- Le rôle applicatif est explicitement **`NOSUPERUSER NOBYPASSRLS`** (`infrastructure/database/roles.sql:27`), et un gardien CI (`scripts/check-rls-usage.mjs`) interdit tout `pool.query` brut sur table tenant.
- Conséquence : un utilisateur d'un autre tenant obtient **0 ligne** (404), pas une fuite. L'accès est en outre journalisé (`audit.logDataAccess`, `children.service.ts:105-115`).
- **Nuance légitime (durcissement, pas faille)** : la requête n'a pas de filtre explicite `AND organization_id = $2` (défense en profondeur), contrairement à `billing.getContract` ou `parents.receiptDetail`. Recommandation acceptable, mais elle ne correspond pas au bug décrit.

### 2. C2 — « Trust proxy absent + expiration JWT ms/s » ❌ RÉFUTÉ

- `app.set('trust proxy', 1)` est **présent** (`apps/api/src/app.factory.ts:23`), avec un commentaire expliquant la chaîne `X-Forwarded-For`.
- La ligne 18 de `apps/api/src/main.ts` est le bloc **`Sentry.init`**, il n'y a **aucun code JWT** dans `main.ts`.
- La vérification JWT passe par `JwtService.verifyAsync` (`shared/guards/jwt-auth.guard.ts:43`) — bibliothèque `jsonwebtoken`, qui traite `exp` en secondes correctement. Aucune comparaison « ms / s » maison n'existe. S'y ajoute la révocation par époque (`principal-epoch.ts`).
- Les deux affirmations (IP à 127.0.0.1, jetons éternels) sont donc fausses.

### 3. C3 — « URLs pré-signées sans contrôle d'organisation » ❌ RÉFUTÉ

- Le fichier cité n'existe pas : le service réel est `apps/api/src/modules/media/storage.service.ts`. La ligne 87 est un **commentaire de `presignPut`** (URL d'*écriture*), pas une génération de lecture.
- **`presignGet` a été supprimé** (docstring du service, plan de réparation LOT 2) : la lecture passe par `open()`, servie same-origin par l'API.
- Gardes en amont : `assertStorageKeyInTenant` (`shared/authorization/storage-key.ts`), vérifications RLS, appels gardés (`media.service.ts:169` et `:423`), préfixe de clé `{orgId}/`.
- À noter : contrairement à ce qu'écrit le rapport, c'est l'inverse qui a été traité — les URLs signées étaient *inexploitables* depuis un client (MinIO lié à 127.0.0.1), et l'upload direct est refusé en production sans origine publique (503 explicite).

### 4. C4/C5 — « Clés étrangères transversales non contrôlées à la facturation » ❌ RÉFUTÉ

- La facture (`billing.service.ts:152`) n'accepte **aucun `parent_id`** (paramètre inexistant) ; `child_id` provient d'un contrat chargé avec
  `WHERE id=$1 AND organization_id=$2 AND is_active=true` (`billing.service.ts:129`).
- `invoices` est en `FORCE ROW LEVEL SECURITY` avec `WITH CHECK` sur `organization_id` (`010_billing.sql:179-185`).
- Les allocations croisées sont bloquées par trigger (`064_financial_integrity_hardening.sql:122` : « Allocation traversant les organisations »).
- Les lectures factures/paiements côté parents ont bien les filtres d'organisation explicites (`parents.service.ts:213`).

### 5. C8 — « RLS inopérante en Dev/Test à cause d'un superuser » ❌ RÉFUTÉ (l'inverse du code)

- `roles.sql:28` : `ALTER ROLE creche_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;` — la garantie finale est appliquée **même si le rôle existait déjà** (« C8-bis »).
- Le script **refuse** de poursuivre si `creche_app` possède des objets (`RAISE EXCEPTION 'DATABASE_ROLE_OWNS_OBJECTS'`, `roles.sql:15-20`).
- Le bypass RLS est réservé au rôle de migration (`creche_migrator … BYPASSRLS`), pas à l'application.
- Dev/CI : l'API et le worker se connectent avec `creche_app` (`infrastructure/docker/docker-compose.dev.yml:80,97,121`) ; `postgres` ne sert qu'au bootstrap des rôles.
- La CI rejoue 27 suites d'isolation + le gardien RLS (`scripts/run-isolation-suites.sh:30,123`) et `scripts/test-production-roles.mjs` vérifie le modèle de rôles.
- Détail révélateur : le pseudo-code cité (`CREATE ROLE IF NOT EXISTS`) **n'existe pas en PostgreSQL** ; le fichier réel utilise un bloc `DO` sur `pg_roles`.

### 6. W1 — « `jobs_claim_next` ignore les tâches `failed` éligibles au retry » ❌ RÉFUTÉ

- `infrastructure/database/functions.sql` **n'existe pas** ; la fonction est dans `024_phase8_webhook_jobs.sql` (corrigée par 026/027).
- Le modèle de retry ne repose pas sur l'état `failed` : `jobs_finish` remet en **`pending`** avec backoff exponentiel tant que `attempts < max_attempts` ; `failed` = épuisé (`024_phase8_webhook_jobs.sql:116-130`). Un job `failed` n'est donc pas « éligible au rejeu » par conception.
- La remédiation proposée (sélectionner les `failed`) contredirait ce contrat.

### 7. W2 — « `notif_queue_finish` écrase `failure_reason` à NULL » ❌ RÉFUTÉ

- La migration **`054_notif_queue_finish_fix.sql`** fait exactement ce que le rapport demande : `failure_reason = p_failure_reason` dans les **deux** branches (succès et échec).
- Le motif est même préservé sur le chemin succès (E3 : `sent` = consommée, pas livrée), et `065_notification_queue_reclaim.sql` ajoute la reprise des `processing` orphelines.

### 8. M1 — « `device_id` manquant dans la sync parent-mobile » ❌ RÉFUTÉ

- `apps/parent-mobile/lib/sync/sync.dart` **n'existe pas**. Le app parent ne contient **aucun moteur de sync** (14 fichiers Dart : auth OTP, feed, photos, absences, consentements, préférences, thème).
- La sync offline-first est dans **`staff-mobile`** (`lib/core/sync/sync_engine.dart`), et `device_id` est **obligatoire** dans les DTO serveur `/sync/push` et `/sync/pull` (`modules/sync/dto/*.ts:67,81`, `sync.controller.ts:20,28`).
- Un test l'exige explicitement (`apps/staff-mobile/test/sync_f2_test.dart:140` : `expect(r['data']['device_id'], device)`).
- `device_info_plus` n'est utilisé nulle part dans le dépôt.

### 9. F1 — « Montants en virgule flottante (`float` / `double precision`) » ❌ RÉFUTÉ

- `apps/api/src/modules/billing/invoice.entity.ts` **n'existe pas** (le module billing n'a pas d'ORM d'entité : il est en SQL direct).
- Les montants sont en **`NUMERIC(10,2)`** (`010_billing.sql:13,48,49,50,76`). Recherche exhaustive : **aucun `FLOAT` / `DOUBLE PRECISION` / `REAL`** dans les migrations.- Côté TypeScript, les calculs utilisent `Number()` puis un **arrondi explicite à 2 décimales** (`Math.round(x * 100) / 100`, ex. `billing.service.ts:145-149`). L'exemple annoncé (`12500.299999999999`) ne peut pas être stocké tel quel en `NUMERIC(10,2)`.
- **Nuance défendable** : la politique « centimes entiers » n'est pas adoptée (arithmétique JS intermédiaire en flottant + arrondi). C'est un choix d'ingénierie discutable, pas le bug décrit.
- Le résumé exécutif affirme aussi que les « factures payées [sont] modifiables » : **faux** — trigger `trg_invoice_immutable` durci par `064` (tous champs figés sauf `updated_at`, `balance`, `pdf_url`) et **suppression interdite** par `trg_no_delete_invoices`.

### 10. R1 — « Absence de chiffrement ET de registre d'anonymisation (loi 25-11) » 🟡 PARTIELLEMENT VRAI

| Sous-affirmation | Verdict | Preuve |
|---|---|---|
| Données de santé stockées en clair | ✅ VRAI | `health_records`, `allergies`, `vaccinations` sans chiffrement applicatif (seul le TOTP est scellé AES-256-GCM, `shared/auth/totp-crypto.ts`) |
| « Aucune politique d'anonymisation codée » | ❌ FAUX | `067_anonymize_child.sql` (fonction `anonymize_child` transactionnelle, idempotente, auditable), `071_anonymize_staff_guard.sql`, endpoint `POST /privacy/children/:id/anonymize` (`privacy.controller.ts:151`), runbook `docs/PRIVACY_ERASURE_RUNBOOK.md` |
| « Absence de registre de consentement » | ❌ FAUX | Table `consent_records` avec RLS (`004_audit_and_privacy.sql:70,112-116`), collecte parent (`parents.service.ts:87`), restitution (`privacy.service.ts:185-200`), module `shared/authorization/photo-consent.ts` |
| Référence `compliance.service.ts:120` | ❌ FAUSSE | La ligne 120 est vide ; ce module implémente les règles du décret 19-253, pas l'anonymisation |
| Purge automatique en fin de relation contractuelle | 🟡 Nuancé | L'anonymisation est une action administrative/DPO auditée, pas un job automatique. Point à documenter, mais le rapport le présente comme une absence totale de politique — inexact |

À noter : `docs/regulatory/README.md` documente loi 25-11 / 18-07 et décret 19-253 ; le registre des traitements, les DPIA et la gestion des violations existent (migration 004, console support).

### 11. T1 — « Suites E2E sautées dissimulant des régressions » ❌ RÉFUTÉ (problème déjà corrigé, et la remédiation demandée existe déjà)

- `tests/e2e/billing.spec.ts` **n'existe pas** : `tests/e2e/` ne contient qu'un `README.md`.
- **Aucun `.skip()`** dans `tests/`, `apps/`, `packages/` (seul hit : `requests.skip(1)` en Dart, sans rapport).
- Les specs Playwright réelles sont dans `apps/admin-web/e2e/` (8 specs actives, dont `billing-overdue-flow.spec.ts` et `payroll-finalize-lock.spec.ts`).
- `scripts/check-e2e-skeletons.mjs` **existe déjà** et est **câblé en CI** (`.github/workflows/ci.yml:241`). Son en-tête documente précisément l'incident historique (deux specs entièrement skippées) et sa remédiation du 2026-09-27 — le rapport décrit un état **antérieur déjà corrigé**.

---

## Résumé exécutif du rapport : vérification

| Affirmation du résumé | Verdict |
|---|---|
| Score sécurité 38 % | ❌ Invérifiable / arbitraire (aucune méthode) |
| Loi 25-11 non conforme à cause de « données médicales en clair + absence de registre de consentement » | 🟡 Le chiffrement applicatif des colonnes santé manque (vrai) ; le registre de consentement existe (faux) |
| Décret 19-253 non conforme « absence de contrôles des ratios » | ❌ Faux : `RATIO_EDUC` (≥ 2 éducateurs, ≤ 10 enfants/éducateur), `CAP_150`, `AGE_CRECHE`, `DOC_STAFF`, `PRICE_DISPLAY` — `compliance.service.ts`, `attendance/ratios.service.ts`, seed `013_compliance.sql`, contrôles de planning (`staff-schedule.service.ts`) |
| Factures payées modifiables | ❌ Faux (triggers d'immuabilité + interdiction de DELETE) |
| Flottants pour montants DZD | ❌ Faux (`NUMERIC(10,2)`, aucun type flottant) |
| C8 : RLS désactivée par un compte superuser | ❌ Faux (garanties explicites `NOSUPERUSER NOBYPASSRLS`, refus si possession d'objets) |

## Conclusion

Le rapport n'est **pas fiable en l'état** : il décrit un dépôt qui ne correspond pas à celui-ci (fichiers fantômes, lignes inexistantes, métriques fausses), et ses findings « critiques » sont soit réfutés par le code, soit **l'inverse exact** de ce que le dépôt implémente (C8 notamment).

Une seule affirmation matérielle résiste à l'examen : **les colonnes de santé ne bénéficient pas d'un chiffrement applicatif** (les données sont protégées par RLS/rôles/audit, mais lisibles en clair par quiconque a un accès base). Sur ce point, la recommandation d'un chiffrement colonne ou d'une politique de rétention/anonymisation automatique des dossiers santé en fin de relation est un durcissement légitime à étudier.

Recommandation opérationnelle : si un audit externe doit être retenu, exiger pour chaque finding le **SHA du commit**, la **commande de reproduction** et l'**extrait de code exact** — trois éléments absents de ce rapport.
