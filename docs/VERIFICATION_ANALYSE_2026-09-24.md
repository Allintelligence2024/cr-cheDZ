# Vérification contradictoire de l'analyse du 2026-09-24 — cr-cheDZ

**Objet** : contrôler, affirmation par affirmation, le rapport d'analyse « finished app creche »
(vue d'ensemble, Parties 1 à 10, décision) contre le code et les fichiers du dépôt.

**Périmètre** : dépôt `Allintelligence2024/cr-cheDZ`, branche `main` au commit
`3b8f51b` (« thème Sérénité clair/sombre », PR #49) — 692 fichiers suivis par git.

**Méthode** :
1. lecture directe des fichiers cités par le rapport (services, gardes, migrations, scripts) ;
2. inventaire automatisé écrit pour cette vérification : routes × gardes, manifests Android,
   comptages de fichiers/lignes, présence des scripts dans les workflows ;
3. exécution des gardes **exécutables hors-ligne** dans cette session
   (`check-android-manifest.mjs`, `check-env-example.mjs`) ;
4. collecte des preuves : chaque ligne du tableau §3 porte un `fichier:ligne`.

**Ce qui n'a PAS été vérifié ici (limites honnêtes)** :
- Les suites n'ont **pas été exécutées** (pas de PostgreSQL 18, pas de `npm ci`, pas de SDK Flutter
  dans cette session) : ce document vérifie que les tests **existent, sont câblés et sont
  exigeants**, il ne certifie pas qu'ils passent au commit courant.
- Les parties du rapport relatives au **processus** (10 sous-agents, rate-limits, rapports
  sauvegardés) ne sont pas vérifiables depuis le dépôt.
- Le rapport analyse une copie située hors de ce dépôt (`/c/Users/pc/Desktop/...`) ; les
  vérifications ci-dessous portent sur le commit `3b8f51b`, dont la cohérence avec la copie
  analysée est attestée par les compteurs de lignes (voir §4.1).

---

## 1. Verdict

**60 affirmations contrôlées (§3) : 44 confirmées, 10 partielles/nuancées, 4 fausses, 2 questions
ouvertes résolues par la mesure.**

Le rapport est **globalement fiable** — les compteurs de lignes qu'il cite pour les services qu'il
dit avoir lus sont **exacts au caractère près** (billing 743, media 354, journal 260, payroll 161,
auth 794). Sa lecture positive de l'architecture (RLS, TOTP scellé, révocabilité, sync staff,
conformité) est **confirmée sur pièces**. Son verdict final — « projet sain avec conditions,
`parent-mobile` non déployable en l'état » — **est maintenu**.

Trois réserves changent néanmoins la décision opérationnelle :

| | Ce que dit le rapport | Ce que dit le code |
|---|---|---|
| **Priorité n°1** | « pas d'offline-first » sur `parent-mobile` | **la session meurt au bout de 15 minutes** et l'app n'a aucun chemin de récupération (`JWT_ACCESS_EXPIRES_IN=15m`, aucun refresh appelé, aucun intercepteur 401) : c'est un **défaut**, pas une limitation de confort |
| **Gardiens** | `check-rls-usage`, `check-env-example`, `inventory-route-guards` sont « des gardiens » | **4** d'entre eux ne sont câblés dans aucun workflow — dont l'inventaire des gardes de route et le garde Android ; `check-rls-usage`, lui, **est** bien exécuté en CI (voir §4.3, correction) |
| **Ce qui est protégé** | « HEALTHCHECK sur les services », « refusé en prod », « QuartzJobs » | au 24/09 : 1 seul healthcheck (Postgres), aucun refus de `RATE_LIMIT_DISABLED`, **aucun Quartz** dans le dépôt. **Corrigé depuis** : sondes `api` + `worker` livrées (lot 6.1) |

À l'inverse, le rapport **sous-estime** la CI : le job `database` ne se contente pas de rejouer la
suite d'isolation, il la rejoue **avec les rôles de production**, fait tourner **de vrais tests
Flutter**, monte les **stacks Docker staging + dev**, ingère de **vraies métriques Prometheus**, et
**refuse un « vert creux » en vérifiant le nombre de scénarios annoncés dans les logs**
(`>= 21`, `>= 50`, `>= 156`, `>= 44`, `>= 36` scénarios par suite — `scripts/test-production-roles.mjs`)
— y compris un test qui existe uniquement pour empêcher la documentation d'être « regonflée »
silencieusement (`tests/tenant-isolation/openapi-contract.test.mjs`).

---

## 2. Cinq constats à corriger (4 affirmations fausses du rapport + 1 angle mort)

> Le cinquième, **F5** (aucune URL signée n'est joignable en production), est un **P0** que le
> rapport d'origine n'a pas vu : le mécanisme, les fichiers et le test manquant sont au §2.5 ci-dessous.

### F1 — « QuartzJobs pour purge des messages expirés » → **aucun Quartz n'existe**
`grep -ri quartz` sur tout le dépôt (hors `node_modules`) : **0 occurrence**. L'ordonnancement est
**en base** : table `scheduler_ticks` + fonction `scheduler_enqueue_due()` (migration
`056_scheduler.sql:37-60`), 4 ticks (`video_clips_purge`, `retention_purge`, `payments_expire`,
`send_monthly_invoices`), drainés par la boucle du worker (`apps/worker/src/job-runtime.ts:109-160`).
C'est l'ADR-013. Surtout, la purge de « messages expirés » **n'existe pas non plus** : le job
`retention_purge` purge des **journaux** (`audit_logs`, `data_access_logs`, `media_access_logs` —
`034_phase11_retention.sql:10-34`, `RETENTION_DAYS=1825`), et aucune migration ni aucun code ne
supprime de ligne de `notification_queue` ou de `messages` (aucun `DELETE FROM notification_queue`
dans le dépôt ; la migration `065` **réclame** les lignes bloquées, elle ne les purge pas).

### F2 — « HEALTHCHECK présent sur les services » → **1 seul healthcheck, sur Postgres**
**Mesure du 2026-09-24 (état d'origine)** : `grep -c healthcheck` sur le fichier compose de
production = **1**, et il est sur le service `postgres`. L'API, le worker, l'admin-web et la console
n'en déclaraient aucun ; `apps/api/Dockerfile` ne contenait pas de directive `HEALTHCHECK`. L'API
exposait bien `GET /api/v1/health` (proxifié par nginx `location = /healthz`,
`nginx.conf:127-128`), mais **Docker ne l'interrogeait pas** : un processus vivant mais figé
restait en service. Ce qui était vrai : 13 politiques `restart: unless-stopped` et un
`stop_grace_period: 60s` sur le worker.

**✅ Corrigé (lot 6.1, 2026-09-24)** : `api` et `worker` déclarent désormais une sonde en production
**et** en staging, exécutée par le script Node compilé du conteneur (`node:22-slim` n'a ni `curl` ni
`wget`) — API = `apps/api/dist/healthcheck.js` interrogeant le vrai `GET /api/v1/health` ; worker =
`apps/worker/dist/healthcheck.js` lisant le marqueur de vivacité réécrit toutes les 10 s
(`WORKER_LIVENESS_FILE`, absent/périmé = conteneur redémarré, le bail de job étant repris par
`jobs_reap_stale`, migration 053). En dev, l'absence est **motivée dans le fichier** (sources
montées, compilation à chaud). Preuves exécutées : plan de réparation, lot 6.1.

### F3 — « RATE_LIMIT_DISABLED … mais refusé en prod » → **aucun refus n'existe**
Le garde de configuration de production (`packages/prod-config/src/index.ts:106`,
`validateProductionConfig`) vérifie `PAYMENT_WEBHOOK_SECRET`, `JWT_SECRET`, les secrets S3 / le
répertoire local, la complétude SATIM, les digests du collecteur et `TOTP_ENCRYPTION_KEY` — **pas
`RATE_LIMIT_DISABLED`**. Or `apps/api/src/shared/guards/rate-limit.guard.ts:17-18` sort en `true`
dès que la variable vaut `true` **ou** `1`, sans regarder `NODE_ENV`.
Risque réel : **faible mais non nul** — la variable est épinglée à `false` dans
`infrastructure/docker/docker-compose.prod.yml:145` et documentée `RATE_LIMIT_DISABLED=false`
(`.env.prod.example:107`), et nginx applique de toute façon ses propres limites. Il reste qu'une
surcharge d'environnement hors compose désarme silencieusement la limitation applicative.
**Correctif : 2 lignes** dans `validateProductionConfig` (refuser `true`/`1` en production).

### F4 — « `parent-mobile` : OAuth error handling naïf … sans traitement d'erreur isolé » → **faux**
`apps/parent-mobile/lib/features/auth/otp_login_page.dart:20-54` : les deux appels (`_request`,
`_verify`) sont dans un `try/catch` avec état `_busy`, remise à zéro dans `finally`, et **message
d'erreur bilingue** (`« Code incorrect ou expiré / الرمز غير صحيح أو منتهي »`).
Le vrai problème est ailleurs, et il est **plus grave** (voir §4.2) : l'absence de refresh et les
états d'erreur manquants sur **certains** écrans — pas sur tous : `feed_page.dart:33-40` gère
correctement l'erreur, alors que `photos_page.dart:33` et `consents_page.dart:30` font
`if (!s.hasData) → CircularProgressIndicator`, c'est-à-dire **un spinner infini** en cas d'échec.

### F5 — « Stockage MinIO/S3 » ✅ en schéma, mais **les URLs signées ne sont exploitables par aucun client en production** *(P0, absent du rapport d'origine)*
- L'API signe avec le client S3 configuré par `S3_ENDPOINT` (`apps/api/src/shared/storage/s3-client.service.ts:28`)
  et rend cette URL **telle quelle** au client (`media.service.ts:232` photos ; `parents.service.ts:210`
  PDF de facture ; `exports`, `video`).
- En production, `.env.prod.example:41` fixe `S3_ENDPOINT=http://minio:9000`, et
  `docker-compose.prod.yml:64` publie MinIO sur `127.0.0.1:9000` uniquement — le commentaire du
  fichier dit « interne au VPS — jamais exposé publiquement (R3) ».
- Aucun `location` nginx vers le stockage, **aucune réécriture d'hôte** dans le dépôt (le proxy
  Vite ne traite que `/api`) : le navigateur reçoit `http://minio:9000/...` (ou `127.0.0.1:9000`,
  qui pointe vers le **poste du client**, pas vers le VPS).
- **Piège** : « réécrire l'hôte après signature » ne marche pas — SigV4 signe l'en-tête `Host`.
- Contournements existants : uniquement `STORAGE_BACKEND=local` (`kind: 'buffer'`, lecture par
  l'API). Donc en configuration s3 de production : **photos enfants, PDF de factures, exports et
  clips vidéo inaccessibles** — alors que chaque suite d'isolation est verte (elles vérifient
  l'autorisation et la journalisation, pas la **joignabilité** de l'URL rendue).
- **Preuve la plus courte** : `curl -s "$API/media/$ID/download" -H "authorization: Bearer …" | jq -r .url`
  → l'hôte doit être celui de `S3_ENDPOINT`. C'est précisément ce qu'aucun test actuel n'affirme.
- **État après lot 2 (2026-09-24, décision A) : corrigé pour la LECTURE.** Plus aucune URL signée
  n'est rendue au client : `presignGet` a été supprimé, le contenu (photos, photos parent, exports,
  PDF de facture, clips) est servi **en flux par l'API, same-origin**, et le lien rendu est un
  **chemin** (`/api/v1/media/:id/content`, …). Preuve : `phase66-content-same-origin.api.test.mjs`
  (30 vérifications, dont octets identiques au fichier de stockage et « aucun `presignGet(` dans
  `apps/api/src` ») + les suites historiques mises à jour (`phase6`, `phase7`, `phase37`, `phase41`,
  `phase13`, `phase21`, `phase38`) — journal complet au plan §4.
- **Volet B (écriture) — livré pour les MÉDIAS** : `POST /api/v1/media/upload` (multipart) reçoit
  les octets, vérifie SHA-256 + **signature binaire** + liste blanche de types, puis écrit l'objet
  par le serveur (local **et** S3) ; la clé est construite côté serveur. `presignPut` **refuse
  désormais** (503 `UPLOAD_VIA_API_REQUIRED`) en production sans `S3_PUBLIC_ENDPOINT` : plus aucune
  URL injectable sur `minio:9000`. Preuve : `phase67-media-upload.api.test.mjs`
  (31 vérifications, dont « octets stockés identiques », « aucune écriture disque après un checksum
  invalide », « 13 Mio → 413 JSON bilingue », « le parent lit la photo téléversée ») + 15 tests
  unitaires (`storage.service.spec.ts`, `media.dto.spec.ts`). Plafonds alignés : produit 8 Mio
  (422), dur 12 Mio (413), nginx `client_max_body_size 12M`.
- **Reste ouvert du volet B (dit tel quel)** : (1) le client `staff-mobile` appelle encore le
  presign — en production il reçoit maintenant un 503 explicite ; le basculement vers
  `POST /media/upload` n'a **pas** pu être livré ici (aucun SDK Flutter → non compilé) ;
  (2) **défaut confirmé par exécution** : la photo **hors ligne** (`add_photo`) crée un asset
  **sans jamais transférer les octets** — `LECTURE DU CONTENU 404 MEDIA_CONTENT_MISSING`
  (journal au plan §3.2) ; le **canal d'octets à choisir est le dossier de décision D6** (plan §6),
  et deux verrous empêchent de câbler une UI hors-ligne ou de faire transiter les octets sans mettre
  la limite à jour (`media-client-wiring.test.mjs`, journal L2D). **Mesuré le 25/09 (lot L2E)** :
  cette voie n'était pas seulement « sans octets » — un payload base64 était **stocké verbatim**
  dans `sync_operations.payload` (JSONB sans plafond), hors pipeline média ; c'est désormais
  **refusé par le serveur** (garde de forme + 413 explicite plutôt qu'un 500, 17 vérifications
  `phase77`) ; (3) `POST /video/clips/presign-upload` est *fail-closed* en production
  mais le téléversement de clips **par l'API** n'est pas livré (fichiers volumineux : dimensionnement
  dédié).
  **Nuance mesurée le 25/09 (lot L2C)** : la dette (1) est **latente, pas active** — aucun écran
  n'instancie `MediaUploader` (aucune UI de capture dans `staff-mobile/lib`, aucun téléversement dans
  admin-web), et le presign des clips n'est appelé par aucun client (verrou D5, `phase21` cas 9).
  **Fermée le 26/09 (lot L2F)** : l'uploader envoie les octets à `POST /api/v1/media/upload`
  (multipart, type MIME sur la partie, `child_id`, `checksum`), ne fabrique plus de clé de stockage,
  ne signe plus rien et n'affirme plus retirer l'EXIF (il ne le fait pas). Le verrou
  `media-client-wiring` passe à **6 contrôles** (7 depuis L2G) : liste d'exceptions **vide**, route d'upload exigée,
  et balayages sur le **code sans commentaires** (un motif cité n'est pas un appel).
  Ce qui reste hors périmètre, dit tel quel : **aucun écran de capture** n'existe encore (décision
  produit) et le **retrait EXIF côté client** reste une dette explicite.
- **Hors périmètre** : `children.photo_url` (colonne jamais écrite par l'API — si elle venait à
  recevoir une URL signée, elle serait inexploitable : y stocker une **clé**, pas une URL).

---

## 3. Tableau de vérification (60 lignes)

Légende : ✅ confirmé · 🟡 partiel/nuancé · ❌ faux · ➕ question ouverte du rapport, tranchée ici.

### Partie 1 — Core API

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 1 | Modules NestJS isolés, DI cohérente | ✅ | 27 `*.module.ts`, 30 `*.controller.ts`, 172 fichiers TS, 196 routes |
| 2 | `withTenantConnection()` = BEGIN → `set_config('app.tenant_id')` → COMMIT, fail-closed | ✅ | `shared/database/tenant-context.service.ts` (+ `app_tenant_id()` tolérant NULL/vide) |
| 3 | `JwtAuthGuard` : extraction Bearer, `purpose === 'access'`, révocation par `users.token_epoch` | ✅ | `shared/guards/jwt-auth.guard.ts:33-48`, `shared/auth/principal-epoch.ts` |
| 4 | Erreurs typées FR/AR + filtre global | ✅ | `shared/errors.ts:1-50` (`AppError`, messages bilingues), `HttpExceptionFilter` |
| 5 | TOTP scellé AES-256-GCM, AAD = user id, format versionné, rotation, fail-closed | ✅ | `shared/auth/totp-crypto.ts:26,67-68,104-105` (`v1gcm.`, `setAAD(userId)`, `openTotpSecret → null`) |
| 6 | Sessions : token opaque, SHA-256 en base, rotation, détection de réutilisation → révocation globale | ✅ | `modules/identity/auth.service.ts:307-375` (`reuse_detected` → `revokeAllForUser`) |
| 7 | Anti-énumération, lockout progressif, anti-rejeu TOTP (`totp_last_step`) | ✅ | `auth.service.ts:135,307,581` |
| 8 | Fonctions `SECURITY DEFINER` restreintes (`REVOKE ALL … FROM PUBLIC` puis `GRANT … TO creche_app`) | ✅ | `015`, `016`, `025`, `046:78-83`, `050` |
| 9 | `assertStorageKeyInTenant` : le client ne choisit pas son périmètre | ✅ | `shared/authorization/storage-key.ts:4-12` (+ contrainte `049`) |
| 10 | Consentement photo : `DISTINCT ON (child_id)`, défaut fermé | ✅ | `shared/authorization/photo-consent.ts:16-38` |
| 11 | Audit best-effort vs atomique + redaction des PII | ✅ | `modules/privacy/audit.service.ts:50,62,82-83` (`redact()`), ADR-010 |
| 12 | **RateLimitGuard désactivable mais refusé en prod** | ❌ | voir **F3** |
| 13 | « RBAC en code … couverture à vérifier » | ➕ | **Répondu** : authentification **globale fail-closed** (`app.module.ts:69-71` : `JwtAuthGuard` + `RolesGuard` + `RateLimitGuard` en `APP_GUARD`), **10 routes `@Public()`** toutes justifiées (health, login, refresh, OTP/PIN parent, accept-invitation, webhook HMAC, `/metrics` + `MetricsAccessGuard`, marketplace opt-in), **137 routes `@Roles(...)`**, dont **au niveau classe** (`organizations` → `@Roles('super_admin')`, `enrollment` → `director`/`receptionist`). Les ~50 routes sans `@Roles` sont auto-périmétrées (`/parent/*` contrôlé par le lien de filiation — 156 scénarios en phase37 ; `/me`, `/devices`, `/notifications/inbox`, `/auth/2fa/*`, `/privacy/requests` scoping par `u.role`). Couverture **meilleure** que ce que le rapport laissait entendre |

### Partie 2 — Modules métier

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 14 | `BillingService` 743 l., idempotence facture, arrondi décimal, immuabilité payée/annulée, relances 1→2→3, espèces avec `site_id` figé, allocation bornée par trigger, réconciliation en lecture seule | ✅ | `billing.service.ts` = **743 l.** ; index `021`, `invoices_one_contract_period`, garde 422, `056`… en réalité : `023/066` (site), `055` (`FOR UPDATE`), `068` (relances). Relances : e-mail **avant** écriture, échec → rollback (`billing.service.ts:293-312`) |
| 15 | `PayrollService` 161 l., idempotence `UNIQUE(org, year, month)`, `CHECK net = gross − deductions`, finalisation immuable | ✅ | `payroll.service.ts` = **161 l.** ; `072_payroll_finalized_immutable.sql` |
| 16 | `MediaService` 354 l., visibilité parent fail-closed, périmètre `room_ids`, journalisation d'accès | ✅ | `media.service.ts` = **354 l.** ; `media_access_logs` + `logDataAccess` ; R10 |
| 17 | `JournalService` 260 l., append-only, note privée forcée serveur, `setVisibility` refuse (422) | ✅ | `journal.service.ts` = **260 l.** ; `is_correction`/`corrects_event_id` (`:58,107`), `:149-153` |
| 18 | `groupAction` : boucle séquentielle, pas de retour individualisé | ✅ | `journal.service.ts:66-92` — mais avec une nuance qui joue **en faveur** du code : la boucle est dans **une seule** transaction, donc l'échec d'un enfant annule **tout** le lot (cohérence, pas de section à moitié journalisée) |

### Partie 3 — Finance

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 19 | Reçu : plus d'UUID de tenant en clair, hash SHA-256 tronqué | ✅ | `billing/receipt.ts:12` (`sha256(orgId).slice(0,8)`) |
| 20 | Webhook SATIM prêt (structure + HMAC + idempotence), PSP non qualifié | ✅ | `024`, `039`, `052`, `payment-provider.service.ts` ; ADR-003 |
| 21 | Paiement en ligne désactivé jusqu'aux pilotes | ✅ | ADR-003 ; et **plus fort que dit** : `send_monthly_invoices` est désactivé **dans la donnée** (`056_scheduler.sql:38` : `enabled = t <> 'send_monthly_invoices'`) |

### Partie 4 — Modules transversaux

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 22 | Messagerie/notifications : file avec claim, échec non bloquant sauf relance | ✅ | `042/043/054/065` ; `notification_queue` claim/finish/reclaim ; `NOTIFICATION_INBOX_ALLOWED_SQL` |
| 23 | Vidéo : zones limitées par CHECK, verrou DPIA, purge 30 j, visionnages journalisés | ✅ | `047_video_surveillance.sql:28` (`CHECK (zone IN ('entrance','corridor','common_room','playground'))`), `046` (gate DPIA), `audit_logs` |
| 24 | `/metrics` : digests SHA-256, token brut hors dépôt, anonyme = 401, super_admin seul repli | ✅ | `packages/prod-config/src/metrics-collector.ts`, `metrics-access.guard.ts` (epoch vérifiée **avant** lecture), `.env.example:57-65` |
| 25 | « **QuartzJobs** pour purge des messages expirés » | ❌ | voir **F1** |
| 26 | Marketplace peu documenté, flux à vérifier | ➕ | **Répondu** : `@Public()` mais **opt-in explicite** (flag global + `settings.public_listing='true'`), n'expose que nom public/wilaya/commune/description/contact (`marketplace.service.ts:30-50`) ; aucune donnée d'enfant |

### Partie 5 — Identité, Privacy, Sync

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 27 | Sync staff : contrat généré depuis JSON Schema, curseur `sync_seq`, batch transactionnel, tombstone, single-flight, epoch fence | ✅ | ADR-008 ; `scripts/generate-sync-contract.mjs` + `scripts/check-sync-contract.mjs` ; `apps/staff-mobile/lib/core/network/generated/sync_wire_client.dart` |
| 28 | Privacy : registre, DPIA, demandes de droits, anonymisation | ✅ | `029`, `046`, `067`, `071`, `modules/privacy` (729 l.), `docs/PRIVACY_ERASURE_RUNBOOK.md` |

### Partie 6 — Web

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 29 | Admin web : « 19 pages » | 🟡 | **22** fichiers d'écran (`LoginPage`, `AcceptInvitationPage` + 20 écrans métier), **4 009 lignes** au total — écrans très fins (médiane ≈ 150 l.) |
| 30 | Design system partagé | ✅ | importé par les pages : `Button, Card, Table, TextField, tokens` + `ThemeProvider`/`theme.css` (`@creche/design-system`) |
| 31 | Console support derrière allowlist CIDR | ✅ | `nginx.conf:111-120` (`if ($support_allowed = 0) { return 403; }`) + template + `scripts/render-nginx-support-allowlist.sh` |

### Partie 7 — Mobile

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 32 | Staff mobile : séquences atomiques, device fingerprint, PUT signé direct + SHA-256, lockfile imposé | ✅ | `sync_engine.dart`, `app_database.dart`, `media_uploader.dart:100-118` ; CI : `flutter pub get --enforce-lockfile` + `cmp pubspec.lock` (`scripts/check-staff-sync.mjs`) |
| 33 | Staff mobile : photos offline en base64 **en clair** dans SQLite | 🟡 | Le code existe (`media_uploader.dart:137` `base64Encode(bytes)`), **mais aucun chemin UI ne l'atteint** : pas de dépendance `image_picker`/`camera`, aucune page photo ; `uploadPhoto`/`enqueueOfflinePhoto` ne sont appelés que par `test/media_uploader_phase4_test.dart`. Risque **latent** — volet **serveur fermé le 25/09** (lot **L2E**) : `sync/push` **persistait le payload verbatim** (JSONB sans plafond) ; il refuse désormais tout payload > 16 Ko, toute chaîne ≥ 4096 caractères strictement base64 (renommages compris) et ne persiste pas le refus — 17 vérifications `phase77` + 4 tests du filtre (le 300 Ko rendait 500 au lieu de 413 : corrigé). Reste **côté client** : canal d'octets = décision **D6** (option (b) fermée), à traiter **avant** de câbler l'UI (verrous L2C/L2D) |
| 34 | Staff mobile : aucune permission caméra/stockage | ✅ | `AndroidManifest.xml` : `INTERNET` seul ; garde `scripts/check-android-manifest.mjs` (exécuté ici : 2 apps conformes, 4 avertissements `POST_NOTIFICATIONS`/`ACCESS_NETWORK_STATE`) — mais **non câblé en CI** (voir §4.3) |
| 35 | Parent mobile : aucun offline-first, aucun test | ✅ | 1 120 lignes Dart, **pas de `test/`**, aucun cache ni file locale |
| 36 | Parent mobile : refresh token inexistant | ✅ **aggravé** | voir §4.2 : `JWT_ACCESS_EXPIRES_IN=15m` (`apps/api/src/modules/identity/identity.module.ts:25`) et **zéro** appel de refresh dans `lib/` |
| 37 | Parent mobile : gestion d'erreur « naïve » | ❌ | voir **F4** |
| 38 | Parent mobile : consents désynchronisables | 🟡 | `consents_page.dart:23-26` : l'écran **relit** la liste après l'appel, donc pas de désynchronisation silencieuse ; en revanche l'échec réseau produit une **exception non gérée** et un spinner permanent |

### Partie 8 — Infrastructure / base

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 39 | Rôles séparés `creche_migrator` / `creche_app` (`NOBYPASSRLS`), default privileges, bootstrap idempotent | ✅ | `infrastructure/database/roles.sql` (refus `DATABASE_ROLE_OWNS_OBJECTS`/`DATABASE_ROLE_MEMBERSHIP`), `scripts/bootstrap-roles.mjs`, `003`/`grants.sql` |
| 40 | RLS `FORCE` + `WITH CHECK` partout, helper tolérant, historique du bug GUC 018 → 029 → 055 | ✅ | `055` commente explicitement « 029 reintroduced the unsafe direct cast after 018 had fixed it » ; `tests/tenant-isolation/schema-check.mjs` |
| 41 | 75 migrations `001 → 075` immuables | ✅ | 75 fichiers, ADR-007 |
| 42 | Dockerfiles « Node 20 » | 🟡 | **node:22** en build **et** runtime (`apps/api/Dockerfile`, `apps/worker`, `apps/admin-web` → `nginx:1.27-alpine`) ; `engines` racine : Node ≥ 20 |
| 43 | « HEALTHCHECK présent sur les services » | ❌ | voir **F2** |
| 44 | Arrêt borné du worker (`stop_grace_period`) | ✅ | `docker-compose.prod.yml:158` (60 s) |
| 45 | Nginx : 3 zones de limitation + en-têtes + allowlist + `deny all` | ✅ | `nginx.conf:19-28` (`api 30r/m`, `auth 5r/m`, `sync 60r/m` ; XFO/nosniff/HSTS/Referrer-Policy) |
| 46 | Pas de CSP | ✅ | `grep -ri "content-security-policy"` sur tout le dépôt : **0 occurrence** (ni edge nginx, ni `index.html`, ni conteneur admin-web) |
| 47 | Monitoring Prometheus/Grafana/AlertManager + dashboards/alertes | ✅ | services `prometheus`, `alertmanager`, `alert-relay`, `postgres-exporter`, `grafana` (`docker-compose.prod.yml`) ; `tests/monitoring/*` |
| 48 | Secrets fail-closed (SMTP, WhatsApp, paiement → 503, jamais de faux « envoyé ») | ✅ | `assertProductionConfig` + `503 WHATSAPP_NOT_CONFIGURED`, `EMAIL_DELIVERY_FAILED`, `PAYMENT_NOT_CONFIGURED` |

### Parties 9 & 10 — Outillage, tests, conformité

| # | Affirmation | Statut | Preuve / correction |
|---|---|---|---|
| 49 | Scripts `migrate`/`seed`/`bootstrap`/`restore-drill`/`backup` (GPG AES-256 + SHA-256)/sandbox SATIM | ✅ | `scripts/` (33 entrées) ; `backup.sh:35,43` ; `restore-drill.mjs` **exécuté en CI** (job `backup-drill`) |
| 50 | `check-rls-usage`, `check-env-example`, `inventory-route-guards` = « gardiens » | 🟡 | `check-rls-usage` **est** exécuté en CI (`run-isolation-suites.sh:106`, avant les suites, avec `DATABASE_URL`) — 3 des autres gardiens ne sont appelés par **aucun** workflow : voir §4.3 |
| 51 | Preuves par mutation sur les chemins critiques | ✅ | `scripts/mutation-proof.sh`, `mutation-phase23-proof.sh`, `mutation-phase24-proof.sh` |
| 52 | 4 workflows CI, pas de CD automatique | ✅ | `ci`, `docker`, `flutter`, `security-audit` ; aucun job de déploiement |
| 53 | « Tests de charge k6 » | 🟡 | **1 seul** fichier k6 (`tests/load/sync.k6.js`), et il **n'est jamais exécuté** (k6 absent) — `capacity-bench.mjs` le documente lui-même ; la charge réelle est un banc Node (`capacity-bench.mjs`, `mvp-bench.mjs`) |
| 54 | 65+ tests d'isolation (phase 3 → 65+) | ✅ | **71** suites `phaseNN`, **89** fichiers dans `tests/tenant-isolation/`, **73** entrées dans `scripts/run-isolation-suites.sh` (rejouées en CI avec rôles de prod) — +`phase66`/`phase67` (lots 2A/2B) |
| 55 | Densité de test (non chiffrée par le rapport) | ✅ | `tests/**/*.mjs` = **17 123 lignes** vs **16 926** lignes de code API : la suite de tests est **plus grosse que l'API qu'elle teste** |
| 56 | « 15+ ADR » | 🟡 | **14** (ADR-000 → ADR-013) |
| 57 | « 45+ runbooks » | 🟡 | **32** fichiers `*RUNBOOK*.md` (56 `.md` au total dans `docs/`) |
| 58 | « 720 fichiers » | 🟡 | **692** fichiers suivis par git |
| 59 | Conformité loi 18-07 modifiée par la loi 25-11, décret 19-253, DPIA vidéosurveillance | ✅ | `README.md:3,30`, `docs/adr/ADR-009-loi-25-11.md`, `docs/regulatory/DPIA-VIDEOSURVEILLANCE.md` (mentionne explicitement les « images de mineurs ») |
| 60 | « Pas de doc sur les données des enfants de moins de 13 ans » | 🟡 | la **grille** invoquée (seuil de 13 ans) vient du RGPD/COPPA, pas du régime cité par le projet ; le mécanisme correspondant ici — représentation légale par le tuteur — est implémenté (`guardians`, `consent_records`, comptes parents). Le manque, s'il existe, est documentaire (fondement de la représentation des mineurs au registre) : **à trancher par le DPO**, pas par lecture de code |

---

## 4. Constats que le rapport n'a pas vus

### 4.1 Confirmation forte : l'analyste a bien lu les fichiers qu'il cite
Les compteurs annoncés pour les cinq fichiers qu'il dit avoir lus « en direct » sont **exacts**
(`billing.service.ts` 743, `media.service.ts` 354, `journal.service.ts` 260,
`payroll.service.ts` 161, `auth.service.ts` 794). Les plans d'attribution sont donc crédibles —
mais ses **conclusions sur les fichiers non lus** sont, elles, inégales (F1, F2, F3, F4).

### 4.2 🔴 Priorité n°1 révisée — la session parent meurt à 15 minutes
- `apps/api/src/modules/identity/identity.module.ts:25` : `signOptions: { expiresIn: '15m' }`,
  aligné sur `.env.example:17` (`JWT_ACCESS_EXPIRES_IN=15m`).
- `apps/parent-mobile/lib/core/api_client.dart` : les tokens sont stockés, **`refresh_token`
  n'est jamais utilisé** ; `grep -i refresh apps/parent-mobile/lib` ne renvoie que les deux
  `write` de stockage.
- Aucun intercepteur Dio, aucun `onError`, aucun retour à l'écran de connexion ; `SessionStore.hasSession()`
  n'est même pas appelé par `main.dart`.
- Conséquence concrète : **15 minutes après l'OTP**, chaque appel renvoie 401 → `photos_page` et
  `consents_page` affichent un **spinner infini** (`if (!s.hasData) → CircularProgressIndicator`),
  `feed_page` affiche « Fil indisponible » à chaque pull-to-refresh, et le seul recours est de
  **tuer l'application**.

C'est un **bug fonctionnel démontrable**, pas une limitation d'architecture — et il est plus
coûteux que l'absence d'offline (qui est un confort). **Correctif court** (≈ 1 j) : intercepteur
Dio `401 → POST /auth/refresh` avec single-flight + purge de session + redirection vers l'OTP ;
**puis** l'offline-first si le besoin terrain le justifie.

> **État au 2026-09-24 (soir) — BLOQUÉ, outillage requis, mesuré.** Le correctif appartient à
> `apps/parent-mobile` (Dart) : sa preuve est un test widget (`flutter test`). Or cet environnement
> de rédaction n'a **ni SDK Flutter ni accès aux hôtes nécessaires** :
> `storage.googleapis.com` (téléchargement du SDK) et `pub.dev` (résolution des dépendances)
> répondent **000** (timeout), seuls `github.com` et `registry.npmjs.org` répondent (test
> `curl -s -o /dev/null -w '%{http_code}'`). Mesures complémentaires : `apps/parent-mobile/test/`
> **n'existe pas**, `pubspec.lock` **n'est pas versionné** côté parent (alors que `staff-mobile`
> l'est), et `flutter.yml` ne lance `flutter test` **que** pour `staff-mobile`.
> **Ce qu'il faut pour lever le blocage** : un poste (ou la CI, qui a le réseau) avec Flutter 3.47.1
> — `flutter pub get` → commit de `pubspec.lock` → `--enforce-lockfile` → puis le correctif de
> session et ses tests. Aucun de ces points ne peut être *prouvé* ici ; rien n'a donc été écrit
> « en aveugle » dans `apps/parent-mobile` (un correctif non compilé serait un mensonge, pas un
> progrès). Détail : plan de réparation, lot 3.

### 4.3 🟠 Quatre gardiens qui ne gardent rien (hors CI) — ✅ corrigé, et la CLASSE est verrouillée

> **Suite (2026-09-24, soir)** : les 4 gardiens ci-dessous sont câblés en CI depuis le lot 1. En
> recensant la **classe** au lieu des cas cités, un **5ᵉ** orphelin est apparu :
> `scripts/audit-seeds-pii.mjs` (preuve « seeds 100 % synthétiques », écrite pour la CI — option
> `--strict`, sortie JSON — mais appelée par aucun workflow). Il est désormais exécuté dans le job
> `quality`, **et** un cliquet empêche le retour de la classe entière :
> `scripts/check-guards-wired.mjs` recense par convention de nom (`check-*`, `audit-*`, `verify-*`,
> `inventory-*`) et refuse tout gardien non atteignable depuis un workflow — mesuré : **12 gardiens,
> 0 orphelin** (lots 1 et 1.5 ; preuves et mutations au plan de réparation, §5).

**Correction d'une erreur de la première version de ce document** : un `grep … | head` tronqué
m'avait fait écrire que `check-rls-usage.mjs` n'était pas exécuté en CI. **Faux** — il l'est,
et avant toutes les suites : `scripts/run-isolation-suites.sh:106` l'appelle avec `DATABASE_URL`
(le contrôle croise alors ses listes figées avec `pg_proc`/`pg_class` réels, dérive interdite).
De même, `check-worker-monitoring.mjs` est atteint indirectement par Gate D
(`scripts/test-worker-monitoring-stack.mjs:35`). Le garde anti-bypass RLS **tient donc sa promesse.**

Restent **4 scripts réellement orphelins** — présents, documentés, jamais exécutés par un workflow :

| Script | Ce qu'il couvre | Conséquence de l'orphelinage |
|---|---|---|
| `scripts/check-env-example.mjs` | complétude des `.example` vs variables réellement lues | une variable requise peut disparaître de `.env.prod.example` sans que rien ne le signale (déjà vert hors-ligne : 14 + 5 variables) |
| `scripts/inventory-route-guards.mjs` | inventaire AST des routes × gardes | la couverture d'autorisation (196 routes, `@Roles`, `@Public`) n'est surveillée par **personne** |
| `scripts/check-android-manifest.mjs` | `INTERNET` présent dans `main/` (sinon APK release sans réseau) | régression silencieuse au prochain `flutter create` — exactement le bug C7 qu'il a été écrit pour attraper |
| `scripts/verify-load-tests.mjs` | syntaxe + seuils des scripts de charge | cliquet anti-régression des budgets p95 inopérant |

**Correctif court** (≈ 1 h) : ajouter ces 4 appels au job `quality` (aucune base requise, `npm ci`
fournit `typescript`).
Bonus : le nom de l'étape `ci.yml:69` (« phase3 → phase24 (auto) ») est **périmé** — le runner va
jusqu'à `phase67` puis, depuis, `phase68`→`phase77` (libellé corrigé au lot 1 puis étendu à chaque lot ; **73** entrées au 2026-09-25).

### 4.4 🟠 Le worker est plus mince que présenté — et le dit honnêtement
977 lignes de TypeScript, **7 handlers** (`apps/worker/src/main.ts:290-306`) dont **1 stub explicite**
qui échoue bruyamment (`compress_media` → `NOT_IMPLEMENTED: compression média`) et 1 handler
**volontairement supprimé** (`send_parent_notification`, remplacé par le drain de
`notification_queue`). *(Résolu le 2026-09-25, lot L6.3 / décision D3 : le stub `compress_media`
est **retiré** — il ne pouvait qu'échouer et aucun chemin ne le mettait en file ; un job portant ce
type échoue désormais comme tout type inconnu, et un verrou de la suite `phase27` refuse la
réintroduction d'un handler « NOT_IMPLEMENTED » permanent.)* Conclusion pratique : ne pas annoncer la compression média ni une livraison
push « fiable » comme faites — le code ne le prétend pas, le rapport le laissait croire
(« QuartzJobs », « files d'attente »).

### 4.4bis ✅ Vérité documentaire — corrigée et VERROUILLÉE (lot 5, 2026-09-24)

Les quatre affirmations fausses de l'audit (F1 ordonnanceur externe, F2 healthcheck généralisé,
F3 absence de refus, F5 URLs injoignables — cette dernière traitée au lot 2) ne peuvent plus
revenir en silence : `tests/tenant-isolation/claims-contract.test.mjs` (8 contrôles à la livraison du lot 5,
**10 au 25/09/2026**, exécuté dans
le job CI `quality`, aucune base requise) confronte les affirmations au **disque** et refuse les
phrases bannies non corrigées. Les compteurs revendiqués ici (migrations, suites, fichiers, ADR,
runbooks, routes, chemins OpenAPI) sont recalculés à chaque exécution ; les documents périmés
(« 70 migrations », « 196 routes », « healthcheck alignés ») sont corrigés, et une volumétrie brute
de fichiers porte désormais sa **date**. Preuve par mutation : 2 mutations → rouge, restaurations →
vert (journal au plan §5). Détail des contrôles : plan de réparation, lot 5.

### 4.5 🟢 La CI est un actif, pas une case cochée
`scripts/test-production-roles.mjs` (« Gate D ») : base jetable `*_test` obligatoire, mots de passe
aléatoires par run, DDL par `creche_migrator`, HTTP/RLS par `creche_app`, **plafonds de temps par
sous-gate avec annonce du coupable avant exécution**, stacks Docker staging **et** dev, tests
Flutter dans Docker, Prometheus réel, puis **assertions sur le nombre de scénarios** lus dans les
logs. S'y ajoute `openapi-contract.test.mjs`, un test dont l'objet est d'échouer si la
documentation redevient flatteuse. C'est rare, et c'est ce qui donne du poids aux autres
affirmations du projet.

### 4.6 🟡 Densité réelle des clients
`parent-mobile` 1 120 l. · `admin-web` 4 009 l. (22 écrans) · `staff-mobile` 5 848 l. ·
`worker` 977 l. · API 16 926 l. L'écart entre **staff** (offline complet, tests, lockfile) et
**parent** (aucun des trois) est le vrai déséquilibre du produit.

### 4.7 🟡 Aucune purge de la file de notifications ni des messages
Corollaire de F1 : la seule rétention outillée porte sur les **journaux** et sur les **clips vidéo**
(30 j). Ni `messages` ni `notification_queue` n'ont de politique de conservation : les lignes
`sent`/`failed` s'accumulent indéfiniment. À arbitrer avec le DPO (principe de limitation de
conservation, loi 25-11) : soit une purge planifiée, soit une justification écrite de la
conservation — mais pas une affirmation « purge des messages expirés » sans implémentation.

---

## 5. Décision révisée

**Verdict : PRODUIT SAIN, avec 1 bloquant d'exploitation (F5), 2 bloquants fonctionnels côté
`parent-mobile` et 4 correctifs courts.** Le fond reste celui du rapport ; l'ordre des priorités
change.

**Plan d'exécution** : `docs/PLAN_REPARATION_2026-09-24.md` (lots 1 à 6, propriétaires et preuves
de sortie). **Lot 1 exécuté** : refus de `RATE_LIMIT_DISABLED` en production (+ test, prouvé par
mutation), 4 gardiens orphelins câblés en CI, `Content-Security-Policy` étape 1 au bord
(+ contrat `edge-headers-contract`, prouvé par mutation), 3 noms d'étapes CI périmés corrigés.

### 🔴 Bloquant avant toute mise en main de parents
| # | Problème | Preuve | Effort |
|---|---|---|---|
| 0 | **F5** : aucune URL signée n'est joignable par un client (photos, PDF, exports, vidéos) en configuration s3 de production — **lecture corrigée par le lot 2 (contenu same-origin, phase66) ; reste le volet upload** | `.env.prod.example:41` + `docker-compose.prod.yml:64` + `media.service.ts:232` | fait (2A) / 1 j (2B) |
| 1 | `parent-mobile` : session de 15 min sans refresh → app inutilisable, spinners infinis | `identity.module.ts:25`, `api_client.dart` (aucun refresh) | ~1 j |
| 2 | `parent-mobile` : zéro test, zéro gestion d'erreur sur 2 écrans | pas de `test/` ; `photos_page.dart:33`, `consents_page.dart:30` | ~1 j |

### Clôture des items ci-dessus — état mesuré au 2026-09-25

Chaque item de cette section est soit **fermé avec sa preuve exécutée**, soit **explicitement
bloqué** (avec sa cause mesurée). Rien n'est « en cours » : ce tableau est le verdict.

| Item (ligne d'origine) | Statut | Preuve exécutée le 25/09/2026 |
|---|---|---|
| **0 — F5** aucune URL signée joignable (lecture **et** écriture) | ✅ **fermé (lots 2A + 2B)** | `phase66-content-same-origin` (35 assertions) : le média est servi same-origin par l'API ; `phase67-media-upload` (37) : l'upload passe par `POST /media/upload`, le presign d'écriture est *fail-closed* en production ; presign de lecture **supprimé** du code |
| **1 — parent-mobile** : session 15 min sans refresh → app inutilisable | ✅ **livré le 25/09 (L3)** et **VERT en CI** (`ce69bbd`, job `flutter`, lockfile appliqué) | correctif : intercepteur 401 → refresh **single-flight par futur partagé** (les 401 simultanés attendent le MÊME refresh — un drapeau booléen les faisait échouer), rejeu borné, rotation G1b persistée, refresh refusé → session **purgée** + retour à l'OTP. Tests **lancés par la CI** (job `flutter`, SDK 3.47.1) : 8 tests de client dont « 5 appels simultanés en 401 → exactement 1 refresh » + 4 tests de widget — *verdict final non relevé (jeton GitHub indisponible pendant le lot)*. **Le SDK manque toujours ici** (`pub.dev` **000**, mesuré 3×) : la CI est le compilateur et le banc de test — elle a rejeté le premier jet (`'await' can only be used in 'async'`…), corrigé depuis. *(Le chemin cité par la clôture d'audit, `lib/core/network/api_client.dart`, n'existe pas : le fichier est `lib/core/api_client.dart` — l'audit avait recopié la disposition de staff-mobile.)* |
| **2 — parent-mobile** : zéro test, zéro gestion d'erreur | ✅ **livré le 25/09 (L3)** et **VERT en CI** (`ce69bbd` : analyse bloquante + tests exécutés) | `apps/parent-mobile/test/` existe (12 tests) et `flutter.yml` les **exécute** (`parent-mobile — tests`) ; les écrans ont un état d'erreur homogène (`core/error_state.dart`) : session expirée → reconnexion **sans** bouton trompeur, hors-ligne vs panne serveur distingués, réessai explicite, et **fin des indicateurs infinis** (l'erreur est testée avant le chargement) |
| **3 — 4 gardiens orphelins + nom d'étape périmé** | ✅ **fermé (lot 1, verrouillé lot 1.5)** | `check-guards-wired` : **12 gardiens recensés, 0 orphelin** ; les 4 noms apparaissent dans `ci.yml` (`check-env-example`, `inventory-route-guards`, `check-android-manifest`, `verify-load-tests`) ; noms d'étapes corrigés (75→76 migrations, 71→72 suites depuis L4) |
| **4 — `RATE_LIMIT_DISABLED` non refusé en production** | ✅ **fermé (lot 1)** | `packages/prod-config/src/index.ts:110` refuse `true`/`1` en production ; `production-config.spec.ts` → **11 tests verts** (exécuté ci-dessus) |
| **5 — aucune `Content-Security-Policy`** | ✅ **fermé (lot 1)** | `tests/tenant-isolation/edge-headers-contract.test.mjs` lit la config nginx et verrouille la CSP (`default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`) |
| **6 — `pubspec.lock` absent pour parent-mobile** | ✅ **fermé le 25/09** : lockfile versionné, **`--enforce-lockfile` actif en CI** (`F2 Flutter passed … with the enforced lockfile`) | `flutter.yml` publie la résolution **réelle** du run (SDK 3.47.1) pour qu'elle soit committée — un lock écrit à la main resterait faux ; dès qu'il est versionné, la résolution passe en `--enforce-lockfile`. Un lockfile **tronqué** a été reçu au premier essai : une annotation est plafonnée à **4096 caractères** (mesuré) → publication en morceaux numérotés. Commit de la résolution en attente de l'accès GitHub (jeton invalidé en cours de lot, même panne que le 24/09 à la même heure) |
| **❌ 12 / ❌ 25 / ❌ 37 / ❌ 43** (F3, F1, F4, F2) | ✅ F3, F1, F2 **fermés** ; F4 = items 1/2 **livrés (L3)** | F1 : **0** occurrence de « Quartz » dans le code/config (`apps`, `packages`, `infrastructure`) et phrases bannies verrouillées par `claims-contract` ; F2 : composes **résolus** → `prod`/`staging` sondent `api` **et** `worker` (`postgres` partout, `dev` = postgres seul, volontaire) ; F3 : voir item 4 ; F4 : voir items 1/2 |

**Le diagnostic complet est arrivé avec le durcissement** : le premier run rouge a nommé l'erreur —
`test/parent_api_client_test.dart:198` (getter `octetStreamContentType` inexistant dans dio ;
vérifié sur la source `cfug/dio`). Le fichier de test ne compilait pas : le `4 tests passed, 1 failed.`
d'origine, c'était **4 tests de widget + 1 échec de chargement de suite**, et les 8 tests de session —
ceux qui portent la preuve du lot L3 — ne s'exécutaient pas. `flutter analyze` était masqué par le même
tube que `flutter test` : un « vert d'analyse » ne valait pas mieux qu'un « vert de test » tant que
`pipefail` manquait. Corrigé, et l'analyse est désormais bloquante.

**Ce que le durcissement a nommé (deux itérations)** : d'abord une erreur réelle de mon fichier de
test (`octetStreamContentType`, getter dio inexistant — le fichier ne compilait pas, d'où le
`4 tests passed, 1 failed.` : 4 tests de widget, et la suite de session jamais chargée), puis un
**warning préexistant** (`unnecessary_cast`, `consents_page.dart:49`, rattaché par `git log -L` au
commit `3b8f51b`, donc antérieur à L3) — `flutter analyze` échoue aussi sur les warnings, et l'étape
d'analyse n'était **jamais** bloquante avant ce durcissement. Un troisième défaut a été attrapé dans
le durcissement lui-même : `publish $matches` non quoté découpait le diagnostic en mots — vu par
exécution, corrigé, et le repli est désormais verrouillé par le contrat.

*Preuves d'exécution* : gate D local **exit 0** (73 suites journalisées, rôles de production),
`phase6`/`phase25`/`phase77` vertes, builds API + worker verts, 13 suites statiques 80/80, contrat

**Mesure locale à la clôture (26/09, arbre de la tête)** — les compteurs cités plus haut (13 suites
statiques, 80/80) sont ceux du lot D6 : ils restaient vrais, mais le dépôt en compte davantage depuis.
État mesuré aujourd'hui : **15 suites statiques hors API/PG → 83/83**, `media-client-wiring` **8/8**
(7 avant L2H), `claims-contract` 10/10 (qui revalide ses propres compteurs : 76 migrations, 71 suites
`phaseNN`), `parent-session-contract` 9/9, `production-compose-contract` 18/18 ; **121/121** tests
unitaires API, `npm run lint` exit 0, et `phase67` vert sur PostgreSQL 18.4 réel (banc d'upload complet,
`run_pg.mjs` port 54329).
`media-client-wiring` 5/5 (3 mutations). Job CI `flutter` **vert** sur `8fecc6a` (le retrait Dart
compile). Le job `database` de ce même commit était rouge **pour une raison nommée et corrigée** :
le banc F4 comptait encore la photo hors ligne comme un média accepté — adapté en `3b7e128` (le
refus y devient une preuve, statut + motif vérifiés côté client ET côté base). *Verdict CI final — `ce69bbd` : TOUT VERT* (premier run entièrement vert de cette branche). Run `ci`
`36218031204` : **7/7 jobs** (`database`, `quality`, `security`, `e2e`, `admin-web`,
`support-console`, `backup-drill`), run `flutter` **success**, run `docker` **success**. Deux
annotations disent l'essentiel : `F4 Flutter API passed` (7 tests Flutter/Drift réels contre l'API
HTTP + PostgreSQL) et `F2 Flutter passed` (**57 tests et l'analyse, avec le lockfile appliqué** —
`--enforce-lockfile` actif, donc une dérive de dépendance échoue au lieu de changer le binaire en
silence). Le faux vert et les trois défauts qu'il masquait sont clos ; D6 est prouvée de bout en bout.

**Mise à jour du 25/09/2026 (nuit, suite) — D6 tranchée : la photo hors ligne n'existe pas en V1.**
Le défaut constaté par exécution pendant les lots 2B/L2D (un asset créé **sans octets**, lecture
`404 MEDIA_CONTENT_MISSING`, `storage_key` qui laissait croire le contraire) n'est plus une
« limitation documentée » mais une **impossibilité** : `add_photo` est refusée explicitement
(`OFFLINE_PHOTO_UNSUPPORTED`, message nommant `POST /api/v1/media/upload`), le chemin d'écriture sans
octets est supprimé côté serveur, et `enqueueOfflinePhoto`/`offlineStorageKey` sont retirés du client
(plus aucun code ne fabrique de clé `photo/offline-*`). La photo en ligne passe par la route média
(octets par l'API, plafond 8 Mo, consentement, journal des accès). Preuves exécutées : `phase6`,
`phase25`, `phase77` vertes sur PostgreSQL réel avec le rôle applicatif ; `media-client-wiring` 5/5
avec 3 mutations rouges. Le choix (c) plutôt que (a) est argumenté au plan §6 (aucune UI ne capture —
écrire la file locale aurait été du code jamais exercé) ; il est réversible.

**Mise à jour du 26/09/2026 — L2F : le dernier chemin mort du client média est fermé.** L'uploader
`staff-mobile` appelait encore le presign d'écriture, mort en production depuis le lot 2B : il envoie
désormais les octets à `POST /api/v1/media/upload` (multipart), avec le type MIME sur la partie
fichier, `child_id` et le `checksum` que le serveur vérifie. Le client ne fabrique plus de clé de
stockage, ne signe plus rien, et n'affirme plus `exif_stripped: true` sans le faire. Le verrou
`media-client-wiring` n'admet plus **aucune** exception (6 contrôles, 3 mutations rouges) ; le Dart
est jugé par le job `flutter`. Restent explicitement hors périmètre : l'écran de capture (décision
produit) et le retrait EXIF côté client. Le 1er jet (`76fd61b`) a été rejeté par la CI sur **un** test,
et c'est le test qui avait tort : son double consommait son script avec un modulo, donc un script d'un
élément rejouait la panne aux deux tentatives (« panne puis succès » impossible à satisfaire). Corrigé
en `e1d12e9`, avec un diagnostic qui **nomme** désormais le test fautif (`Failing tests:` capté par
`ci-run.sh`) au lieu de ne publier que l'exception.

**Complément du 26/09 (lot L2G) — le mensonge EXIF avait changé de camp.** En cessant d'envoyer
`exif_stripped: true` (L2F), le client a activé un défaut du serveur qui fabriquait la même valeur
fausse (`dto.exif_stripped ?? true`, chemin d'upload) : le défaut de la colonne en base est pourtant
honnête (`NOT NULL DEFAULT false`). Corrigé en `?? false` ; la colonne est désormais **relue en base**
par `phase67` après un upload nominal (elle doit valoir `false`) et un verrou statique `L2G`
(`media-client-wiring`, 7 contrôles) interdit le retour du défaut. Preuve par mutation : `?? true` →
`colonne=true` et verrou 6/7. Le retrait EXIF lui-même reste non implémenté — mais plus personne ne
l'affirme.

**Complément du 26/09 (lot L2H) — `log_event_id` : l'identifiant déclaré que rien ne vérifiait.** Dans
`createAsset`, `child_id` et `children_in_photo` étaient contrôlés, `log_event_id` non : il partait tel
quel dans l'INSERT, et **une clé étrangère PostgreSQL ne consulte pas le RLS** — l'insertion aboutissait
même vers l'organisation voisine. Mesuré avant correctif : `201` et **1 ligne réellement rattachée** à
l'événement de l'autre organisation. Corrigé par une garde `logEventOfTenant` (lecture sur la connexion
du tenant, `404` sinon) appelée dans `createAsset`, donc sur les chemins `upload` **et** `register` ;
`phase67` prouve le refus, l'absence de ligne, **et** que le chemin légitime (même organisation) reste
accepté — une garde qui refuse tout passerait sinon les deux premiers tests. Verrou statique `L2H`
(`media-client-wiring`, 8 contrôles) et mutations exécutées dans les deux sens.

**Résidu nommé, mesuré le 26/09 (lot L2H)** — la même classe existe ailleurs et n'est pas close :
les champs `dto.*_id` (identifiants déclarés par le client) apparaissent **~120 fois** dans les
services de l'API, répartis sur les modules `children` (22), `billing` (22), `staff` (19), `privacy`
(14), `messaging` (9), `attendance` (9), `users` (7), `video` (6), `attestations` (6)… Un balayage
automatique par nom de garde (`*OfTenant`, `assertStorageKeyInTenant`) désigne 13 fichiers sans
garde apparente, mais **cette heuristique ne prouve rien** : plusieurs modules valident sous un autre
nom, et l'inverse est possible. Le volet média est, lui, close et prouvé (`phase67` + verrou `L2H`) ;
le chemin frère `journal` a été relu et **valide** bien (`childOfTenant`, `room_id` dérivé de
l'enfant, jamais du client). Un balayage systématique des autres modules demande sa propre décision et
ses propres bancs — il est donc **ouvert, nommé ici**, et non maquillé en « rien à signaler ».

**Verdict CI du lot L2H** — `ci` `36238450157` (`dc55624`, correctif + banc + verrou) : **7/7 jobs
verts**, `database` inclus (le gate D rejoue `phase67` avec ses trois nouvelles assertions) ;
`flutter` **succès**. `docker` de ce SHA a été **annulé** non par un échec mais par la concurrence du
workflow (`docker.yml` : `cancel-in-progress: true`), le push documentaire suivant ayant pris sa place
— le `docker` `36238470882` de la tête `18f2705` est **succès**. `ci` `36238470721` (`18f2705`) :
**7/7 verts**. Relevé, pas supposé.

**Clôture de la tête `c7c044a` — TOUT VERT, relevé.** `ci` `36240148764` **7/7 jobs** (`admin-web`,
`backup-drill`, `support-console`, `database`, `e2e`, `security`, `quality`), `flutter` `36240148755`
**succès**, `docker` `36240148768` **succès** — annotations `F2 Flutter passed` (59 tests),
`F4 Flutter API passed` (7 tests), `G security`, `H2 confidentiality`, `H1 dev`, `H1 staging`.
Avec ce relevé, **chaque commit de la branche a son verdict**, y compris les commits documentaires
(L2G, L2H et leurs verdicts) : plus aucun « vert » n'est supposé par continuité.

**Dernier tour de la boucle documentaire — et sa règle d'arrêt.** `8b926b0` (compteurs historiques
distingués de la mesure courante) : `ci` `36245551678` **7/7**, `flutter` **succès**, `docker`
**succès** — relevé. Ce commit est le **dernier dont le verdict est consigné dans un document** :
consigner un verdict produit un commit, qui produit un run, qui produit un verdict… la boucle ne
s'arrête que par une règle explicite. Elle s'arrête donc ici : **le verdict du dernier commit
documentaire se lit dans l'onglet Checks de la PR #50**, qui est la source vivante — le dépôt, lui,
consigne les verdicts des commits de **code** et l'état de la tête au moment de la clôture.

**Verdict CI du lot (`79077a8`) — TOUT VERT.** `ci` `36234555506` **7/7 jobs** (`database` inclus),
`flutter` `36234555547` **succès**, `docker` `36234555526` **succès**. Le gate D rejoue `phase67` sur
PostgreSQL réel : la nouvelle assertion (« la colonne doit valoir `false` ») y passe, donc le correctif
est prouvé par la CI et pas seulement en local. Annotations du run : `F2 Flutter passed` (59 tests),
`F4 Flutter API passed` (7 tests), `G security`, `H2 confidentiality`, `H1 dev`, `H1 staging`.

**Verdict du correctif (`e1d12e9`) — run complet VERT.** `ci` `36220107367` : **7/7 jobs**
(`database` inclus, ~31 min) ; `flutter` (APK) `36220107343` **succès** ; `docker` `36220107439`
**succès**. Annotations de preuve : **`F2 Flutter passed` — 59 tests Flutter réels et l'analyse, avec
le lockfile appliqué** (57 au run précédent : les 2 tests nets du groupe L2F sont bien comptés) ;
**`F4 Flutter API passed`** — 7 tests Flutter/Drift contre HTTP + PostgreSQL ; `G security`,
`H2 confidentiality`, `H1 dev` et `H1 staging` passés. **Le lot L2F est donc clos, preuve à l'appui** :
le test corrigé passe, et le diagnostic qui nomme le test fautif est en place pour les prochains échecs
Dart.

Le relevé initial était tombé sur une panne du jeton GitHub du bac à sable (`401`, `gh` **et** `git`
inutilisables) puis sur un re-clone : la branche a été récupérée par la recette éprouvée (arbre
préservé, `.git` neuf, delta de 3 docs restauré à l'identique — `2d7875b`), et rien n'a été poussé
avant que le verdict ne soit effectivement relevé.

**Tête de branche `fc4f3ce` (docs) : également TOUT VERT** — `ci` `36221709391` **7/7** (`F2 Flutter
passed` 59 tests, `F4 Flutter API passed` 7 tests, `G security`, `H2 confidentiality`, `H1 dev`,
`H1 staging`), `flutter` `36221709398` **succès**, `docker` `36221709407` **succès**. Les commits
strictement documentaires qui suivent ne modifient ni code ni tests, et leur propre run est relevé de
la même façon (pas de « vert » supposé). **Relevé : `ci` `36223235356` **7/7 vert**,
`flutter` `36223235348` **succès**, `docker` `36223235345` **succès** — cherché, pas supposé (le jeton
du bac à sable est retombé en `401` juste après ce relevé). Tête `6792345` : même faisceau de preuves
(`F2 Flutter passed` 59 tests, `F4 Flutter API passed` 7 tests).

**Clôture — tête `2b15dcf` : TOUT VERT, relevé.** `ci` `36227971730` **7/7** (`admin-web`,
`backup-drill`, `support-console`, `database`, `e2e`, `security`, `quality`), `flutter` `36227971737`
**succès**, `docker` `36227971739` **succès** ; annotations `F2 Flutter passed` (59 tests),
`F4 Flutter API passed` (7 tests), `G security`, `H2 confidentiality`, `H1 dev` et `H1 staging`.
Le relevé a demandé trois tentatives : le jeton du bac à sable renvoyait `401` sur `gh api … /user`
alors qu'il répondait `200` sur `/rate_limit` — un jeton **limité au dépôt**, pas un jeton mort ; le
403 sur les points d'entrée non couverts ne dit donc rien de l'état réel. Chaque run de cette branche
est jugé par **son propre** verdict, y compris les commits documentaires.

**Mise à jour du 25/09/2026 (nuit) — un « vert » qui ne prouvait rien.** En relevant le verdict du
run `flutter` (jeton GitHub rétabli), une annotation isolée est apparue dans un job **vert** :
`::error::4 tests passed, 1 failed.` — les 17 steps étaient verts. Cause : `flutter test | tee
parent-test.log` ; le tube renvoie le code de sortie de `tee` (0), donc **un test réellement en
échec ne rougissait rien**. Deux suites `staff-mobile` de 5 tests étaient candidates, sans autre
indice (ni fichier, ni ligne, ni test nommé) — l'artefact de logs est alors le seul recours, et il
n'est pas téléchargeable depuis cet environnement. Correction : `scripts/ci-run.sh` (pipefail,
capture et restitution du code de sortie, publication des échecs en annotations), appelé par les
4 étapes de test/analyse des deux apps ; verrou statique = 8e règle de `parent-session-contract`
(3 mutations ; la première assertion était trop faible — elle matchait la mention de `set -o
pipefail` dans un commentaire d'en-tête — et est désormais ancrée sur la directive réelle).
Conséquence méthodologique : un job vert ne vaut que si le chemin qui va du test à son code de
sortie ne peut pas être avalé ; le dépôt n'a plus de `| tee` non protégé.

**Mise à jour du 25/09/2026 (soir) — les items « parent-mobile » sont livrés.** Le raisonnement de la
clôture tenait sur une prémisse devenue fausse : « aucun code Dart ne peut être prouvé ici ». Le job
`flutter` de la CI **a** le SDK épinglé (3.47.1) et **compile** réellement les deux applications
(analyse, tests, APK) : la CI peut donc servir de compilateur et de banc de test, ce qui a été fait —
et elle a attrapé une erreur de compilation réelle (`await` dans une lambda non-async) que la relecture
n'avait pas vue. Ce qui reste hors d'atteinte de l'environnement : l'**exécution locale** (aucun SDK,
`pub.dev` injoignable) et le **commit** de `pubspec.lock` (accès GitHub indisponible en fin de lot).
Le reste de ce paragraphe décrit l'état du 25/09 *avant* ce correctif, conservé comme trace.

**Ce que la clôture ne dit pas** : les items ⛔ ne sont pas « partiellement faits » — aucun code Dart
n'a été écrit (il serait incompilable ici, donc invérifiable). Le correctif complet de L3 (portée
cadrée par la décision **D4 = correctif court**) est prêt à être exécuté sur un poste qui dispose du
SDK : voir `docs/PLAN_REPARATION_2026-09-24.md` §2 (L3) et §6 (D4).

### 🟠 Avant pilote (correctifs courts, fort rendement)
| # | Problème | Preuve | Effort |
|---|---|---|---|
| 3 | **4** gardiens orphelins (`.env.example`, inventaire des gardes de route, manifest Android, seuils de charge) + nom d'étape CI périmé | `.github/workflows/ci.yml` (4 scripts absents) ; §4.3 | ~1 h |
| 4 | `RATE_LIMIT_DISABLED` non refusé en production | `packages/prod-config/src/index.ts:106` | ~15 min |
| 5 | Aucune `Content-Security-Policy` | 0 occurrence dans le dépôt | ~1 h |
| 6 | `pubspec.lock` absent pour `parent-mobile` (deps non figées, à l'inverse de `staff-mobile`) | CI parent : `flutter pub get` sans `--enforce-lockfile` | ~15 min |

### 🟡 Dette assumée, à documenter plutôt qu'à taire
- Worker : `compress_media` **retiré** le 25/09 (L6.3/D3 — un stub permanent annonçait une intégration
  inexistante) ; push « sent » = traité, **pas** livré (l'inbox reste la voie fiable).
- Photos staff : chemin `base64` **inerte** (aucune UI) — le sécuriser **avant** de le câbler.
- Charge : 1 fichier k6 **non exécuté** ; la vraie mesure est le banc Node.
- Rétention : journaux et clips vidéo outillés ; **file de notifications et contenu des
  messages purgés depuis le 25/09/2026** (L4, décision DPO D2 = option a — migration 076,
  `NOTIFICATION_RETENTION_DAYS`/`MESSAGES_RETENTION_DAYS`, suite `phase76`). Reste **hors
  périmètre** : `notification_inbox` et les fichiers joints (`media_assets`) — décisions
  séparées du DPO.
- OpenAPI : 13 chemins écrits à la main sur 198 routes — assumé et testé comme tel.
- 14 ADR / 32 runbooks / 701 fichiers (mesure `git ls-files` au 2026-09-24) : corriger les chiffres du rapport.

### 🟢 À préserver (ne pas régresser)
RLS `FORCE` + rôles séparés + `default privileges` · TOTP scellé AES-256-GCM à AAD · révocation
globale par époque · 67 suites d'isolation rejouées avec les rôles de production · preuves par
mutation · Gate D et ses assertions de volumétrie · conformité loi 25-11 (audit, carnet d'accès,
DPIA vidéo, purge 30 j, zones interdites par CHECK) · sync staff (contrat généré, curseur de
séquence, rollback de lot).

---

## 6. Annexe — reproduire cette vérification

```bash
# 1. volumétrie citée par le rapport
wc -l apps/api/src/modules/{billing/billing.service,media/media.service,journal/journal.service,payroll/payroll.service,identity/auth.service}.ts
git ls-files | wc -l ; ls docs/adr/*.md | wc -l ; ls docs/*RUNBOOK*.md | wc -l

# 2. « QuartzJobs », « HEALTHCHECK », « CSP », « refresh » parent
grep -ri quartz --include='*.ts' --include='*.sql' --include='*.md' . | wc -l        # 0
grep -c healthcheck infrastructure/docker/docker-compose.prod.yml                    # 3 (postgres, api, worker)
grep -ri "content-security-policy" . --exclude-dir=node_modules | wc -l              # 0
grep -rn "expiresIn" apps/api/src/modules/identity/identity.module.ts                # 15m
grep -rn refresh apps/parent-mobile/lib                                              # stockage seul

# 3. gardiens réellement câblés en CI
grep -rhoE "(node|bash) (scripts|tests)/[a-zA-Z0-9._-]+" .github/workflows/*.yml | sort -u

# 4. RATE_LIMIT_DISABLED : refus en prod ?
grep -rn "RATE_LIMIT" packages/prod-config/src/index.ts apps/api/src/shared/guards/rate-limit.guard.ts

# 5. routes × gardes (authentification globale fail-closed + @Public)
grep -rn "APP_GUARD" -A3 apps/api/src/app.module.ts
grep -rc "@Public()" apps/api/src/modules/*/*.controller.ts | grep -v ':0'

# 6. suites d'isolation
ls tests/tenant-isolation/phase*.test.mjs | wc -l                                   # 67
sed -n '/^SUITES=(/,/^)/p' scripts/run-isolation-suites.sh | grep -c test.mjs        # 71 (+ schema-check + rls-behavior-check = 73 entrées)
```

**Fichiers/lignes cités** : voir la colonne « Preuve » du §3 ; toutes les références ont été
relevées sur le commit `3b8f51b`.
