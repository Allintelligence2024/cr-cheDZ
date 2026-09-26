# Plan de réparation — suite à la vérification du 2026-09-24

> **Origine** : rapport d'analyse « finished app creche » + vérification contradictoire
> (`docs/VERIFICATION_ANALYSE_2026-09-24.md`, 60 affirmations contrôlées) sur le commit
> `3b8f51b`. Ce plan remplace l'ordre de priorité du rapport d'origine : il est classé par
> **risque réel × coût de correction**, et chaque tâche porte sa **preuve de sortie**.

---

## 0. Ce qui a changé depuis le rapport d'origine

| # | Constat de la vérification | Effet sur le plan |
|---|---|---|
| C1 | `check-rls-usage.mjs` **est** déjà exécuté en CI (`run-isolation-suites.sh:106`) — contrairement à ce qu'écrivait la première version de la vérification | Lot « gardiens » réduit à **4** scripts réellement orphelins |
| C2 | `parent-mobile` : session de **15 min** (`identity.module.ts:25`) sans aucun appel de refresh → app inutilisable après expiration, spinners infinis (`photos_page`, `consents_page`) | Déclassé de « pas d'offline » à **bug fonctionnel bloquant** (lot 3) |
| C3 | **F5 (nouveau, absent du rapport d'origine)** : `S3_ENDPOINT=http://minio:9000` (`.env.prod.example:41`) + MinIO lié à `127.0.0.1` seulement (`docker-compose.prod.yml:64`, « jamais exposé publiquement ») ⇒ **toute URL signée est inexploitable par un navigateur ou un téléphone** (photos enfants, PDF de factures, exports, clips vidéo) | **Lot 2 en P0** — c'est le plus gros écart entre « ça marche en dev/CI » et « ça marche chez la crèche » |

Rappel des 4 affirmations fausses du rapport d'origine : « QuartzJobs » (n'existe pas),
« HEALTHCHECK sur les services » (1 seul, Postgres), « `RATE_LIMIT_DISABLED` refusé en prod »
(aucun refus), « OAuth error handling naïf » (faux — 4 assertions corrigées au §3 / F1-F4 de la
vérification).

---

## 1. Règles du plan (identiques à celles du dépôt)

1. **Aucun lot n'est déclaré fait sans preuve exécutée** (test, garde, ou commande dont la sortie
   est citée). « Le code est écrit » ≠ « c'est vérifié ».
2. **Pas de faux vert** : si une preuve ne peut pas être exécutée dans l'environnement
   (Docker, Flutter, PostgreSQL), la tâche est marquée **BLOQUÉE** avec l'outillage requis — elle
   n'est ni cochée ni contournée par un test complaisant.
3. **Les cliquets ne baissent pas** : toute correction de sécurité/argent ajoute sa couverture
   (`jest.config.mts` seuils par fichier, suites d'isolation, Gate D).
4. **Une migration appliquée ne se modifie jamais** (ADR-007) ; **une facture payée ne se modifie
   jamais** ; **un événement de journal ne se supprime jamais**.
5. **1 lot = 1 PR** sur `arena/01a0d3c1-cr-chedz`, chaque PR vérifiée par les jobs requis
   (`database` est le seul check bloquant ; `quality`, `e2e`, `flutter-check`, `security` restent
   non bloquants mais doivent être regardés — un rouge honnête n'est pas un feu vert).

---

## 2. Vue d'ensemble des lots

| Lot | Objectif | Origine | Effort | Preuve de sortie | Statut |
|---|---|---|---|---|---|
| **L1** | **Gardiens orphelins + garde de config + CSP edge** | vérif. §4.3, F2, F3 | ~2 h | 4 gardiens en CI ; test unitaire prod-config ; test de contrat en-têtes | **FAIT** + régression CI du 24/09 corrigée et verrouillée (§3, L1.4) |
| **L1.5** | **5ᵉ gardien orphelin + cliquet « gardiens câblés »** | vérif. §4.3 | ~0,5 h | gardien `check-guards-wired.mjs` en CI ; `audit-seeds-pii --strict` exécuté | **FAIT (2026-09-24)** — 12 gardiens recensés, 0 orphelin, 3 mutations détectées (§5) |
| **L1.6** | **Diagnostic H1 exploitable** : nommer l'image qui refuse le tirage | CI (`database`) | ~0,2 h | message d'erreur citant l'image + test unitaire | **FAIT (2026-09-24)** — « Registry pull failed for <image> » ; comportement inchangé (aucun repli vert) |
| **L1.7** | **H1 : chemins de remédiation d'exploitation** (miroir `MINIO_IMAGE`, connexion Quay facultative) | CI (`database`) | ~0,5 h | surcharge effective + défaut épinglé + étape conditionnelle | **FAIT (2026-09-24)** — diagnostic affiné (Quay seul ; Docker Hub passe) + 4 mutations détectées (§5) ; **dépassé le 25/09/2026 (lot H1)** : la cause racine est amont (MinIO retiré des deux registres publics) ⇒ le défaut est désormais une image **construite** depuis la release officielle, somme vérifiée par le builder ; les deux voies ci-dessus restent des surcharges (journal §5, lot H1) — **vérifié en CI : job `database` vert sur `5266fff`** |
| **L2** | **Rendre les médias réellement accessibles (F5)** | vérif. C3 | 1–2 j | test d'isolation : l'URL rendue au client est exploitable (hôte public, jamais `minio:9000`) | **FAIT — volet A (lecture, phase66) + volet B média (upload par l'API, phase67)** ; restent hors lot : branchement du client mobile (**L3**, bloqué par le SDK Flutter), upload des clips (**D5 = c** : hors discours opérationnel, verrou ), octets hors-ligne (voir §3.2 ; **L2E** refuse désormais tout blob base64 dans `sync/push`) ; volet client verrouillé par **L2C** (`media-client-wiring`) |
| **L3** | **`parent-mobile` : session, erreurs, tests, lockfile** | vérif. C2, F4 | ~2 j | refresh single-flight + widget tests exécutés en CI (`flutter test` parent) | **LIVRÉE (2026-09-25)** sans SDK local : code + 12 tests **lancés par la CI** (job `flutter`, Flutter 3.47.1 ; verdict final en attente) — un `await` en lambda non-async a d'ailleurs été attrapé par la CI puis corrigé (§5) ; **fait** : la résolution publiée par la CI a été réassemblée et committée, `--enforce-lockfile` est actif, et le verdict final est **vert** (`ce69bbd` ; §5) |
| **L4** | **Rétention file de notifications/messages + mineurs (DPO)** | vérif. §4.7, ligne 60 | S/M (décision) | purge planifiée testée **ou** justification écrite au registre | **FAIT (2026-09-25)** — décision **D2 = (a)** (purger) : migration 076, seuils 90 j / 365 j, suite `phase76` 15 assertions, 3 mutations détectées (§5) |
| **L5** | **Vérité documentaire anti-« regonflage »** | vérif. F1, §4.4 | ~0,5 j | test de contrat « affirmations » + docs corrigées | **FAIT** — contrat `claims-contract.test.mjs` (**10 contrôles** au 25/09/2026, branche CI `quality`) + 6 documents corrigés ; prolongé par **L5.1** (vérité « workflows CI », §5) |
| **L6** (opt.) | **Worker : stub `compress_media`, k6, healthchecks** | vérif. F1/F2, §4.4 | S | décision tracée (implémenter **ou** retirer) ; healthcheck API/worker | **L6 FAIT dans son ensemble** : L6.1 (sondes API/worker), L6.2 (k6 — critère mesuré par le banc en parité 500 ops, p95 1,4 s, gardien de discours), L6.3 (D3 — stub `compress_media` retiré, verrou anti-stub), L6.4 (D5 — vidéosurveillance retirée du discours opérationnel, verrou d'acquisition) |

**Ordre recommandé** : L1 (fait) → **L2** (bloque l'usage réel) → L3 (bloque les parents) → L5
(pas de dépendance, peut glisser entre les deux) → L4 (attend une décision DPO) → L6.
**État au 2026-09-24 (soir)** : L1 (+ L1.5, L1.6, L1.7), L2A, L2B, **L5** et **L6.1** sont faits et prouvés ; L3 reste
bloqué par l'absence de SDK Flutter dans l'environnement d'exécution (aucune preuve compilée
possible) ; **L4** (D2 = a, migration 076, suite `phase76`), **L6.2** (k6 : critère mesuré par le banc
exécutable, script k6 verrouillé en CI mais **non exécuté** ici), **L6.3** (D3 : stub `compress_media`
retiré), **L6.4** (D5 : vidéosurveillance retirée du discours opérationnel), **L2C** (volet client de
F5 verrouillé), **L2D** (photo hors ligne mesurée) et **L2E** (`sync/push` n'est pas un canal de
fichiers : garde de payload + 413 explicite) sont faits. **Toutes les décisions D2–D5 sont
tranchées** ; **D6 est TRANCHÉE le 2026-09-25 — option (c)** : la photo hors ligne n'existe pas
en V1, `add_photo` est refusée explicitement et le chemin d'écriture sans octets est retiré
(preuves : `phase6`, `phase25`, `phase77` vertes ; verrou `media-client-wiring`) ; **L3 est
livrée** (code + tests **exécutés** par le job `flutter` de la CI, sans SDK dans l'environnement ; **vert sur `ce69bbd`** — §5) ;
il reste à committer la résolution `pubspec.lock` publiée par la CI et à relever le verdict final.

---

## 3. Lot 1 — Gardiens, garde de config, CSP (fait dans ce commit)

### L1.1 — `RATE_LIMIT_DISABLED` refusé en production
**Problème** : `rate-limit.guard.ts:17-18` désarme la limitation applicative dès que la variable
vaut `true` ou `1`, **sans regarder `NODE_ENV`** ; `validateProductionConfig` ne la contrôle pas.
Atténuations existantes (assumées, non suffisantes) : `.env.prod.example:107` la fixe à `false`,
`docker-compose.prod.yml:145` aussi, et nginx applique ses propres limites.

**Correctif** : `packages/prod-config/src/index.ts` — en production, `RATE_LIMIT_DISABLED=true|1`
bloque le démarrage avec un message nommant la variable. Correspondance **exacte** avec la
sémantique du garde (pas de sur-blocage de valeurs que le garde n'interprète pas).

**Preuve** : `apps/api/src/shared/config/production-config.spec.ts` (+1 cas : `true`, `1` refusés ;
`false`, absent admis) — exécuté : **11 tests verts**.

### L1.2 — Quatre gardiens orphelins câblés en CI
**Problème** : `check-env-example.mjs`, `inventory-route-guards.mjs`, `check-android-manifest.mjs`,
`verify-load-tests.mjs` ne sont appelés par **aucun** workflow (détail et conséquences : vérif.
§4.3). Le garde anti-bypass RLS, lui, **est** bien exécuté (C1).

**Correctif** : 4 étapes ajoutées au job `quality` de `.github/workflows/ci.yml` (aucune base
requise, `npm ci` fournit `typescript`). Deux noms d'étapes périmés corrigés :
`schema-check (+ garde RLS anti-bypass)` → `schema-check (structure RLS, dérive migrations)` et
`Suites d'isolation (isolation + phase3 → phase24 (auto))` → nom exact (garde RLS + 69 suites,
`isolation` + `phase3 → phase65`). *(L2 ajoute la suite phase66 → le libellé devient « 70 suites,
phase3 → phase66 ».)*

**Preuve** : les 4 gardiens exécutés ici en local avant câblage, **verts** (sorties citées au §5).

### L1.3 — `Content-Security-Policy` (étape 1)
**Problème** : 0 occurrence de CSP dans tout le dépôt (vérif. ligne 46).

**Correctif** : `add_header Content-Security-Policy …` au niveau `http` de
`infrastructure/nginx/nginx.conf`, à côté des autres en-têtes. Les conteneurs `admin-web` et
`support-console` ne publient **aucun port** en production (`docker-compose.prod.yml:206-212`) :
seul le bord est joignable, donc une seule politique suffit.

**Portée honnête — étape 1 sur 2** : `script-src 'self' 'unsafe-inline'` reste nécessaire pour le
bootstrap anti-FOUC inline et le chargement non bloquant de la police (`apps/admin-web/index.html`).
Ce qui est **déjà** gagné : plus aucune origine tierce pour scripts/styles/frames/images hostiles
(`default-src 'self'`), `object-src 'none'`, `base-uri 'self'` (anti-hijack de `<base>`),
`frame-ancestors 'none'` (anti-clickjacking au-delà du `X-Frame-Options`), `form-action 'self'`.
**Étape 2** (hors L1, à planifier) : extraire les deux inline → `script-src 'self'` strict ; cela
touche le chemin de démarrage du SPA, donc exige une vérification navigateur (job `e2e`).

**Preuve** : `tests/tenant-isolation/edge-headers-contract.test.mjs` — la CSP est présente,
contient les 6 directives structurantes, et les conteneurs SPA ne publient pas de port.

---

### L1.4 — Suivi du 24/09 : régression de ce lot détectée en qualifiant la CI

Le job CI `database` est rouge le 24/09, pour **deux causes distinctes**. L'une
**vient du lot 1** : le job exporte `RATE_LIMIT_DISABLED: 'true'` (raccourci de
banc d'essai) et `phase26-production-roles.test.mjs` lançait les entrées de
production avec `...process.env` — la garde L1.1 refuse ce raccourci en
production, donc le processus API/worker mourait au boot
(« GARDE CONFIG PRODUCTION — RATE_LIMIT_DISABLED ») au lieu de rendre
`DATABASE_ROLE_UNSAFE`. Deux tests rouges → le gate s'arrête **avant la
batterie** : sur `f73c7c0`, `e3728cc` et `225fead`, **aucune suite d'isolation
n'a tourné en CI**. Les tests unitaires de L1.1 ne pouvaient pas le voir : ils
testaient la fonction, jamais un spawn de production à environnement hérité.

**Correctif** : constante partagée `PRODUCTION_SPAWN_ENV`
(`tests/tenant-isolation/helpers.mjs`) — un environnement de production ne
désactive jamais la limitation de débit — neutralisée dans les **5 suites** qui
lancent une entrée de production (`phase22`, `phase26`, `phase27`, `phase28`,
`phase49`), plus un **verrou** dans `phase26` qui refuse tout spawn de production
héritant du raccourci.

**Preuve** (PG 18.4 réel, condition CI `RATE_LIMIT_DISABLED=true`) :

```
phase26 avant : # pass 12 / # fail 2   (« Boot exit 1 : GARDE CONFIG PRODUCTION … »)
phase26 après : # pass 15 / # fail 0
verrou        : 5 fichiers signalés sur HEAD → 0 après correctif
Gate D complet avec l'environnement du job CI → 72/72 suites vertes, rc=0
                (journal détaillé : §5, « L1.4 — reproduction, correctif, verrou »)
```

La **seconde cause** du rouge CI est environnementale et préexistante : H1 ne
parvient plus à tirer `postgres:18-alpine` / `quay.io/minio/minio` sur le runner
(`unauthorized`), y compris sur `main` où le gate se terminait pourtant la veille
(`52e6ef3`). Elle n'est **pas corrigée ici** (Docker absent du bac à sable) et
reste ouverte ; elle empêche le job d'être vert même quand le code l'est.
Détail : `docs/CI-DATABASE-JOB-FINDINGS.md` § 24/09/2026.

## 4. Lots suivants — contenu, décisions, preuves

### Lot 2 — F5 : les médias ne sont pas accessibles en production *(P0)*
**Mécanisme vérifié** : l'API signe avec le client S3 configuré par `S3_ENDPOINT`
(`s3-client.service.ts:28`) et rend cette URL telle quelle au client
(`media.service.ts:232`, `parents.service.ts:210`). Or `.env.prod.example:41` fixe
`S3_ENDPOINT=http://minio:9000` et `docker-compose.prod.yml:64` publie MinIO sur
`127.0.0.1:9000` seulement (« jamais exposé publiquement »). Aucun proxy nginx vers le stockage,
aucune réécriture d'hôte nulle part (le proxy Vite ne traite que `/api`).

**Piège à ne pas répéter** : « réécrire l'hôte de l'URL signée » **ne fonctionne pas** — SigV4
signe l'en-tête `Host`. Il faut signer avec l'hôte que le client appellera réellement.

**Deux options, une décision** :
- **A (recommandée pour le pilote)** — contenu **same-origin** : `GET /media/:id/content`,
  `/parent/children/:id/media/:mediaId/content`, PDF/exports/vidéos en *stream* par l'API
  (le chemin `kind:'buffer'` existe déjà pour `STORAGE_BACKEND=local`, il s'agit de le généraliser),
  URLs relatives côté web/mobile. Zéro DNS, zéro TLS, zéro exposition MinIO ; coût = bande passante
  API. Le carnet d'accès (`media_access_logs`) et l'audit restent inchangés.
- **B (échelle)** — `S3_PUBLIC_ENDPOINT` (https) + `location /storage/` dans nginx + MinIO derrière
  TLS ; MinIO reste non publié, l'edge proxifie. Prérequis : sous-domaine, certificat, décision ops.

**Preuve de sortie (les deux options)** : suite d'isolation qui vérifie que **l'URL rendue au
client est exploitable** — hôte ∈ {origine publique configurée} et **jamais** `minio:*`,
`127.0.0.1`, `localhost` ; testable en CI sans MinIO réel (double loopback, comme les tests de
paiement SATIM). À défaut, c'est exactement le genre de « ça marche » qu'aucun test actuel ne
démentirait.

#### Décision : **option A** (propriétaire, 2026-09-24) — appliquée au volet lecture

**Ce qui est fait (volet A / 2A — lecture), ce commit :**

| Surface | Avant | Après |
|---|---|---|
| Média (personnel) | `GET /media/:id/download` → URL signée MinIO | `…/download` → chemin `/api/v1/media/:id/content` ; `GET …/content` sert le flux |
| Média (parent) | `…/media/:mediaId/download` → URL signée | chemin **parent-scopé** `/api/v1/parent/children/:child/media/:mediaId/content`, consentement photo re-vérifié **à chaque lecture** |
| Exports Excel | backend S3 → redirection 302 vers MinIO | flux `attachment` par l'API (backend local **et** S3) |
| PDF facture | personnel/parent → redirection 302 | flux `application/pdf` same-origin, `404 PDF_NOT_READY` conservé (C4) |
| Clips vidéo | backend S3 → `download_url` signé | `content_url` same-origin pour **les deux** backends, plus aucun `download_url` |
| Client web | `window.open(url_signée)` | `apiOpenBlob()` : blob **authentifié** puis `object:` URL (le garde JWT n'accepte que `Authorization` — un `window.open` nu recevrait 401) |
| Client parent | `Image.network(url_signée)` | `ParentApiClient.photoContent()` (octets + JWT) → `Image.memory` |

**Pourquoi le blob côté web et non un simple `<img src>`** : le contenu est protégé par JWT
(l'en-tête, pas de cookie de session pour l'API). Un `<img src="…">` ou un `window.open` part sans
en-tête et recevrait 401. Le prix est assumé : le contenu transite en mémoire du navigateur
(acceptable pour photos/PDF/exports ; **limite connue** pour de gros clips vidéo — si la charge le
justifie, l'option B reprend un lien public signé **sur une origine publique**, jamais sur
`S3_ENDPOINT`).

**Gains de sécurité au passage** : `presignGet` est **supprimé** du client S3 (`getSignedUrl` ne
sert plus qu'à l'**upload** PUT) ; garde `containment` (anti `..`) partagée pour toute lecture
disque ; défense croisée **nouvelle** sur `invoices.pdf_url` (préfixe `{org}/` + containment) —
`invoices` ne figurait dans aucune contrainte de la migration 049, contrairement à
`media_assets`/`video_clips`/`staff_documents`/`report_exports` ; `cache-control: private, no-store`.

**Volet B (écriture/upload) — livré pour les MÉDIAS (ce commit)** :
`POST /api/v1/media/upload` (multipart, `multer`, stockage mémoire) reçoit les octets, les VÉRIFIE
puis les écrit par le serveur (`storage.put()`, local **et** S3). En production, plus aucun client
ne reçoit d'URL signée injoignable : `presignPut` **refuse** (503 `UPLOAD_VIA_API_REQUIRED`) tant que
`S3_PUBLIC_ENDPOINT` n'est pas configuré — c'est la garde qui transforme le bug F5 en erreur
explicite au lieu d'un échec silencieux sur le téléphone.

| Contrat du volet B (média) | Valeur |
|---|---|
| Route | `POST /api/v1/media/upload` — `multipart/form-data`, champ `file`, rôles personnel |
| Champs | `child_id`, `log_event_id`, `children_in_photo`, `taken_at`, `checksum` (SHA-256 hex), `exif_stripped` |
| Clé de stockage | construite **côté serveur** (`storageKey(orgId, …)`) : le client ne choisit jamais son périmètre |
| Types autorisés | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` (liste blanche **partagée** avec le presign) |
| Vérifications AVANT écriture | SHA-256 annoncé = reçu (`MEDIA_CHECKSUM_MISMATCH`), **signature binaire** du fichier (`MEDIA_CONTENT_MISMATCH`) |
| Plafonds | produit **8 Mio** → 422 `MEDIA_TOO_LARGE` bilingue ; dur multer 12 Mio → **413 JSON** bilingue ; nginx `client_max_body_size 12M` (aligné) |
| Consentement | `children_in_photo` (JSON, champ répété ou valeur unique) → `all_consents_checked`, publication parent soumise à `photoConsentsAllowed` |

**Ce qui reste du volet B, dit tel quel (aucun cliquet baissé)** :

1. **Client `staff-mobile` non basculé** — `media_uploader.dart` appelle encore
   `POST /media/presign-upload` puis un `PUT` signé. En production, l'API répond désormais 503
   `UPLOAD_VIA_API_REQUIRED` : le mobile doit appeler `POST /media/upload` en multipart (même
   jeton). **Non exécutable ici** : aucun SDK Flutter dans l'environnement (l'édition serait livrée
   sans preuve compilée, ce que la règle du plan interdit) → **BLOQUÉE** (outillage), à faire avec L3.
2. **Photos hors-ligne (`add_photo`) : octets jamais transférés** — défaut **constaté par exécution**
   pendant ce lot (preuve en §3.2, bloc « Défaut découvert »). L'asset est créé, aucun objet
   n'existe, la lecture rend 404 `MEDIA_CONTENT_MISSING`. Correctif = côté client (mettre les
   octets en file locale puis `POST /media/upload` à la reconnexion) : même blocage outillage.
   **Décision serveur à trancher : dossier D6** (§6). Faire transiter du base64 dans `POST /sync/push` est
   désormais **refusé par le serveur** (lot L2E, journal §5) : tout payload d'opération de plus de
   16 Ko, ou contenant une chaîne de ≥ 4096 caractères strictement base64 — quel que soit le nom du
   champ —, est rejeté (`PAYLOAD_TOO_LARGE_FOR_SYNC` / `PAYLOAD_BINARY_NOT_ALLOWED`, message nommant
   `POST /api/v1/media/upload`). L'option (b) de D6 n'est donc plus un simple dimensionnement à
   trancher : elle exigerait de **relever explicitement** ce garde.
3. **Clips vidéo** — `POST /video/clips/presign-upload` est désormais **fail-closed** en production
   (même garde 503, message nommant la dépendance) au lieu de rendre une URL `minio:9000` morte.
   Le **téléversement de clips par l'API n'est pas livré** : fichiers vidéo (dizaines/centaines de
   Mio), il demande un dimensionnement dédié (flux, temporisation, quota) — hors du périmètre
   « photo » de ce lot, explicitement listé ici plutôt que passé sous silence.

#### Preuves exécutées (2026-09-24, PostgreSQL 18.4 réel, `STORAGE_BACKEND=local`)

```
node tests/tenant-isolation/phase66-content-same-origin.api.test.mjs
  → ✓ Phase 66 validée — 30 vérifications (média personnel, parent, exports, PDF, clips, verrou statique)
  dont : « GET sur le lien rendu → 200 et OCTETS IDENTIQUES au fichier stocké »,
         « Consentement révoqué : le MÊME lien → 422 CONSENT_REVOKED, aucun octet »,
         « Clé `..` (hors racine de stockage) → 422 PATH_TRAVERSAL, aucune lecture »,
         « Personnel : PDF → 200 application/pdf … AUCUNE redirection 302 vers le stockage »,
         « Clip S3 : toujours un chemin same-origin (aucun `http://minio…` rendu au client) »,
         « Aucun `presignGet(` dans apps/api/src ».

# Suites historiques mises à jour (elles affirmaient l'ancien contrat cassé) :
phase6.api.test.mjs                      → ✓ Phase 6 validée (média : chemin same-origin + octets servis)
phase7-parent.api.test.mjs               → ✓ Phase 7 validée (photo parent : chemin + octets réels)
phase13-exports.api.test.mjs             → ✓ Phase 13 exports validée (8 cas)
phase21-video-surveillance.api.test.mjs  → ✓ Phase 21 validée (8 cas)
phase38-parent-financial-projection.api  → H2d financial projection: 44 passed, 0 failed
phase41-photo-consent-scope.api.test.mjs → H2g photo consent: 58 passed, 0 failed
phase37-parent-revocation.api.test.mjs   → H2c parent access: 157 passed, 0 failed (+1 preuve d'octets)
phase25-security-audit-c.api.test.mjs    → ✓ phase25 — tous les scénarios C1/C2/C4/C3/C5 verts
phase34-sync-completion.api.test.mjs     → F completion: 10 passed, 0 failed
phase3.api.test.mjs (base fraîche)       → ✓ Phase 3 validée

# Qualité (cliquets inchangés) :
npm run test:unit   → 13 suites, 95 tests, 0 échec
npm run lint        → exit 0 (0 erreur, 0 warning)   npm run typecheck → exit 0 (4 workspaces)
npm run test:unit --workspace @creche/admin-web → 7 tests, 0 échec
node scripts/inventory-route-guards.mjs → 198 routes (195 + 2 `/content` + 1 `/media/upload`) — 50 « sans
  @Roles ni @Public » (49 + la route parent, dont le périmètre est la filiation, pas un rôle)

# Deux suites NON rejouables dans ce bac à sable (prérequis Gate D) :
phase22-audit-fixes.api / phase49-storage-selection → échec AU DÉMARRAGE du process de production
  (« DATABASE_ROLE_UNSAFE : creche_app NOSUPERUSER NOBYPASSRLS requis ») : le rôle de production
  `creche_app` n'existe pas ici (seul `creche_app_test` est bootstrappé). Ce n'est pas une
  régression du lot 2 — l'échec précède toute route — et ces suites tournent en Gate D.
```

**Hors périmètre / non vérifié ici** : les deux fichiers Dart modifiés
(`apps/parent-mobile/lib/core/api_client.dart`, `…/features/photos/photos_page.dart`) ne sont
**pas compilés** dans cet environnement (aucun SDK Flutter/Dart) — même blocage que le lockfile du
lot 3. Ils sont écrits pour `dio` + `flutter_secure_storage` déjà en dépendance.

#### Preuves exécutées — volet B (upload média), 2026-09-24

```
# Suite d'isolation NOUVELLE (31 vérifications) — PostgreSQL 18.4 réel, STORAGE_BACKEND=local,
# fichiers réels écrits dans STORAGE_LOCAL_DIR :
node tests/tenant-isolation/phase67-media-upload.api.test.mjs
  → ✓ Phase 67 validée
  dont : « POST /media/upload → 201 (plus jamais d'URL `http://minio…` rendue au mobile) »,
         « Clé construite côté serveur sous le préfixe de l'organisation »,
         « Objet réellement écrit dans le stockage » + « Octets stockés IDENTIQUES aux octets envoyés »,
         « GET sur le lien → 200 et octets identiques (aller-retour complet) »,
         « SHA-256 annoncé ≠ reçu → 422 MEDIA_CHECKSUM_MISMATCH » + « AUCUNE écriture disque »,
         « Contenu texte annoncé `image/jpeg` → 422 MEDIA_CONTENT_MISMATCH (signature binaire) »,
         « 9 Mio → 422 MEDIA_TOO_LARGE bilingue » ; « 13 Mio → 413 JSON (jamais une page HTML) »,
         « `child_id` d'une AUTRE organisation → refus » ; « rôle parent → 403 » ; « sans jeton → 401 »,
         « `children_in_photo` JSON en multipart est bien interprété » + « CONSENT_REQUIRED » puis
         « Avec consentement → publication acceptée » + « Le parent lit la photo téléversée » puis
         « Consentement révoqué → 422 CONSENT_REVOKED sans octets »,
         « Presign d'upload refusé en production sans origine publique (503 UPLOAD_VIA_API_REQUIRED) »,
         « nginx autorise le plafond dur multer (12M) ».

# Tests unitaires NOUVEAUX (15 cas) sur les règles du volet B :
apps/api/src/modules/media/storage.service.spec.ts → 6 ✓ (garde 503 / presign légitime dev+option B,
  écriture locale au chemin exact, refus `..` (PATH_TRAVERSAL), assainissement de `storageKey`)
apps/api/src/modules/media/dto/media.dto.spec.ts   → 9 ✓ (children_in_photo JSON / champ répété /
  valeur unique / absent, exif_stripped 'true'|'1'|'false', UUID invalide refusé, liste blanche
  partagée avec le presign — SVG refusé)

# Vérification manuelle de bout en bout (avant d'écrire la suite) : UPLOAD 201 →
#   DOWNLOAD chemin same-origin → CONTENT 200 « OCTETS IDENTIQUES » → CONSENT_REQUIRED,
#   puis CHECKSUM FAUX 422 / TYPE MENTEUR 422.
```

**Défaut découvert pendant ce volet (et non corrigé ici, dit tel quel)** — la photo prise
**hors ligne** n'atteint jamais le stockage. Le client met bien les octets (base64) dans le payload
`add_photo`, mais le serveur (`sync.service.ts applyAddPhoto`) ne lit que `storage_key`/`mime_type` :
l'asset est créé, aucun objet n'est écrit, et la lecture rend un 404. Exécuté (script ad hoc, base
réelle, supprimé après) :

```
SYNC PUSH 200 {"accepted":["e9525595-…"],"rejected":[],"conflicts":[]}
ASSET CRÉÉ  da981832-e869-4f57-adb7-05e996ded8c0/photo/offline-1.jpg
FICHIERS ÉCRITS DANS LE STOCKAGE []
LECTURE DU CONTENU 404 {"code":"MEDIA_CONTENT_MISSING", …}
```

Conséquence : une photo « prise hors ligne » est un enregistrement **fantôme** (visible dans les
listes, illisible). Le correctif est client (file locale d'octets → `POST /media/upload` à la
reconnexion) et dépend du point 1 ci-dessus ; le faire transiter en base64 par `POST /sync/push`
demanderait de relever la limite de corps JSON pour cette route (décision non prise).
**Découverte reportée à la vérification d'audit** (F5, volet B) plutôt que corrigée à l'aveugle.

### Lot 3 — `parent-mobile` : session, erreurs, tests, lockfile
1. **Session** : intercepteur Dio `401 → POST /auth/refresh` (single-flight), purge du stockage et
   retour à l'écran OTP sur échec — le `refresh_token` est stocké mais **jamais utilisé**
   aujourd'hui. Preuve : test widget (token expiré → refresh → requête rejouée ; refresh refusé →
   retour OTP).
2. **Erreurs** : `photos_page.dart:33` et `consents_page.dart:30` affichent un spinner **infini**
   en cas d'échec (`if (!s.hasData)`), à remplacer par un état d'erreur + réessai (le `feed_page`
   le fait déjà).
3. **Tests** : le dossier `apps/parent-mobile/test/` n'existe pas → widget tests (auth, erreurs)
   **exécutés en CI** (aujourd'hui `flutter.yml` ne lance `flutter test` que pour `staff-mobile`).
4. **Lockfile** : `pubspec.lock` absent + `flutter pub get` sans `--enforce-lockfile` côté parent,
   alors que `staff-mobile` est verrouillé (`check-staff-sync.mjs`). Aligner les deux.
   **BLOQUÉ — outillage requis, mesuré le 2026-09-24 (l'environnement de rédaction n'est pas le bon
   poste)** :
   - `git ls-files apps/parent-mobile | grep pubspec` → **`pubspec.yaml` seulement** (aucun
     `pubspec.lock`) ; côté `staff-mobile`, `pubspec.lock` **est** versionné. Les deux apps ont des
     plages `^` (parent : `dio ^5.7.0`, `flutter_secure_storage ^9.2.2`, `intl ^0.20.3`) ;
   - `apps/parent-mobile/test/` **n'existe pas** : `flutter.yml` ne lance `flutter test` que pour
     `staff-mobile` (parent = `pub get + analyze`) ;
   - les deux hôtes nécessaires sont **injoignables depuis cet environnement** :
     `storage.googleapis.com` (SDK Flutter, code HTTP **000**) et `pub.dev` (résolution des
     dépendances, **000**) — seuls `github.com` et `registry.npmjs.org` répondent (200). Un
     `pubspec.lock` écrit à la main serait **faux** (hashes des archives inconnus) : il ne sera pas
     fabriqué.
   - **À faire depuis un poste avec Flutter 3.47.1 et accès à pub.dev** : `flutter pub get` dans
     `apps/parent-mobile`, commiter `pubspec.lock`, ajouter `--enforce-lockfile` à l'étape CI, puis
     livrer le lot 3 (session + erreurs + tests). Ces points sont vérifiables **en CI** (le job
     `flutter` a le réseau) mais pas dans la sandbox de rédaction.
  - **Re-mesure du 25/09/2026 à 15:07 UTC** : `pub.dev` **000**, `storage.googleapis.com` **000**,
     `docs.flutter.dev` **000** ; seuls `api.github.com` **200** et `registry.npmjs.org` **200**
     répondent. Aucun binaire Flutter/Dart n'est installable par un autre chemin (ni npm, ni apt
     utilisable sans réseau Debian : `deb.debian.org` **000**). Le blocage est donc **stable et
     environnemental** — il ne se lèvera pas en attendant ; il faut l'outillage.
  - **Troisième mesure, 25/09/2026 à 16:42 UTC** (après le lot L2E) : `pub.dev` **000**,
     `storage.googleapis.com` **000**, `registry.npmjs.org` **200**, aucun binaire `flutter`/`dart`
     présent. **Verdict inchangé : L3 reste BLOQUÉE** — trois mesures dans la même journée, toutes
     identiques ; le reste de l'audit actionnable est livré (voir §5, journal L2E).

### Lot 4 — Rétention et mineurs *(décision DPO requise)*
- **File de notifications / messages** : aucune purge n'existe (`notification_queue`, `messages`) ;
  seuls les journaux et les clips vidéo (30 j) sont outillés. Décision : purge planifiée (tick
  `scheduler_ticks` + `SECURITY DEFINER` + suite dédiée) **ou** justification de conservation
  écrite au registre (limitation de conservation, loi 25-11).
- **Mineurs** : le fondement de la représentation légale (tuteur, `guardians`, `consent_records`)
  est implémenté ; ce qui manque est la **trace documentaire** au registre des traitements. À
  formaliser par le DPO, pas par du code.

### Lot 5 — Vérité documentaire anti-« regonflage » — **FAIT (2026-09-24)**

Sur le modèle d'`openapi-contract.test.mjs` : un test qui échoue si la documentation
redevient flatteuse. Livré : `tests/tenant-isolation/claims-contract.test.mjs`
(**8 contrôles**, aucune base ni Docker → exécuté dans le job CI `quality`, étape
« Contrat de vérité documentaire »).

| Contrôle | Ce qu'il verrouille |
|---|---|
| **1. Ordonnanceur externe** | le mot n'apparaît dans **aucun** fichier de code/config (l'ordonnancement est en base : `scheduler_ticks` + `scheduler_enqueue_due()`), et chaque mention documentaire doit être une **mise en garde** (négation, citation de l'affirmation auditée, commande de mesure) |
| **2. Healthcheck Docker** | la **réalité mesurée** : au lot 5, 1 bloc `healthcheck` par fichier compose **sur `postgres`** — **mis à jour au lot 6.1** (`postgres` + `api` + `worker` en prod/staging, `postgres` seul en dev) ; **aucun** `HEALTHCHECK` dans les Dockerfiles ; toute ligne de documentation qui cite un décompte (`grep -c healthcheck … # n`) doit correspondre au disque |
| **3. Compteurs** | migrations (75), entrées du runner (71), suites `phaseNN` (69), fichiers du dossier d'isolation (85), ADR (14), runbooks (32), routes HTTP (198) et chemins OpenAPI (13) sont **recalculés à chaque exécution** (dont l'inventaire des routes, exécuté) et confrontés aux documents qui les revendiquent |
| **4. Phrases bannies** | les deux affirmations fausses de l'audit (healthcheck généralisé, ordonnanceur externe pour les purges) et `presignGet(` ne peuvent réapparaître que **corrigées sur la même ligne** (`❌`, `→`, « aucun », « 1 seul »…) |

**Documents corrigés au passage** (le contrat les avait tous attrapés — c'est sa valeur) :

| Document | Affirmation périmée | Correction |
|---|---|---|
| `docs/LOCAL-RUN.md` | « 70 migrations » (×4) | 75 (mesure du disque) |
| `.github/workflows/ci.yml` | étape nommée « (196 routes × @Roles/@Public) » | 198 (inventaire exécuté) |
| `docs/VERIFICATION_ANALYSE_2026-09-24.md` | « sur 196 routes » ; « 692 fichiers » | 198 ; 700 fichiers **(mesure datée)** |
| `docs/P3-RAPPORT.md` | « EXPOSE / healthcheck alignés » | `postgres` uniquement + renvoi F2 |
| `docs/PLAN_IMPLEMENTATION.md` | compose dev avec « healthchecks » | healthcheck `postgres` uniquement (mesure datée) |
| `HANDOFF-AGENT-ANTIGRAVITY.md` | `# healthcheck OK` après `compose ps` | qualifié : `postgres` uniquement, renvoi F2 |

**Preuve par mutation** (convention du dépôt — un test qui ne peut pas échouer ne prouve rien) —
4 mutations, chacune détectée, puis restaurations vertes :

```
A) ci.yml : « 198 routes » → « 196 routes »                  → not ok 7 (compteurs — routes)   rc=1
B) LOCAL-RUN.md : « healthcheck OK » (non qualifié) ajouté   → not ok 3 (F2 docs)              rc=1
C) LOCAL-RUN.md : « HEALTHCHECK présent sur les services »   → not ok 3 (F2 docs)              rc=1
D) VÉRIFICATION : « 69 suites phaseNN » → « 66 »             → not ok 5 (compteurs — batterie)  rc=1
   restaurations                                             → 8/8 verts, rc=0
```

Deux limites assumées, écrites dans l'en-tête du contrat : (1) une **mesure de
volumétrie brute** (nombre de fichiers) n'est pas verrouillée — elle porte sa
**date** dans la phrase, car elle change à chaque commit ; (2) les compteurs
verrouillés (migrations, suites, ADR…) font **échouer la CI** quand on ajoute une
migration ou une suite sans mettre à jour les documents : c'est la friction
voulue — mettre à jour le document, jamais le contrat.

### Lot 6 (optionnel) — Worker et charge
- **L6.1 — santé API + worker : FAIT (2026-09-24).** Aucun `HEALTHCHECK` n'est écrit dans les
  Dockerfiles (l'image `node:22-slim` n'a ni `curl` ni `wget`) : les sondes sont des scripts Node
  appelés par Compose — et désormais `api` et `worker` sont sondés
  en **production et en staging** (les images `node:22-slim` n'ont ni `curl` ni `wget` :
  les sondes sont des scripts Node compilés, `apps/{api,worker}/dist/healthcheck.js`). API = `fetch`
  sur le vrai `GET /api/v1/health` ; worker = marqueur de vivacité local réécrit toutes les 10 s
  (`WORKER_LIVENESS_FILE`, écriture atomique), absent/périmé ⇒ conteneur redémarré, le bail de job
  en cours étant repris par `jobs_reap_stale` (migration 053). En **dev**, les sondes sont absentes
  *à dessein* (sources montées + compilation à chaud : `dist/` n'est pas garanti au démarrage) — le
  motif est écrit dans `docker-compose.dev.yml`, et le contrat de vérité mesure fichier par fichier.
  Preuves : §5 « L6.1 » ;
- `compress_media` : stub qui échoue explicitement (`main.ts:305`) — **décider** : implémenter
  (sharp/worker) ou retirer du handler (un stub permanent est une dette silencieuse).
  **Tranché (D3 = a, lot L6.3, 25/09)** : **retiré** — aucun chemin de code ne le mettait en file,
  l'envoi média est plafonné à 8/12 Mio et aucune bibliothèque de traitement d'image n'existe dans
  le dépôt ; un éventuel besoin de compression se traitera côté clients avant envoi (§5 « L6.3 ») ;
- `tests/load/sync.k6.js` : **jamais exécuté** (k6 absent) — soit l'exécuter sur une cible
  prod-like et publier les résultats, soit le retirer du discours « tests de charge ».
  **Tranché (L6.2, 25/09)** : k6 n'est pas installable ici (binaire absent, `dl.k6.io` et les
  assets GitHub injoignables, ni Docker ni Go) ⇒ le **critère** est désormais mesuré par le banc
  exécutable en **parité exacte** avec le scénario k6 (50 pushes × 10 ops = 500 ops : p95
  **1 406 ms** < 2 000 ms, 0 erreur, 500/500 écritures persistées), et la doc ne présente plus k6
  comme un test exécuté. Le script reste l'artefact ops à lancer sur une cible qui a k6 ;
  `scripts/verify-load-tests.mjs` (job `quality`) verrouille son seuil p95 ≤ 2 s et le fait que
  les documents vivants disent qu'il n'est pas exécuté. Preuves : §5 « L6.2 ».

---

## 5. Journal des preuves — Lot 1 (exécuté le 2026-09-24)

*(Le journal du lot 2 est dans sa section (§4 « Lot 2 ») — mêmes règles : sorties réelles.)*

Environnement : `node v22.22.3`, `npm 10.9.8`, `npm ci` → 929 paquets. Poste **sans** PostgreSQL,
Docker ni SDK Flutter (d'où les tâches marquées BLOQUÉES). Toutes les sorties ci-dessous sont
**réelles**, copiées des commandes exécutées.

```
# Gardiens orphelins — ligne de base AVANT câblage CI (tous verts)
node scripts/check-env-example.mjs        → exit 0  (« .env.prod.example : 14 variables requises présentes », « .env.example : 5 »)
node scripts/check-android-manifest.mjs   → exit 0  (« 2 app(s) conformes, 4 avertissements »)
node scripts/inventory-route-guards.mjs   → exit 0  (« 195 routes HTTP inventoriées — 49 sans @Roles ni @Public (à revoir) »)
  # après L2 (2 routes `/content` ajoutées) : « 197 routes — 50 sans @Roles ni @Public » — le +1 vient
  # de la route parent, dont le périmètre est la filiation (child_guardians), pas un rôle.
node scripts/verify-load-tests.mjs        → exit 0  (« Sanity checks load tests : OK »)
node scripts/check-rls-usage.mjs          → exit 0  (mode FALLBACK sans DATABASE_URL : « 52 accès pool.query brut(s) tous conformes »)
node scripts/check-spa-static-paths.mjs   → exit 0  (déjà en CI, non régressé)

# Garde de config (L1.1) — avec le refus RATE_LIMIT_DISABLED
npx jest --config apps/api/jest.config.mts --rootDir apps/api --testPathPatterns production-config --coverage=false
  → PASS — 11 tests / 11, dont « L1 : RATE_LIMIT_DISABLED='true'|'1' bloquée en production… »

# PREUVE PAR MUTATION (L1.1) — bloc retiré de packages/prod-config/src/index.ts :
  ✕ L1 : RATE_LIMIT_DISABLED='true'|'1' bloquée en production…   → 1 failed, 10 passed
  bloc restauré → 11 passed (le test échoue SANS le correctif, il a donc une valeur)

# Contrat d'en-têtes de bord (L1.3)
node --test tests/tenant-isolation/edge-headers-contract.test.mjs → 7 tests, 7 passés
  # PREUVE PAR MUTATION : CSP retirée de infrastructure/nginx/nginx.conf → 4 tests rouges ; restaurée → 7 verts.

# Batch des contrats de Gate D (8 fichiers, le nouveau inclus)
node --test tests/tenant-isolation/{ci-notice-budget,registry-pull,dev-compose-contract,dev-proxy,
  openapi-contract,client-leak-guard,on-conflict-targets,edge-headers-contract}.test.mjs → 35 tests, 35 passés

# Cliquets et qualité (gates CI reproduits localement)
npm run test:unit   → 13 suites, 95 tests, 0 échec ; seuils de couverture respectés (exit 0)
npm run lint        → eslint . --max-warnings=0 → exit 0
npm run typecheck --workspace @creche/api && --workspace @creche/prod-config → exit 0

# Validité du workflow (un YAML cassé = CI qui ne tourne plus, sans diff visible)
js-yaml sur les 4 workflows → valides. Le premier jet de ce lot ÉTAIT cassé
  (« bad indentation … line 76 » : un « : » non échappé dans un `name:`),
  détecté par cette validation et corrigé (nom entre guillemets) — la leçon est
  écrite dans le fichier, à l'endroit exact.
```

**Sortie attendue côté CI** : job `quality` = 4 nouveaux gardiens verts + lint/tests inchangés ;
job `database` = Gate D (avec `edge-headers-contract`) + 69 suites d'isolation inchangées (aucun
fichier de ces suites n'est modifié par L1). Le job `flutter-check` reste **non concerné** (aucun
fichier Dart touché dans ce lot).

---

### L1.4 — régression du lot 1 : reproduction, correctif, verrou (2026-09-24, soir)

Environnement : PostgreSQL 18.4 embarqué (port 54329), `node v22.22.3`, `apps/api` +
`apps/worker` compilés. Docker et SDK Flutter absents (les sous-gates H1/F2/F4 s'écartent
d'eux-mêmes : « NOT EXECUTED locally (Docker required) »).

```
# 1) Reproduction de la condition du job CI — le job exporte RATE_LIMIT_DISABLED=true
$ DATABASE_URL=… ALLOW_DATABASE_RESET=1 RATE_LIMIT_DISABLED=true \
    node --test tests/tenant-isolation/phase26-production-roles.test.mjs
not ok 10 - D2 : vrais entrypoints API ET worker sortent en erreur, avant de servir/claim
    The input did not match the regular expression /DATABASE_ROLE_UNSAFE/. Input:
      "- RATE_LIMIT_DISABLED: désactivation de la limitation de débit interdite en production …"
not ok 13 - D2 : API et worker démarrent réellement en production avec creche_app
    Boot exit 1 : GARDE CONFIG PRODUCTION — démarrage REFUSÉ (corrigez le .env puis relancez) :
      - RATE_LIMIT_DISABLED: … interdite en production
# pass 12
# fail 2                       ← signature EXACTE du rouge CI « Gate D interrompu :: … phase26 »

# 2) Même commande après correctif
# pass 15
# fail 0

# 3) Verrou anti-régression — mesuré sur le contenu de HEAD puis sur l'arbre
HEAD (avant) → 5 fichier(s) : phase22-audit-fixes.api.test.mjs, phase26-production-roles.test.mjs,
                             phase27-worker-lifecycle.test.mjs, phase28-worker-reliability.test.mjs,
                             phase49-storage-selection.test.mjs
arbre (après) → 0 fichier(s) :

# 4) Premier passage de la batterie avec le correctif : elle a trouvé UN défaut de plus,
#    oublié dans le correctif lui-même (import manquant) — 71/72 et une seule suite rouge :
FAIL  phase22-audit-fixes.api.test.mjs           0
  ReferenceError: PRODUCTION_SPAWN_ENV is not defined
  → corrigé, puis rejoué seul en mode rôles de production : « PASS phase22 … 44 assertions ✓ »

# 5) Gate D COMPLET, environnement fidèle au job « database » (correctif + verrou)
$ DATABASE_URL=… RATE_LIMIT_DISABLED=true NODE_ENV=test STORAGE_BACKEND=local \
    STORAGE_LOCAL_DIR=/tmp/creche-storage-ci PAYMENT_WEBHOOK_SECRET=phase8-test-secret \
    ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
… phase26 : # pass 15 / # fail 0
PASS  phase22-audit-fixes.api.test.mjs           44 assertions ✓
PASS  phase27-worker-lifecycle.test.mjs          14 assertions ✓
PASS  phase28-worker-reliability.test.mjs        23 assertions ✓
PASS  phase47-invitations.api.test.mjs           38 assertions ✓   (rouge « par conception » en mode 1)
PASS  phase49-storage-selection.test.mjs         48 assertions ✓   (idem)
═══════════ 72/72 suites vertes ═══════════
✓ GATE D : régressions Phase D + 59 suites/contrôles (E1–E6 incluses) avec rôles et grants de production.
GATE EXIT=0                        ← première fois que la batterie va au bout sous cette condition
```

C'est la **première** exécution de bout en bout de la batterie sous l'environnement du
job CI : les contrôles `phase27`, `phase28`, `phase47` et `phase49` (rouges « par
conception » en mode canon local, cf. `docs/LOCAL-RUN.md`) sont **verts en mode rôles
de production**, et les deux suites du lot 2 (`phase66` : 35 assertions, `phase67` :
37 assertions) passent avec les rôles de production.

**Non couvert localement** : les sous-gates Docker (H1 staging/dev) et Flutter (F2/F4)
— leur échec CI (`Registry pull failed … unauthorized`) reste **ouvert et
environnemental** (voir `docs/CI-DATABASE-JOB-FINDINGS.md`).

### L5 — vérité documentaire : contrat, mutations, corrections (2026-09-24)

```
# Contrat (aucune base, aucun Docker) :
$ node --test tests/tenant-isolation/claims-contract.test.mjs
# tests 8 / # pass 8 / # fail 0

# Preuve par mutation (4 mutations, chacune détectée) :
A — compteur de routes périmé             rc=1  ['not ok 7 - compteurs — routes HTTP et chemins OpenAPI']
B — affirmation healthcheck non qualifiée rc=1  ['not ok 3 - F2 — aucune documentation ne revendique…']
C — phrase fausse canonique réintroduite  rc=1  ['not ok 3 - F2 — aucune documentation ne revendique…']
D — compteur de suites périmé             rc=1  ['not ok 5 - compteurs — batterie d'isolation…']
restaurations                             rc=0  échecs=0

# Gardiens du job `quality` rejoués localement (tous verts) :
node scripts/check-env-example.mjs        → ✓ 5 variables (+14 côté .env.prod.example)
node scripts/check-android-manifest.mjs   → « Un build release aura bien l'accès réseau. »
node scripts/inventory-route-guards.mjs   → 198 routes HTTP inventoriées — 50 sans @Roles ni @Public
node scripts/verify-load-tests.mjs        → seuils p95 des scripts de charge OK
node scripts/check-spa-static-paths.mjs   → ✅ chemins statiques cohérents
node --test …/claims-contract.test.mjs    → 8/8
```

Le contrat a également attrapé **sa propre** documentation : un commentaire CI
introduit pendant ce lot nommait l'ordonnanceur absent → contrôle 1 rouge
(« implémentation inattendue : .github/workflows/ci.yml »), reformulé sans le mot.

### L6.1 — sondes de vivacité API et worker : correctif, verrous, mutations (2026-09-24, soir)

**Défaut corrigé (F2)** : seul `postgres` était sondé ; l'API exposait `GET /api/v1/health` sans que
Docker l'interroge, et le worker — sans port — n'avait **aucun** marqueur de vie. Un processus vivant
mais figé restait en service.

**Correctif livré** :
- `apps/api/src/healthcheck.ts` : sonde Node (`fetch`, `AbortSignal.timeout`) sur le vrai endpoint
  public — logique dans `checkApiHealth()` (testable **sans build**) et entrée CLI sous
  `require.main === module` ; **pourquoi** : la première version du test lançait l'artefact compilé
  `apps/api/dist/healthcheck.js`, or le job CI `quality` **ne construit pas** l'API (contrairement à
  `database`) → la spec tombait au chargement et rougissait la CI. Le CLI compilé reste prouvé par
  exécution (rc=0 contre l'API réelle, rc=1 sur port mort) ; `apps/worker/src/healthcheck.ts` + `apps/worker/src/liveness.ts` : marqueur local réécrit
  toutes les 10 s, écriture atomique, supprimé à l'arrêt propre ; marqueur absent/périmé ⇒ sortie 1.
- `docker-compose.prod.yml` / `.staging.yml` : sonde Docker (`node apps/<ws>/dist/healthcheck.js`)
  sur `api` (start_period 30 s) et `worker` (60 s), interval 30 s / timeout 5 s / retries 3 ; en
  **dev**, aucune sonde et le motif est écrit dans le fichier. Le heartbeat `jobs_heartbeat` (053) n'existe que pendant un job : il ne pouvait pas servir
  de vivacité au repos (décision tracée).
- Portes de tests : `apps/worker/jest.config.mts` (le worker n'en avait aucune) et `test:unit`
  racine = api **puis** worker ; CI `quality` renommée « Tests unitaires api + worker ».

**Preuves exécutées** :
```bash
# 1) unités (porte racine) : api 16 suites/117 tests, worker 1 suite/5 tests — tous verts
npm run test:unit

# 2) bout en bout hors Docker (API réelle reconstruite, PG 18 local, rôle creche_app_test)
node apps/api/dist/main.js &                    # :3399, « API prête »
APP_PORT=3399 node apps/api/dist/healthcheck.js # rc=0 « API saine » ; port mort → rc=1 « API indisponible »

# 3) worker réel : marqueur rafraîchi → rc=0 ; antidaté 60 s → rc=1 « périmé » ;
#    après SIGTERM (arrêt propre) marqueur supprimé → rc=1 « absent »
WORKER_LIVENESS_INTERVAL_MS=2000 node apps/worker/dist/main.js &
node apps/worker/dist/healthcheck.js

# 4) compensations de l'audit du 2026-09-24, cohérence de forme
node -e "…js-yaml…"   # prod/staging : healthcheck = [postgres, api, worker] ; dev : [postgres]
```

**Verrous ajoutés au contrat (mesure mise à jour, jamais contournée)** :
1. mesure **par fichier** des services sondés (`postgres` partout ; `api` + `worker` en prod/staging) ;
2. toute sonde Node référencée par Compose doit avoir sa **source** dans le dépôt
   (`apps/<ws>/dist/<f>.js` ⇒ `apps/<ws>/src/<f>.ts`) — un renommage laisse un conteneur
   éternellement `unhealthy` ;
3. tout décompte cité dans la doc (`grep -c healthcheck <compose> # n`) doit correspondre au disque.

**Mutations (7 exécutées, 7 rouges, restaurations → 9/9 vert)** :
```
A — route périmée (lots 1/5)                        rc=1  ['not ok 7 - compteurs — routes HTTP…']  (lot 5)
B — phrase « healthcheck » non qualifiée            rc=1  ['not ok 4 - F2 — aucune documentation…'] (lot 5)
C — phrase fausse canonique réintroduite            rc=1  ['not ok 9 - affirmations fausses…']    (lot 5)
D — compteur de suites périmé                       rc=1  ['not ok 6 - compteurs — batterie…']    (lot 5)
E — décompte de healthchecks périmé dans la doc     rc=1  ['not ok 3 - F2 — un décompte…']
F — sonde renommée sans source (compose prod)       rc=1  ['not ok 2 - … sonde … introuvable']
G — service qui gagne une sonde (minio, mutation exploratoire) rc=1 ['not ok 2 — mesuré : postgres,minio,…']
K — nom de l'image retiré de l'erreur H1 (lot 1.6)   rc=1  ['not ok 8 — the failing image is named…'] (registry-pull)
restaurations                                       rc=0  9/9 vert
```
Le verrou a d'ailleurs attrapé **deux défauts de sa propre écriture** avant d'être accepté : un motif
qui débordait du bloc `postgres` vers `api` (sonde attribuée au mauvais service) et un contrôle
d'existence portant sur `dist/` (artefact de build, absent du dépôt) au lieu de la source. Un verrou
qui n'a jamais rien attrapé n'est pas un verrou.

### L1.5 — 5ᵉ gardien orphelin, et cliquet « gardiens câblés » (2026-09-24, soir)

Le lot 1 avait câblé les 4 gardiens orphelins nommés par l'audit (§4.3). En recensant la classe
**entière** au lieu des 4 cas cités, un cinquième apparaît : `scripts/audit-seeds-pii.mjs` — la preuve
que les seeds (SQL + pilote) sont 100 % synthétiques (téléphones DZ, emails, NIN), écrite pour la CI
(« sortie JSON friendly CI », option `--strict`) mais appelée par **aucun** workflow.

**Livré** :
1. `scripts/check-guards-wired.mjs` : calcule, **par fermeture transitive** depuis les workflows
   (racines = `.github/workflows/*.yml` ; appelants = `package.json`, `scripts/`, `tests/`, fichiers
   `.yml` sous `infrastructure/`), si chaque script de garde (`check-*`, `audit-*`, `verify-*`,
   `inventory-*` — convention de nommage) est atteignable. Un gardien que rien n'appelle ne garde
   rien : il rougit avec la liste des orphelins ;
2. les deux étapes CI dans le job `quality` : « Gardiens câblés (aucun gardien orphelin) » et
   « Audit PII des seeds (100 % synthétiques, mode strict) ».

**Preuves exécutées** :
```bash
node scripts/check-guards-wired.mjs --verbose   # 12 gardiens, 0 orphelin, rc=0
node scripts/audit-seeds-pii.mjs --strict       # 5 occurrences, 5 synthétiques, 0 suspecte, rc=0
```

**Mutations (3 exécutées, 3 rouges, restaurations vertes)** :
```
H — étape CI du gardien PII supprimée        rc=1  ['1 gardien(s) que rien n'appelle : scripts/audit-seeds-pii.mjs']
I — nouveau gardien sans appelant            rc=1  ['ORPHELIN scripts/check-mutation-fictive.mjs']
J — PII « réelle » injectée dans un seed     rc=1  ['domaine gmail.com non reconnu comme synthétique'] (audit --strict)
restaurations                                12/12 câblés ; audit PII rc=0
```

### L1.6 — H1 : nommer l'image qui refuse le tirage (2026-09-24, soir)

`scripts/test-staging-stack.mjs` **construit** ses images applicatives localement et ne tire du
registre que **deux images publiques** (`postgres:18-alpine`, `quay.io/minio/minio`). L'annotation CI
disait « Registry pull failed … unauthorized » **sans dire laquelle** : inexploitable pour l'ops, qui
ne pouvait pas distinguer « registre privé sans credentials » de « tirage anonyme refusé ».

**Correctif** : `scripts/registry-pull.mjs` nomme l'image dans l'erreur
(`Registry pull failed for <image>: …`). Le comportement est **inchangé** : réessais uniquement sur
timeout réseau, échec définitif immédiat sinon, aucun repli vert.

**Preuve** : `tests/tenant-isolation/registry-pull.test.mjs` — nouveau cas « the failing image is
named in the error » pour les **deux** images (9/9 verts) ; **mutation K** (retrait du nom) →
`not ok 8`, restauration → 9/9. Le test est exécuté en CI (Gate D, lot E2).

### L1.7 — H1 : diagnostic affiné et remédiations d'exploitation (2026-09-24, soir)

**Diagnostic affiné** (annotations du run `8cc7583`, grâce au nommage du lot 1.6) : la boucle essaie
`postgres` **en premier** et il **passe** ; c'est **`quay.io/minio/minio`** qui échoue — deux fois
(staging + dev). Le blocage est donc **précisément Quay.io**, pas « un registre » en général : Docker
Hub fonctionne depuis le runner.

**Livré (deux voies, aucune ne fabrique un vert)** :
1. **Miroir** — `image: ${MINIO_IMAGE:-quay.io/minio/minio:…@sha256:14cea493…}` dans les trois
   composes. L'exploitant pointe son miroir sans toucher au dépôt ; le **défaut** reste épinglé par
   digest et **identique** dans les trois fichiers. `test-staging-stack.mjs` tire la config RÉSOLUE
   par compose (`config.services[name].image`), donc la surcharge est réellement opérante.
2. **Identifiants** — le job `database` expose `QUAY_USERNAME`/`QUAY_PASSWORD` (secrets de dépôt,
   vides par défaut) et une étape **conditionnelle** `docker login quay.io` (mot de passe par
   `--password-stdin`). Sans secrets, l'étape est ignorée : comportement inchangé.

**Preuves exécutées** : contrat compose **16/16**, `registry-pull` **11/11**, contrat de vérité
documentaire **9/9** ; YAML du workflow validé (étape lue : `if: env.QUAY_USERNAME != ''`).

**Mutations (4 exécutées, 4 rouges, restaurations diff-vérifiées)** :
```
L — connexion Quay rendue inconditionnelle      rc=1  ['la connexion doit être facultative…']
M — mot de passe passé en argument (--password) rc=1  ['mot de passe par stdin, jamais en argument']
N — digest MinIO divergent dans un seul fichier rc=1  ['digest MinIO inattendu' + 'digests divergents']
O — MinIO revenu en dur (surcharge perdue)      rc=1  ['… doit être image: ${MINIO_IMAGE:-…} (surcharge H1)']
restaurations (diff -q avec la sauvegarde)      36/36 verts
```

**Vérifié en CI** (run `36140324519`, commit `7945c85`, 25/09) : étape « Registre Quay
(facultatif — H1) » = **`skipped`** (secrets absents, job intact), job vert jusqu'à l'étape 14
(build inclus), échec final limité aux **deux** tirages Quay (dev + staging) — signature H1
inchangée, aucun régression introduite. Deuxième run du jour (`36139870972`, `f442176`) : même
signature H1 ; son `quality` rouge est une **instabilité** (rejeu local `dist/` supprimé : 3/3 vert,
117+5 tests) — voir `docs/CI-DATABASE-JOB-FINDINGS.md`, section « Anomalie `quality` du 25/09 ».

### L6.2 — k6 : mesurer le critère avec le banc exécutable, aligner le discours (2026-09-25)

**Diagnostic (mesuré)** : `which k6` → absent ; `dl.k6.io` → **000** (injoignable) ; l'asset de
release GitHub répond **302** vers `objects.githubusercontent.com`, lui aussi injoignable (000) ;
ni `docker` ni `go` dans l'environnement. Installer k6 ici est donc **impossible** — même
constat que le SDK Flutter (L3). Aucun paquet npm ne fournit le binaire (`k6@0.0.0` = paquet
factice d'autocomplétion).

**Issue retenue** (le plan en laissait deux : exécuter sur une cible prod-like **ou** retirer du
discours) : le **critère** est mesuré par le banc exécutable, en **parité exacte** avec le
scénario k6, et la documentation cesse de présenter k6 comme un test exécuté.

**Mesure de parité (réelle, 2 vCPU, PG 18.4 local, API compilée en processus)** :

```bash
# 50 pushes concurrents × 10 ops = 500 ops — la forme exacte du scénario k6
DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test \
  ORGS=10 DEVICES=5 OPS=10 BURST_ROUNDS=0 node tests/load/capacity-bench.mjs
# → 290 requêtes en 4,9 s — 5xx: 0, réponses inattendues: 0
#   ✓ login      n=20  p95 1909 ms (budget 3000)
#   ✓ checkin    n=150 p95   95 ms (budget 250)
#   ✓ sync_push  n=50  p95 1406 ms (budget 3000 ; critère k6 : < 2000)   ← verdict
#   ✓ feed       n=10  p95   78 ms (budget 1500)
#   ✓ dashboard  n=10  p95   90 ms (budget 1500)
#   ✓ événements de journal persistés : 500 / 500 — ✓ Capacité (10 structures simultanées)
```

Variante « taille de lot » (10 ops par requête, un tour de rafale) : `ORGS=12 DEVICES=2 OPS=10
BURST_ROUNDS=1` → 480 ops en 48 requêtes, p95 sync_push **1807 ms**, 480/480 écritures, 0 erreur
(budgets tenus). Sensibilité mesurée avec des lots de 21 ops (`OPS=21 BURST_ROUNDS=3` → 2 016
écritures) : p95 sync_push 2 909 ms (budget 3 000 ✓) mais p95 dashboard 1 545 ms **> budget
1 500** ⇒ le cliquet `dashboard` est serré sur 2 vCPU ; cette exécution n'est pas retenue comme
verdict (elle change deux variables à la fois) et est consignée comme sensibilité.

**Ce qui reste à faire (dépend d'un poste/cible, pas du code)** : rejouer `k6 run
tests/load/sync.k6.js` (toujours **non exécuté** ici) sur une cible prod-like (S4 de `docs/PLAN_REMEDIATION_FINAL.md`). Le
script n'est pas retiré : il est l'artefact ops de cette exécution-là.

**Verrou ajouté** (`scripts/verify-load-tests.mjs`, déjà câblé dans le job `quality`) — 4
contrôles de plus, 18 au total : en-tête du script déclarant **« NON EXÉCUTÉ »** ; seuil
`p(95) ≤ 2000 ms` non relâchable ; **commande de parité documentée** ; et « aucun document vivant
(README, HANDOFF, ROADMAP_V2, ANALYSE_PILIERS_MANQUANTS, ce plan) ne présente k6 comme exécuté »
(contrôle par **paragraphe**, pas par ligne : un constat d'honnêteté peut tenir sur la phrase
suivante).

**Preuve que le verrou mord** : il est **passé rouge avant** la mise à jour des documents
(2 contrôles en échec : commande de parité absente + 4 mentions sans marqueur), puis vert (18/18)
après. Mutations exécutées sur le verrou, restaurations `diff -q` vérifiées :

```
P  — en-tête k6 : marqueur « NON EXÉCUTÉ » retiré      rc=1  ['k6 : en-tête déclarant « NON EXÉCUTÉ »']
P' — seuil k6 relâché (p(95)<3000)                     rc=1  ['k6 : seuil p95 ≤ 2000 ms (promesse non relâchée) — p95<3000ms']
Q  — README affirme que k6 tourne en CI                rc=1  ['docs vivants … — README.md:40']
R  — commande de parité retirée de ce plan             rc=1  ['docs : commande de parité k6 … documentée']
restaurations (diff -q avec les sauvegardes)           identiques ✓
```

Une cinquième mutation a été **écartée comme invalide** : supprimer le gardien lui-même ne peut pas
être détecté par le gardien (auto-référence) — c'est le rôle de `check-guards-wired.mjs`, qui exige
que tout script `verify-*` de `scripts/` soit appelé par un workflow.

### L5.1 — vérité documentaire : « workflows CI poussés » (2026-09-25)

**Constat (mesuré)** : trois affirmations périmées survivaient dans le document d'état courant
`docs/HANDOFF.md` — les workflows y étaient décrits comme « prêts, en attente de poussée », avec la
restriction de permission de la GitHub App (l'épisode est raconté, daté, dans `docs/CI-RESTORE.md`),
y compris dans la ligne du tableau récapitulatif. Or `git ls-files .github/workflows` renvoie
**4 fichiers** (`ci.yml`, `docker.yml`, `flutter.yml`, `security-audit.yml`) et les runs du 25/09
montrent `quality`, `docker`, `flutter`, `security`, `e2e`, `admin-web`, `support-console`,
`backup-drill` **verts** (seul `database` est rouge, sur H1 documenté). Un lecteur du HANDOFF
pouvait donc croire que la CI n'existait pas. `ci-templates/README.md` portait la même consigne
obsolète (`git mv ci-templates/workflows/… .github/workflows/`) alors que le dossier ne contient
plus aucun workflow.

**Correctif** : les trois passages du HANDOFF disent l'état réel (+ renvoi vers
`docs/CI-DATABASE-JOB-FINDINGS.md` pour H1) ; `ci-templates/README.md` devient une note
explicitement **historique** (« la restriction est levée depuis ») ; et le **10ᵉ contrôle** du
contrat de vérité verrouille la règle : les quatre workflows existent et ne sont pas vides, **aucun**
`.yml`/`.yaml` ne dort dans `ci-templates/`, et aucun document de référence ne revendique l'état
ancien ailleurs que dans un récit explicitement historique (`ci-templates/README.md` entre dans
`REFERENCE_DOCS`).

**Preuves exécutées** : `node --test tests/tenant-isolation/claims-contract.test.mjs` → **10/10**
(le contrôle est **passé rouge** dès sa première exécution, avant correction : 3 mentions du HANDOFF).
Mutations exécutées sur le nouveau contrôle, restaurations `diff -q`/`diff -rq` vérifiées :

```
T — état d'époque réintroduit dans HANDOFF (CI « hors dépôt »)   rc=1  ['docs/HANDOFF.md:266 → | CI | Workflows …']
U — un workflow redéposé dans ci-templates/workflows/            rc=1  ['des workflows dorment encore hors de .github/workflows/ : ci-templates/workflows/ci.yml']
V — un workflow supprimé de .github/workflows/                   rc=1  ['workflow absent du disque : .github/workflows/flutter.yml']
restaurations (diff -q HANDOFF, diff -rq .github/workflows)      identiques ✓
```

**Périmètre assumé** : les documents datés (`docs/CI-RESTORE.md`, `docs/PROMPT_FIX_AUDIT.md`,
`PLAN_*`, `docs/pilot/BILAN-PILOTE.md`) gardent leur récit d'époque — le contrôle tolère
explicitement les tournures historiques (« avait été bloqué », « levée depuis ») : réécrire ces
documents serait falsifier l'histoire, pas la rétablir.

### L4 — Rétention de la messagerie (décision D2 = a, 2026-09-25)

**Décision appliquée** : purger, avec des seuils dédiés (option (a) du dossier §6).

**Livré** :
- `infrastructure/database/migrations/076_messaging_retention.sql` — fonction
  `retention_purge_messaging(p_notification_cutoff, p_messages_cutoff)`
  (SECURITY DEFINER, propriétaire = rôle de migration BYPASSRLS : le worker tourne
  NOBYPASSRLS sans contexte tenant, patron 034/042/047) + deux index de purge
  (`notification_queue(status terminal, created_at)`, `messages(sent_at)` — les index
  existants ne servaient pas ces sélections) + `retention_expired_body_marker()`
  (marqueur textuel partagé, **sans nombre de jours** : le seuil est configurable, un
  marqueur qui citerait « 365 » mentirait dès qu'on le change).
- `apps/worker/src/main.ts` — le job `retention_purge` enchaîne désormais les journaux
  puis la messagerie (`NOTIFICATION_RETENTION_DAYS` défaut 90, `MESSAGES_RETENTION_DAYS`
  défaut 365) et journalise les deux comptes.
- `tests/tenant-isolation/phase76-messaging-retention.pg.test.mjs` — 15 assertions sur
  PG 18 réel, exécutées **par le rôle applicatif** (le chemin exact du worker) ;
  ajoutée au runner (72 entrées).
- Docs alignées : `.env.prod.example` (les deux seuils), `docs/RUNBOOK.md` (exploitation,
  y compris ce qui n'est **pas** purgé), `docs/VERIFICATION_ANALYSE_2026-09-24.md`
  (la dette est fermée), `docs/HANDOFF.md`, compteurs du contrat de vérité (76 migrations,
  72 entrées, 70 suites `phaseNN`, 86 fichiers).

**Règles verrouillées par la suite** (nommées comme les assertions) :

```
✓ 1. file : 3 lignes TERMINÉES purgées (2 orgA + 1 orgB, 120/400/900 j)
✓ 5. messages : 2 contenus expirés (1 orgA + 1 orgB, 500 j)
✓ 2. notification `pending` de 900 j NON purgée (retry en cours)
✓ 3. notification `processing` de 900 j NON purgée (traitement en cours)
✓ 1bis. notification `sent` de 2 j NON purgée (sous le seuil)
✓ 7. purge GLOBALE : la ligne terminale d'une AUTRE organisation (900 j) est purgée aussi
✓ 1ter. les deux lignes terminales sont bien absentes
✓ 5bis. message ancien : corps remplacé par le marqueur partagé
✓ 5ter. message ancien : la LIGNE et ses métadonnées restent (fil non troué)
✓ 4. message récent (3 j) : contenu intact
✓ 7bis. purge GLOBALE : le contenu ancien d'une AUTRE organisation est expiré aussi
✓ 8. notification_inbox (voie durable) intacte
✓ 6. idempotent : second passage = 0 notification, 0 message
✓ 9. hors contexte tenant, le rôle applicatif n'écrit pas dans `messages`
✓ 10. une `pending` devenue `sent` (et ancienne) est purgée au passage suivant
```

**Deux constats de conception tirés des premiers échecs de la suite** (gardés parce qu'ils
sont instructifs) :
1. la purge est **globale** (toutes organisations) — c'est une obligation du responsable de
   traitement, pas un réglage par client, exactement comme la purge des journaux (034). Le
   premier jet du test postulait l'inverse (« un tenant voisin ne doit pas être touché ») :
   c'est le **test** qui était faux, pas la fonction ; le cas est désormais assertion
   positive de la règle globale.
2. **hors périmètre assumé**, écrit noir sur blanc : `notification_inbox` (la voie de lecture
   durable décidée au lot 2B/D2) et les fichiers joints (`media_assets` + objet de stockage)
   ne sont pas purgés par ce seuil — deux décisions séparées si le DPO veut leur donner une
   durée.

**Mutations exécutées** (3, toutes rouges, restaurations `diff -q` vérifiées) :

```
A — liste blanche de statut retirée (pending/processing purgés)  rc=1  ['2. … NON purgée', '3. … NON purgée']
B — messages : ligne SUPPRIMÉE au lieu du contenu expiré          rc=1  ['5bis. … marqueur', '5ter. … LIGNE … restent']
C — garde d'idempotence retirée (body <> marqueur)               rc=1  ['6. idempotent : second passage …']
restaurations (diff -q avec la sauvegarde)                       identiques ✓ → suite 15/15 verte
```

**Gate D complet rejoué localement le 25/09/2026** (72 entrées SUITES + le garde anti-bypass,
rôles de production `creche_app`/`creche_migrator`, PG 18.4 réel) : **rc=0, « 73/73 suites vertes »**
(1385 s), avec `PASS phase76-messaging-retention.pg.test.mjs` — les notices H2a–H2l/G1–G5 ont été
ré-émises à l'identique. *(Rejeu suivant, après `phase77` : 74/74, journal L2E.)* Le précédent rejeu (24/09, avant 076) affichait 72/72 : le passage à 73 est
la conséquence directe de l'ajout de la suite, pas d'un changement de périmètre.

**Outillage re-validé après la migration** : `migrate --status` (076 appliquée, checksums),
`schema-check` (RLS complète, dérive nulle), `check-rls-usage` (52 accès bruts conformes ;
la fonction SECURITY DEFINER est déclarée — le marqueur textuel, lui, **n'est pas** SECURITY
DEFINER et ne doit pas figurer dans cette liste), `claims-contract` (**rouge avant** la mise à
jour des compteurs : « ci.yml revendique 075, la réalité est 76 » — le contrat de vérité fait
exactement son travail), typecheck, build worker.

### L6.3 — D3 : le stub `compress_media` est retiré, et un verrou interdit la réapparition (2026-09-25)

**Décision appliquée** : option (a) — retirer (dossier §6 D3).

**Livré** :
- `apps/worker/src/main.ts` : la ligne `compress_media: async () => { throw new Error('NOT_IMPLEMENTED…') }`
  est **supprimée** (avec son commentaire), remplacée par un commentaire qui dit la décision et ce qui
  se passe pour une ligne héritée : `Type de job inconnu: compress_media`, jamais un faux succès ;
- `tests/tenant-isolation/phase27-worker-lifecycle.test.mjs` : le cas « échec handler ⇒ `failed` à la
  limite » s'appuie désormais sur un **type inconnu** (`compress_media_legacy`) et asserte le message
  exact — la propriété testée (jamais de faux succès) ne dépend plus d'un stub, et couvre du même coup
  le sort des lignes d'un handler retiré ; **nouveau verrou** : aucun handler du worker ne peut être un
  stub `NOT_IMPLEMENTED` permanent (scan de `apps/worker/src/main.ts`, motif par ligne de handler).

**Preuves exécutées** : `phase27` en environnement de gate (rôles de production, `creche_app`) →
**15/15** (14 avant l'ajout du verrou) ; mutation : le stub réintroduit dans la source → `not ok 13 …
handler(s) stub permanent : compress_media: async () => { throw new Error('NOT_IMPLEMENTED…') }`,
`# pass 14 / # fail 1` ; restauration `diff -q` vérifiée → 15/15.
Rappel de portée : le commentaire de `014_jobs_and_outbox.sql:12` (qui citait `compress_media` dans la
liste des types) **reste tel quel** — réécrire une migration déjà appliquée changerait son checksum ;
l'état courant est décrit ici et dans le worker.

### L6.4 — D5 : la vidéosurveillance n'est plus présentée comme opérationnelle (2026-09-25)

**Décision appliquée** : option (c) — retirer la vidéosurveillance du discours produit tant que le
dimensionnement de l'acquisition n'est pas fait (dossier §6 D5).

**Faits mesurés (avant décision)** :
```
flag video_surveillance                     → seed 014 : FALSE (inactif par défaut)
appels clients vers /video/clips/presign-upload → AUCUN (admin-web, staff-mobile, parent-mobile)
route d'envoi en production                 → fail-closed (lot 2B, D1 = A : pas de sous-domaine public)
écran VideoPage (admin-web)                 → liste/visionne les clips, crée des caméras — n'envoie rien
plafonds de taille des clips                → non tranchés (8/12 Mio = dimensionnés pour des photos)
```

**Livré** : `docs/ROADMAP_V2.md` (ligne P2 requalifiée : « NON opérationnel en l'état » + l'absence
d'acquisition écrite) ; `docs/HANDOFF.md` (description du module et ligne du tableau rectifiées —
« côté consultation », flag inactif par défaut, acquisition non câblée) ; **verrou exécutable** dans
`tests/tenant-isolation/phase21-video-surveillance.api.test.mjs` (cas 9) : aucun fichier client
(`apps/*/src|lib`) ne peut appeler `clips/presign-upload` ni poster sur `/video/clips` — câbler
l'envoi sans rouvrir D5 fait **échouer la CI** avec le fichier fautif en clair.

**Preuves exécutées** : `phase21` en environnement de gate (rôles de production, PG réel, backend
local explicite) → **9/9** (« ✓ D5 : aucun client n'envoie de clip ») ;
**mutation** : un appel `http.post('/video/clips/presign-upload', …)` ajouté dans
`apps/admin-web/src/pages/VideoPage.tsx` →
`✗ D5 … — VideoPage.tsx → presign d'envoi de clip` puis
`ÉCHEC Phase 21 vidéosurveillance : 1 assertion(s)` ; restauration `diff -q` vérifiée → 9/9.

### L2C — F5, volet client : verrouiller le presign d'écriture mort (2026-09-25)

**Mesure (avant tout code)** : le remplacement serveur existe (lot 2B : `POST /api/v1/media/upload`,
presign d'écriture *fail-closed* en production, `UPLOAD_VIA_API_REQUIRED`) mais **le client n'a pas été
rebranché** : `apps/staff-mobile/lib/core/media/media_uploader.dart` appelle toujours
`POST /media/presign-upload`. Recherche exhaustive des appelants :

```
presign d'écriture appelé par         → ce seul fichier Dart
POST /media/upload appelé par          → AUCUN client (admin-web, staff-mobile, parent-mobile)
MediaUploader référencé par            → ses seuls tests (apps/staff-mobile/test/media_uploader_phase4_test.dart)
UI de capture photo dans staff-mobile  → AUCUNE (pas d'image_picker, pas de caméra dans lib/)
téléversement média dans admin-web     → AUCUN (MediaPage : lecture seule)
```

⇒ la dette est **latente, pas un incident** : rien à l'écran ne peut passer par ce chemin. La
réécrire ici produirait du Dart jamais compilé (ni SDK Flutter ni `pub.dev`, mesuré deux fois — lot L3),
donc invérifiable — ce que la règle « aucune capacité sans preuve exécutée » interdit.

**Livré — un verrou à la place d'un code non prouvable** :
`tests/tenant-isolation/media-client-wiring.test.mjs` (3 contrôles, aucune base, aucun build) :
1. la **cible du rebranchement existe** (`@Post('upload')` dans `media.controller.ts`) et la garde
   *fail-closed* du presign est toujours là (`UPLOAD_VIA_API_REQUIRED` dans `storage.service.ts`) —
   si le presign redevient utilisable en production, le verrou le dit ;
2. **aucun fichier client** n'**appelle** le presign mort hors exceptions justifiées (motif d'**appel
   réel**, pas de mention : voir la leçon plus bas) ;
3. chaque exception doit rester **vraie** (le fichier appelle encore le presign — sinon l'entrée est
   périmée et doit disparaître) et **inoffensive** (`MediaUploader` n'est référencé par aucun autre
   fichier client hors tests) ⇒ **le jour où un écran le câble, la CI échoue** avec le fichier fautif
   et la route à utiliser.

Câblé dans `quality` (nouvelle étape) et dans le bundle statique du gate D.

**Preuves exécutées** : 3/3 sur l'état actuel. Mutations (toutes rouges, restaurations vérifiées) :

```
A — l'UI câble MediaUploader (main.dart)              rc=1  « MediaUploader est désormais CÂBLÉ dans l'interface : apps/staff-mobile/lib/main.dart … Rebrancher sur POST /api/v1/media/upload AVANT de livrer cet écran »
B — appel mort retiré, commentaire d'en-tête laissé   rc=1  « n'appelle PLUS le presign mort : l'exception est périmée — retirer l'entrée JUSTIFIED »
C — appel mort ajouté dans admin-web                  rc=1  « appel(s) client au presign d'écriture MORT en production … MediaPage.tsx »
restaurations (diff -q)                                identiques ✓ → 3/3
```

**Leçon conservée (le premier jet était troué)** : la mutation B était d'abord **verte** — le motif
comptait les *mentions* du chemin, et le commentaire d'en-tête du fichier le satisfaisait alors que
l'appel avait changé. Un verrou qui se satisfait d'un commentaire ne verrouille rien : le motif porte
désormais sur un **appel** (`.post(`/`.put<…>(` vers le chemin). C'est la mutation qui a trouvé ça,
pas la relecture.

**Ce que L2C ne fait pas** : il ne rebranche pas le client (lot **L3**, avec le SDK Flutter) et ne
juge pas la qualité du Dart. Il garantit seulement qu'aucun écran ne peut être livré sur un chemin mort
sans que quelqu'un s'en aperçoive.

### L2D — Photos hors ligne : la limitation devient mesurée, et le contournement verrouillé (2026-09-25)

**Constat (déjà documenté, désormais exécutable)** : la commande `add_photo` de `POST /sync/push`
crée un `media_assets` **sans octets** (lecture → `404 MEDIA_CONTENT_MISSING`), et **aucune UI**
n'enfile de photo (`enqueueOfflinePhoto` n'est appelé que par ses tests). Le plan listait ce défaut
« côté client à corriger » ; il manquait la garantie qu'il ne soit pas **contourné** (une UI câblée
avant le canal d'octets produirait une fonctionnalité qui « marche » puis rend des 404 en lecture).

**Livré** :
- `tests/tenant-isolation/media-client-wiring.test.mjs` — 2 contrôles de plus (**5 au total**) :
  1. `registerFromSync` **n'écrit toujours aucun octet** (extraction contrôlée de la fonction, avec
     assertion de repère : si l'extraction échoue, le test échoue — pas de verrou qui dort) ;
     le jour où les octets transitent, la CI exige de mettre à jour la limite documentée **et** le
     dossier D6 ;
  2. `enqueueOfflinePhoto` **n'est appelé par aucune UI** (le fichier qui *définit* la méthode est
     exclu, comme les tests) ;
- **dossier de décision D6** au §6 (options a/b/c, recommandation (a) via L3, contrainte du plafond
  JSON de `sync/push` écrite) ;
- `docs/VERIFICATION_ANALYSE_2026-09-24.md` : la ligne « défaut confirmé » renvoie désormais au
  dossier D6 et au verrou.

**Preuves exécutées** : 5/5 (extractions contrôlées). Mutations (rouges, restaurations `diff -q`
vérifiées) :
```
D — octets écrits dans la voie hors-ligne (`storage.put(...)` ajouté)   rc=1  « limitation levée — retirer ce verrou, mettre à jour la doc et D6 »
E — une UI appelle enqueueOfflinePhoto                                  rc=1  « enqueueOfflinePhoto est appelé par : apps/staff-mobile/lib/main.dart »
restaurations (diff -q media.service.ts, main.dart)                     identiques ✓ → 5/5
```

**Note de méthode** : le premier jet du contrôle 5 échouait sur le fichier **définisseur** de la
méthode (il la nomme forcément) — corrigé en distinguant définition et appel, comme pour la classe du
contrôle 3. Deux fois dans la même journée, c'est la mutation/correction qui a réglé un motif trop
large : c'est le comportement attendu du « prouver, pas relire ».

### L2E — Le payload de synchronisation n'est pas un canal de fichiers (2026-09-25)

**Constat 33 (audit) requalifié par la mesure.** L'audit décrivait « photos offline en base64 en
clair dans SQLite » comme un défaut **client** (constat 33, 🟡 car hors d'atteinte de l'UI). En
ouvrant le serveur, la mesure dit autre chose que « la photo est inerte » : `POST /sync/push`
**store le payload verbatim** (`sync.service.ts:127` → colonne `sync_operations.payload` JSONB,
**sans plafond de taille**), le DTO accepte un `payload` générique, et le handler `add_photo` ne
consomme **jamais** un champ d'octets. Autrement dit : un client qui enverrait la photo en base64
la ferait **persister dans le journal de synchronisation**, hors du pipeline média (pas de
vérification de consentement, pas de plafond, pas de `media_access_logs`) tout en produisant un
asset **sans octets** (lecture 404). Ce n'était donc pas « inerte » : c'était un canal de stockage
non gouverné.

**Livré** :
- `apps/api/src/modules/sync/sync.service.ts` — garde de **forme** `refuseNonStorablePayload(op)`,
  exporté (testable), appelé **en tête de `processOperation`, avant toute connexion** à la base :
  1. payload sérialisé > `MAX_SYNC_PAYLOAD_BYTES` (16 Ko) → `PAYLOAD_TOO_LARGE_FOR_SYNC` ;
  2. toute chaîne de ≥ `BASE64_BLOB_MIN_CHARS` (4096) caractères **strictement** base64
     (alphabet + padding, sans espace), **récursivement** dans objets/tableaux → 
     `PAYLOAD_BINARY_NOT_ALLOWED`, message nommant `POST /api/v1/media/upload` ;
  3. payload non sérialisable → `PAYLOAD_NOT_SERIALIZABLE`.
  Le contrôle ne dépend d'**aucun nom de champ** : `photo_data`, `content`, `image_base64` sont
  refusés comme `bytes` (trois renommages testés). Le refus est **non persisté** — ce qu'on refuse
  de stocker n'est pas stocké, pas même en « rejected » — donc rejouer le même `event_id` rend la
  même réponse, sans effet de bord.
- `apps/api/src/shared/filters/http-exception.filter.ts` — **défaut réel découvert par la suite** :
  un corps de ~300 Ko rendait **500 « erreur interne »** au lieu de 413 (l'erreur du body-parser
  d'Express, `PayloadTooLargeError`, n'est pas une `HttpException` et tombait dans la branche
  générique du filtre). Ajout de `clientHttpStatus()` (statut 4xx/5xx hors `HttpException`) et d'une
  branche dédiée **avant** le `else` : désormais **413 `PAYLOAD_TOO_LARGE`** avec messages FR/AR.
  Un client qui envoie trop gros doit réduire son envoi, pas croire à une panne et réessayer.
- `apps/api/src/shared/filters/http-exception.filter.spec.ts` — 4 tests unitaires (sans base) qui
  verrouillent le contrat de sortie du filtre : `AppError`, code métier en message, **413 pour
  `entity.too.large`** (et non 500), erreur inconnue → 500 journalisée sans fuite de détail.
- `tests/tenant-isolation/phase77-sync-payload-guard.api.test.mjs` — 17 vérifications / 9 cas sur
  PostgreSQL réel **et par HTTP** : `add_photo` légitime (sans octets) toujours accepté ; `bytes`
  base64 rejeté (message nommant la bonne route) ; **rien de persisté** (aucune ligne
  `sync_operations`, aucun `media_assets` fantôme) ; 3 renommages ; note légitime de 3200 caractères
  acceptée (le garde ne casse pas l'usage normal) ; payload de 20 Ko rejeté ; envoi de ~300 Ko →
  **413** (et non 500) avec message FR/AR ; `log_temperature` normal accepté ; rejeu déterministe.

**Preuves exécutées** : `phase77` **17/17** (9 cas, PostgreSQL 18 réel) ; `http-exception.filter.spec.ts`
**4/4** ; `claims-contract` **10/10** (compteurs : 71 suites `phaseNN`, 89 fichiers, **73 entrées**).
Mutations (rouges, restaurations `diff -q` vérifiées) :
```
F — garde de forme retiré (le base64 repasse)              rc=1  8 échecs (cas 2, 4×3, 6bis, 7bis, 9)
G — plafond de taille retiré                               rc=1  1 échec  (cas 6)
H — le refus est PERSISTÉ (on stocke ce qu'on refuse)      rc=1  7 échecs (cas 3/3bis/6bis/7bis/9)
I — filtre : le 413 redevient 500                          rc=1  2 échecs (cas 7 + message bilingue)
restaurations (diff -q sync.service.ts, http-exception.filter.ts)   identiques ✓ → 17/17
```

**Gate D complet rejoué localement le 25/09/2026 après le lot** (73 entrées SUITES + le garde
anti-bypass, rôles de production `creche_app`/`creche_migrator`, PG 18.4 réel) : **rc=0,
« 74/74 suites vertes »** (batterie 1467 s), avec `PASS phase77-sync-payload-guard.api.test.mjs
22 assertions ✓` et `PASS phase76-messaging-retention.pg.test.mjs 21 assertions ✓`. Le rejeu
précédent (même journée, avant `phase77`) affichait 73/73 : le passage à 74 est la conséquence
directe de l'ajout de la suite, pas d'un changement de périmètre. Le garde de forme **ne casse
aucune suite existante** (le payload de synchronisation de tous les scénarios antérieurs reste
sous les seuils).

**Périmètre assumé / limites** :
- le garde est une règle de **forme**, pas un quota métier : une chaîne de 4097 caractères
  « base64-valide » est refusée même si c'était une note, et une note de 3200 caractères passe
  (testé) ; le seuil est **documenté et testé**, pas implicite ;
- il **ne remplace pas** le canal d'octets : il ferme seulement l'option (b) de **D6** côté serveur
  (base64 dans `sync/push`). La recommandation (a) — file locale client + `POST /media/upload` à la
  reconnexion — reste ouverte et relève de **L3** ;
- le client `staff-mobile` n'est **pas** modifié (aucun SDK Flutter ici) ; il n'envoie d'ailleurs
  aucun octet aujourd'hui (L2C/L2D).

### H1 — MinIO n'est plus distribuable : l'image est reconstruite, pas tirée (2026-09-25)

**Ce qui était présenté comme « environnemental » était une panne amont, datable.** Le diagnostic
s'arrêtait à « le runner n'obtient plus le tirage anonyme de Quay ». La mesure du 25/09 établit la
cause : **MinIO a retiré ses images des deux registres publics** — dépôt Docker Hub `minio/minio`
supprimé le **12/09/2026** (API Hub `404`, manifeste anonyme `401`), accès anonyme **Quay.io** coupé
le **24/09/2026** à ~12:55 UTC (`unauthorized: access to the requested resource is not authorized`,
alors que d'autres dépôts publics du même registre répondent `200`). Conséquences : H1 était le
**seul** job rouge, mais surtout **un déploiement neuf échouait** sur le tirage de l'object store —
et les « remédiations » livrées au lot L1.7 (secrets Quay, miroir) ne pouvaient pas réparer un dépôt
disparu : fournir des identifiants sur un registre qui ne sert plus l'image ne mène nulle part.

**Livré — le défaut n'est plus un tirage** :
- `infrastructure/docker/minio.Dockerfile` : image construite depuis le **binaire officiel** de la
  release épinglée, publié sur GitHub, dont la **somme SHA-256 est vérifiée par le builder**
  (`ADD --checksum=sha256:${MINIO_SHA256}`) — la vérification a été confirmée dans le code de
  BuildKit (`AddCommand.Expand` étend `Checksum`) plutôt que supposée. Provenance écrite dans le
  fichier : asset, taille et digest relevés par API pour la release `RELEASE.2025-09-07T16-13-09Z`
  (`amd64` : 110 989 496 o, `7c5bd851…f855f` ; `arm64` : 105 251 000 o, `5c83cd2c…6f03d`), tag
  annoté → commit `01ce918d…`. Une architecture non prévue **échoue avant le téléchargement** avec
  un message explicite (jamais un binaire silencieusement différent).
- `scripts/build-minio-image.mjs` : construction locale **arch-aware**, qui **lit** la release et la
  somme `amd64` dans le Dockerfile (source de vérité unique) au lieu de les recopier.
- Les trois composes : `image: ${MINIO_IMAGE:-creche-minio:RELEASE.2025-09-07T16-13-09Z}` — plus
  aucune référence à un registre public mort, et **aucun `build:` sous `minio`** : sinon
  `docker compose up` avec `MINIO_IMAGE=<miroir>` reconstruirait l'image locale et **retaggerait le
  miroir** avec des octets venus du dépôt (la surcharge deviendrait un mensonge).
- `scripts/test-staging-stack.mjs` : `postgres` est tiré (Docker Hub fonctionne), `minio` est
  **construit** sauf si `MINIO_IMAGE` fournit un miroir — la stack de qualification ne dépend plus
  d'aucun registre pour l'object store.
- Verrous : `production-compose-contract` (image par défaut identique dans les trois environnements ;
  aucune référence `quay.io/minio`/`minio/minio:` ; pas de `build:` sous minio ; pins du Dockerfile ;
  cohérence Dockerfile ↔ script) et `registry-pull` (le miroir est tiré sur la config résolue, étape
  Quay conditionnelle conservée, `--password-stdin`, aucun mot de passe littéral).

**Preuves exécutées** : `production-compose-contract` 18/18, `registry-pull` 11/11,
`dev-compose-contract` (inclus) — 36 contrôles verts sur les trois fichiers ; `check-guards-wired`
12/12 ; `ci.yml` relu par js-yaml. **Preuve par la CI (décisive)** : run `36184866284` sur `5266fff`
— job `database` **VERT en 32 min**, step « Registre Quay » **`skipped`** (aucun secret), annotations
réduites à des *notices*, dont « Delivered staging compose: … actual API HTTP health and worker
claim/finish verified » et « Delivered dev compose: … » : l'image construite localement a servi les
deux stacks, dans les mêmes conditions qu'un déploiement. **H1 n'est donc plus le rouge de la CI —
le dépôt n'a plus aucun job rouge.** 5 mutations rouges au passage (M1 compose revenu à l'image
morte ⇒ 3 tests ; M2 `build:` ajouté sous minio ; M3 somme amd64 altérée ; M4 somme arm64 divergente ;
M5 image codée en dur dans la stack).

**Hors périmètre / limites** : le conteneur tourne en `root`, comme l'image amont d'origine (un
`USER minio` casserait une mise à jour sur un volume déjà créé par un déploiement antérieur) — le
durcissement en uid 1000 est possible avec un volume neuf, à décider côté ops (écrit dans le
Dockerfile). Le binaire reste **AGPL-3.0** : c'est celui de la release officielle, non modifié — si
le produit ne veut plus embarquer MinIO du tout, c'est une décision produit (alternative S3
managée), pas un correctif.

### L3 — la session parent se renouvelle (et les erreurs ont une issue) (2026-09-25)

**Le défaut, tel que l'audit le décrivait (item C2)** : l'access token dure **15 minutes** et
**rien** ne le renouvelait dans `parent-mobile`. Passé ce délai, chaque appel rendait 401 : les
écrans affichaient une erreur générique — ou, pire, un **indicateur de chargement infini** (trois
écrans ne testaient que « pas encore de données ») — et le parent devait se reconnecter : application
inutilisable. Décision **D4 = correctif court** (refresh + états d'erreur), pas d'offline-first.

**Le blocage d'environnement, contourné honnêtement.** Aucun SDK Flutter ici (`pub.dev` **000**,
trois mesures dans la journée) : écrire du Dart sans pouvoir le compiler violerait la règle du plan.
Mais le job **`flutter` de la CI a le SDK épinglé (3.47.1)** et compile réellement les deux applications
(analyse, tests, APK). Le lot a donc été livré « à l'aveugle côté poste », **la CI servant de
compilateur et de banc de test** — et elle a joué son rôle : le premier run a rejeté le lot avec
`lib/core/api_client.dart:196:20: Error: 'await' can only be used in 'async' or 'async*' methods`
(un `await` dans une lambda non-async), corrigé au commit suivant. C'est plus fort qu'une relecture :
l'erreur vient du compilateur qui construit le binaire livré.

**Livré** :
- `core/api_client.dart` — intercepteur 401 → refresh → rejeu **borné** (rejeu marqué, la route de
  refresh ne peut pas déclencher de refresh) ; rafraîchissement **single-flight par futur partagé**
  (`_refreshInFlight`) : des appels concurrents attendent le **même** refresh au lieu d'échouer —
  le patron `bool _refreshing` du client staff-mobile fait précisément échouer les 401 simultanés,
  ce qui est le cas normal d'un écran qui charge plusieurs ressources ; rotation **G1b** honorée (le
  nouveau refresh token est persisté) ; refresh refusé → session **purgée** du keystore, erreur typée
  `ParentSessionExpired`, `onSessionExpired` → retour à l'OTP ; erreurs typées `ParentApiException`
  (`offline` / serveur / 401) ; magasin de jetons abstrait (`core/token_store.dart`) et adaptateur
  HTTP injectable → testable **sans appareil ni réseau**.
- `core/error_state.dart` + `feed_page`, `photos_page`, `consents_page`, `main.dart` — erreur testée
  **avant** le chargement (fin des indicateurs infinis), session expirée → message de reconnexion
  **sans** bouton « Réessayer » (insister ne sert à rien), hors-ligne distinct d'une panne serveur,
  réessai explicite sinon ; la feuille d'absence n'avale plus l'échec (message visible).
- **12 tests écrits, lancés par la CI** (`apps/parent-mobile/test/`) — *leur verdict n'a pas pu être relevé : jeton GitHub invalidé pendant le lot* : 8 tests de client (200 sans refresh ;
  401 → 1 refresh + rejeu avec le jeton neuf + rotation persistée ; **5 appels simultanés en 401 →
  exactement 1 refresh**, tous aboutissent ; refresh refusé → session purgée, un seul essai, retour
  connexion ; pas de refresh token → session expirée sans appel réseau ; hors-ligne ; 500 ; contenu
  photo par le même chemin) et 4 tests de widget (erreur → réessai qui aboutit ; hors-ligne ;
  session expirée sans bouton trompeur ; liste vide sans indicateur bloqué).
- `flutter.yml` — étape **`parent-mobile — tests`** (`flutter test`, journal publié en artefact) et
  étape **lockfile** : résolution **contrainte** (`--enforce-lockfile`) dès que `pubspec.lock` est
  versionné, sinon la résolution réelle du run est **publiée** (annotations) pour être committée.
- Verrou statique `tests/tenant-isolation/parent-session-contract.test.mjs` (**8/8** — la 8e règle interdit le faux vert du tube ; job `quality`
  + bundle du gate D) : un seul point d'entrée de refresh dans `lib/`, single-flight (et refus
  explicite du drapeau booléen), rejeu borné, purge + retour connexion, états d'erreur par écran,
  tests **réellement exécutés** par la CI (**vert** sur `ce69bbd`), contrôle du lockfile.

**Méthode — un plafond qu'il faut connaître** : la première publication du lockfile est arrivée
**tronquée** (3072 octets décodés, coupés en plein milieu) : une annotation GitHub est plafonnée à
**4096 caractères**, et un lockfile tronqué ne résout plus rien. La publication est donc découpée en
morceaux numérotés (`1/N`…), réassemblables — l'échec a été vu par la mesure, pas supposé.

**Verdict relevé (jeton GitHub rétabli)** : run `flutter` `36189792213` sur `e5ee4ac` = **success**
(les 12 tests s'exécutent, l'APK se construit) et `docker` = success ; le run `ci` `36189792263` était
rouge pour une seule raison, documentaire : le step « Contrat de vérité documentaire » exigeait le
compteur de fichiers d'isolation à jour (88 → **89**, ce même contrat ayant gagné une suite) —
corrigé, donc re-vert attendu.

**Faux vert corrigé (25/09, nuit)** — le vert du job `flutter` ne valait pas ce qu'il affichait : une
annotation isolée trahissait `::error::4 tests passed, 1 failed.` alors que **les 17 steps étaient
verts**. Cause mesurée : `flutter test | tee parent-test.log` — **le tube renvoie le code de sortie de
`tee` (0)**, donc un test réellement en échec ne rougissait rien (deux suites `staff-mobile` de 5 tests
étaient candidates, sans autre indice : ni fichier, ni ligne, ni test nommé). Corrigé par
`scripts/ci-run.sh` : `set -o pipefail` + capture de `rc` + `exit "$rc"` + publication des lignes
d'échec en annotations (≤ 8 par étape — une annotation GitHub est plafonnée à 4096 caractères, mesuré,
et au-delà GitHub agrège). Les 4 étapes de test/analyse des deux apps y passent ; les `| tee`
restants (lockfile, builds APK) étaient déjà sous `set -o pipefail`. Verrou : **8e règle** de
`parent-session-contract` — « aucun échec masqué par un tube », éprouvée par 3 mutations (`exit` avalé
⇒ rouge ; directive `pipefail` retirée ⇒ rouge ; tube nu réintroduit ⇒ rouge). La première version de
l'assertion matchait la *mention* de `set -o pipefail` dans le commentaire d'en-tête du script et
laissait donc passer la suppression de la directive : elle est désormais ancrée sur la ligne de code.

**Le premier échec nommé (25/09, nuit — après durcissement)** : le run suivant a rendu le job
`flutter` **rouge**, et le diagnostic est enfin complet — `flutter analyze` échouait sur mon propre
fichier de test (`test/parent_api_client_test.dart:198`, `Headers.octetStreamContentType` : ce getter
n'existe pas dans dio ; les seules constantes mime sont `jsonContentType`, `formUrlEncodedContentType`,
`textPlainContentType`, `multipartFormDataContentType` — vérifié sur la source `cfug/dio`). Le fichier
de test ne **compilait donc pas**, ce qui explique mot pour mot le `4 tests passed, 1 failed.`
d'origine : seuls les 4 tests de widget (`feed_page_test.dart`) s'exécutaient, et l'unique « failed »
était le chargement de la suite de client — les 8 tests de session, ceux qui portent la preuve du lot,
ne tournaient pas du tout. Corrigé (`'application/octet-stream'` littéral). Leçon : **l'analyse était
masquée par le même tube que les tests** ; un « vert » d'analyse ne valait pas mieux qu'un « vert » de
test tant que `pipefail` manquait.

**Deuxième échec nommé — un warning préexistant, masqué depuis toujours** : avec le diagnostic élargi,
le step `parent-mobile — pub get + analyze` a livré la cause exacte :
`warning • Unnecessary cast … lib/features/consents/consents_page.dart:49:22 • unnecessary_cast`
(1 seule issue, 9,5 s d'analyse). `flutter analyze` échoue **aussi sur un warning** — et cette ligne
ne vient pas de L3 : `git log -L` la rattache au commit `3b8f51b` (« thème Sérénité », PR #49), donc
le warning existait avant, simplement masqué par le tube. Corrigé (cast retiré : `item is Map` promeut
déjà le type). Leçon : `flutter analyze` sans `pipefail` ne garantissait rien — l'analyse parent
n'avait jamais été bloquante.

**Lockfile parent committé** : la résolution publiée par la CI (6 morceaux réassemblés — 519 lignes,
67 paquets, `dio` 5.11.1, `flutter_secure_storage` 9.2.4, `intl` 0.20.3, `flutter_lints` 4.0.0, Dart
`>=3.11.0 <4.0.0`) est versionnée : le step dédié passe à `flutter pub get --enforce-lockfile` au run
suivant, une dérive de dépendance fera donc échouer le job au lieu de changer le binaire en silence.

**En attente (dit tel quel)** : le **verdict final** du run `flutter` sur `e5ee4ac` (le jeton GitHub
de l'environnement a été invalidé pendant l'attente — même panne que le 24/09 à la même heure) et le
commit de `pubspec.lock`. Ce qui est déjà acquis : le lot **compile** (l'erreur du premier jet a été
relevée puis corrigée) et les tests ont été exécutés — le correctif `photoContent` n'aurait jamais pu
être poussé sans un compilateur réel.

## 6. Décisions en attente (propriétaire explicite)

| # | Décision | Propriétaire | Bloque | État |
|---|---|---|---|---|
| D1 | Stockage : option **A** (stream same-origin) ou **B** (sous-domaine + TLS) | produit + ops | Lot 2 | ✅ **tranchée : A** (lots 2A/2B livrés) |
| D2 | Rétention `notification_queue`/`messages` : purger ou justifier | DPO | Lot 4 | dossier ci-dessous |
| D3 | `compress_media` : implémenter ou retirer | produit | Lot 6 | dossier ci-dessous |
| D4 | `parent-mobile` : offline-first complet maintenant, ou refresh + états d'erreur seuls | produit | portée du Lot 3 | dossier ci-dessous |
| D5 | Clips vidéo : quel plafond de taille et quelle voie (API ou S3 direct) | produit + ops | usage réel de la vidéosurveillance en prod | ✅ **tranchée : (c)** (lots L6.4) |
| D6 | Photos **hors ligne** : quel canal d'octets (base64 dans `sync/push`, file locale client + `POST /media/upload`, ou retrait de la voie tant qu'aucune UI ne capture) | produit + tech | **TRANCHÉE (2026-09-25) = option (c)** — voie retirée : `add_photo` refusée (`OFFLINE_PHOTO_UNSUPPORTED`), `registerFromSync`/`applyAddPhoto` supprimés, `enqueueOfflinePhoto`/`offlineStorageKey` retirés du client ; l'option (b) reste fermée par L2E ; réversible (une UI de capture ⇒ option (a)) |

### D2 — Rétention de `notification_queue` et `messages` *(DPO)* — ✅ **TRANCHÉE : (a) purger**

> **Décision du 2026-09-25 : option (a)**, appliquée au lot L4 (migration 076, suite
> `phase76`, journal §5). Seuils livrés : `NOTIFICATION_RETENTION_DAYS=90` (file de
> notifications **terminées** uniquement — `pending`/`processing` jamais purgés) et
> `MESSAGES_RETENTION_DAYS=365` (expiration du **contenu** des messages ; la ligne et le
> fil restent). **Hors périmètre assumé** : `notification_inbox` (voie durable) et les
> fichiers joints (`media_assets`) — deux décisions séparées si le DPO souhaite des durées.

**Faits mesurés (2026-09-24)** :
- `notification_queue` (migration 009) garde `title_fr/ar`, `body_fr/ar`, `data` JSONB, `status`,
  `sent_at`, `failed_at`, `failure_reason`, `attempts`, `created_at` ; `messages` (009) garde `body`,
  `attachment_id`, `sent_at`, `deleted_at` (suppression logique).
- La purge livrée (migration 034, job `retention_purge`) ne couvre **que** `audit_logs`,
  `data_access_logs`, `media_access_logs` (5 ans, `RETENTION_DAYS=1825`). Aucun `DELETE` de
  `notification_queue` ni de `messages` n'existe dans le dépôt : ces deux tables **croissent sans
  borne**.
- Le patron technique est déjà là (fonction `SECURITY DEFINER` + job worker + test) : le coût de la
  décision « purger » est **S** (≈ 0,5 j avec preuve), pas un chantier.

**Options** :
- **(a) Purger avec des seuils dédiés** — file de notifications : lignes `sent`/`failed` au-delà de
  `NOTIFICATION_RETENTION_DAYS` (proposition : 90 j, l'inbox reste la voie de lecture durable) ;
  messages : contenu au-delà de `MESSAGES_RETENTION_DAYS` (proposition : 365 j) — même patron que
  034, purge par lots, testée. *Coût S ; l'audit la citait comme attente du DPO.*
- **(b) Conserver et le justifier au registre** — utile si les messages servent de preuve
  d'information des familles ; à écrire noir sur blanc (durée, base légale, qui y accède).
- **(c) Anonymiser au lieu de supprimer** — garde les métadonnées (volumétrie, délais) sans conserver
  le contenu ; plus coûteux (2 tables × 2 langues + JSONB) et n'apporte rien ici : les journaux
  d'audit conservent déjà la trace des actions.

**Recommandation (à trancher par le DPO)** : **(a)**, avec des seuils distincts par table et un test
qui prouve qu'une notification en cours de retry ou un message non lu du mois n'est **pas** purgé.
Si le DPO préfère (b), le registre doit citer la durée exacte — sinon la dette reste ouverte.

### D3 — `compress_media` : implémenter ou retirer *(produit)* — ✅ **TRANCHÉE : (a) retirer**

> **Décision du 2026-09-25 : option (a)**, appliquée au lot L6.3 (journal §5). Le handler stub est
> **supprimé** du worker ; un job portant `compress_media` échoue désormais comme tout type inconnu
> (`Type de job inconnu: …`, jamais un faux succès) ; la suite `phase27` refuse la réintroduction
> d'un handler `NOT_IMPLEMENTED` permanent, et un cas y prouve que « échec du handler ⇒ `failed` à
> la limite » sans dépendre d'un stub. **(c) reste la voie si la compression devient un besoin** :
> côté clients avant envoi, les plafonds serveur 8/12 Mio restant la garantie. (b) n'est pas justifié:
> aucune bibliothèque de traitement d'image dans le dépôt, et le gain de stockage n'a jamais été
> mesuré — l'introduire serait une dépendance native et une surface d'attaque sans besoin.

**Faits mesurés** : `apps/worker/src/main.ts:306` — `compress_media` **échoue explicitement**
(`NOT_IMPLEMENTED: compression média`), aucun chemin de code ne le met en file ; les envois média
sont plafonnés à **8 Mio** (`MEDIA_MAX_UPLOAD_BYTES`, `media.service.ts:16`) et à **12 Mio** au bord
(nginx `client_max_body_size 12M`, `media.controller.ts:52`) ; aucune bibliothèque de traitement
d'image n'est présente dans le dépôt.

**Options** :
- **(a) Retirer le handler** et l'annoncer comme tel (« les médias sont stockés tels quels, plafonnés
  à 8 Mio ») : zéro dépendance, zéro surface d'attaque nouvelle, rien à prouver. *Coût XS.*
- **(b) Implémenter côté serveur** (ex. `sharp`) : gain de stockage/bande passante, mais introduit
  une dépendance native dans le worker et **une surface d'attaque à dimensionner** (bombes de
  décompression : plafond de pixels obligatoire, mémoire du conteneur). *Coût M + tests de limites.*
- **(c) Compresser côté clients** (Flutter/web) avant envoi : pas de dépendance serveur, mais aucune
  garantie (un client modifié envoie ce qu'il veut) et le chemin `base64` staff n'a pas d'UI.

**Recommandation** : **(a)** maintenant (le stub « qui échoue » est honnête mais c'est une dette
silencieuse annoncée comme intégration), et **(c)** le jour où l'UI photo staff est câblée — la
limite serveur de 8 Mio reste la garantie. (b) seulement si le coût de stockage devient mesurable.

### D4 — Portée du lot 3 (`parent-mobile`) *(produit)*

**Faits mesurés** : `refresh_token` stocké mais **jamais utilisé** ; session de 15 min
(`expiresIn: '15m'`) ; `photos_page`/`consents_page` affichent un spinner **infini** en cas d'échec ;
`apps/parent-mobile/test/` **n'existe pas** ; `pubspec.lock` non versionné ; `flutter.yml` ne lance
`flutter test` que pour `staff-mobile`. Blocage d'exécution de ce lot dans l'environnement de
rédaction : ni SDK Flutter ni accès `pub.dev`/`storage.googleapis.com` (mesure au §5, lot 3).

**Options** :
- **(a) Correctif court** — intercepteur Dio `401 → refresh` single-flight + purge/retour OTP, états
  d'erreur + réessai sur les 2 écrans, `pubspec.lock` commité, `flutter test` branché en CI :
  ≈ 1–2 j, **supprime le défaut bloquant** (app inutilisable après 15 min).
- **(b) Offline-first complet** — cache local + file d'envoi + résolution de conflits côté parent :
  plusieurs semaines, et le serveur porte déjà `sync_push`/`sync_pull` (le staff l'utilise) ; à
  cadrer comme une mission, pas comme un lot de réparation.

**Recommandation** : **(a)** d'abord (c'est ce que le rapport d'audit qualifiait de bloquant),
**(b)** ensuite si le terrain le demande.

### D5 — Clips vidéo : plafond et voie d'envoi *(produit + ops)* — ✅ **TRANCHÉE : (c), avec (a) en réserve**

> **Décision du 2026-09-25 : option (c)**, appliquée au lot L6.4 (journal §5). Faits mesurés qui
> motivent (c) : le flag `video_surveillance` est **inactif par défaut** (seed 014), **aucun écran
> du dépôt n'envoie de clip** (l'écran `VideoPage` liste les caméras, liste/visionne les clips et
> crée des caméras — mais n'envoie rien), et la seule route d'envoi
> (`POST /video/clips/presign-upload`) est **fail-closed en production** depuis le lot 2B
> (D1 = A : pas de sous-domaine public). La vidéosurveillance n'est donc plus présentée comme
> opérationnelle (README/HANDOFF/ROADMAP qualifiés), et un **verrou** (`phase21`, cas 9) fait
> échouer la CI si un client câble l'envoi sans que D5 ne soit rouverte.
> **(a) reste la réserve** si la vidéosurveillance entre au programme du pilote : envoi par l'API
> (streaming vers le stockage, plafond dédié 100–200 Mio, `client_max_body_size` et timeouts
> associés) — coût M, à dimensionner avec les tests de limites. (b) rouvrirait D1, écartée.

**Faits mesurés** : l'envoi de clips passe par un **presign S3** (`POST /video/clips/presign-upload`) ;
la décision D1 = **A** (contenu servi par l'API, pas de sous-domaine public) rend ce presign
**inutilisable en production** (il est déjà *fail-closed* côté média, lot 2B). Les plafonds actuels
(8/12 Mio) sont dimensionnés pour des photos, pas pour des clips.

**Options** :
- **(a) Envoi par l'API avec plafond dédié** (ex. 100–200 Mio, streaming vers le stockage sans
  bufferiser en mémoire, `client_max_body_size` et timeouts associés) : cohérent avec D1 = A,
  *coût M + tests de limites*.
- **(b) Voie S3 directe** (sous-domaine public) pour les clips uniquement : contredit D1 = A, rouvre
  la question des URLs publiques.
- **(c) Retirer la vidéosurveillance du discours produit** tant que le dimensionnement n'est pas
  fait : le module est déjà derrière un drapeau d'organisation (`video_surveillance`).

**Recommandation** : **(a)** si la vidéosurveillance est au programme du pilote ; sinon **(c)**, pour
ne pas laisser croire que la fonction est opérationnelle.

**D6 — exécution (2026-09-25, nuit).** Option (c) livrée : refus explicite côté serveur, chemin
d'écriture sans octets supprimé, client nettoyé, contrats réécrits, suites API adaptées (phase6,
phase25, phase77) et banc F4 (`test_live/sync_api_f4_test.dart` + runner) mis en accord avec la
décision — ce dernier compte désormais le refus comme une **preuve** : statut local `rejected` +
motif `OFFLINE_PHOTO_UNSUPPORTED`, et côté base `status='rejected'` avec
`rejection_reason='OFFLINE_PHOTO_UNSUPPORTED'`.

*Preuves exécutées localement* : **gate D complet vert (exit 0, 73 suites journalisées, rôles et
grants de production)** ; `phase6` ✅ (refus + aucun `media_assets` fantôme), `phase25` ✅
(C1/C2/C4/C3/C5), `phase77` ✅ (9 cas) ; builds `@creche/api` et `@creche/worker` verts ; 13 suites
statiques **80/80** ; contrat `media-client-wiring` 5/5 avec **3 mutations rouges** (branche qui
réécrit, `registerFromSync` de retour, route plus nommée *dans la branche* — la 1re tentative de
mutation avait visé le message du garde L2E, preuve que le contrat cible bien la bonne occurrence).

*Verdicts CI* : job `flutter` **vert** sur `265be27`, `8fecc6a`, `3b7e128` et `ce69bbd` ; job
`database` **rouge** sur `8fecc6a` puis `3b7e128` — chaque fois avec une cause **nommée** (le banc F4
comptait encore la photo hors ligne comme acceptée, puis sa requête ne ramenait pas la colonne lue
par l'assertion), corrigée dans le commit suivant.

**VERDICT FINAL — `ce69bbd` : TOUT VERT** (premier run entièrement vert de cette branche). Run `ci`
`36218031204` : **7/7 jobs** — `database`, `quality`, `security`, `e2e`, `admin-web`,
`support-console`, `backup-drill` ; run `flutter` **success** ; run `docker` **success**. Deux
annotations disent l'essentiel : `F4 Flutter API passed` (7 tests Flutter/Drift réels contre l'API
HTTP + PostgreSQL : deux appareils, push/pull, replay, conflit, redémarrage, isolation) et
`F2 Flutter passed` (**57 tests et l'analyse, avec le lockfile appliqué** — `--enforce-lockfile` est
donc actif : une dérive de dépendance fera échouer le job au lieu de changer le binaire en silence).
Le faux vert et les trois défauts qu'il masquait sont clos, et D6 est prouvée de bout en bout
(client, API, base).

### D6 — Photos hors ligne : par où passent les OCTETS ? *(produit + tech)*

> **DÉCISION — 2026-09-25, option (c), exécutée.** La voie hors ligne est **retirée**, pas laissée
> latente : `POST /sync/push` refuse `add_photo` avec `OFFLINE_PHOTO_UNSUPPORTED` et un message qui
> nomme `POST /api/v1/media/upload` ; le chemin d'écriture sans octets (`applyAddPhoto` +
> `MediaService.registerFromSync`) est **supprimé** ; côté client, `MediaUploader.enqueueOfflinePhoto`
> et `offlineStorageKey` sont retirés (plus aucun code Dart ne fabrique de clé `photo/offline-*` ni
> n'enfile `add_photo`). *Pourquoi (c) et pas (a) :* l'option (a) suppose un appelant — or le fait
> mesuré (lots L2C/L2D) est qu'**aucune UI ne capture ni n'enfile de photo** (ni caméra, ni
> `image_picker`, ni téléversement dans admin-web). Écrire la file locale maintenant aurait produit du
> code jamais exercé, exactement ce que ce dépôt refuse (« un test que personne n'exécute ne prouve
> rien »). *Pourquoi pas (b) :* fermée par le garde L2E (16 Ko, `PAYLOAD_BINARY_NOT_ALLOWED`).
> **Preuves exécutées** : `phase6` (refus + aucun `media_assets` fantôme), `phase25` (refus identique
> avec une clé d'une autre organisation), `phase77` (9 cas : le refus est distinct du garde de
> payload, qui reste actif), contrats `media-client-wiring` (3 mutations rouges) et
> `parent-session-contract` ; build API/worker vert. *Réversibilité* : le jour où une UI de capture
> arrive, (a) redevient le chemin — il faudra alors rouvrir le dossier et livrer les octets.

**Faits mesurés (2026-09-25, lot L2D)** :
- la commande `add_photo` de `POST /sync/push` **accepte** l'opération et crée une ligne
  `media_assets` (`media.service.ts`, `registerFromSync`) **sans écrire aucun octet** dans le
  stockage ; la lecture du contenu rend ensuite `404 MEDIA_CONTENT_MISSING` (défaut constaté **par
  exécution** pendant le lot 2B, consigné dans `docs/VERIFICATION_ANALYSE_2026-09-24.md`) ;
- **aucune UI ne capture ni n'enfile de photo** : pas d'`image_picker` ni de caméra dans
  `staff-mobile/lib`, aucun téléversement dans admin-web ; `enqueueOfflinePhoto` n'est appelé que
  par ses propres tests ⇒ la voie est **latente**, comme le presign d'écriture (lot L2C) ;
- côté client, les octets sont, en théorie, disponibles localement (`bytes` passés à
  `enqueueOfflinePhoto`) mais le client **ne les envoie pas** au serveur : il ne pousse que
  `storage_key`/`mime_type`/`checksum` (l'upload direct par presign, mort en production, était censé
  le faire à la reconnexion — voir L2C) ;
- contrainte serveur connue : le corps JSON de `POST /sync/push` est plafonné par Express
  (`100 ko` par défaut) — faire transiter une photo en base64 dans cette route **exige** un
  dimensionnement dédié (plafond, limite de lot d'opérations, mémoire du worker d'écriture).

**Options** :
- **(a) File locale côté client + `POST /media/upload` à la reconnexion** — les octets ne passent
  jamais dans le JSON de synchronisation : la route média existe déjà (lot 2B), le plafond 8 Mio et
  le consentement sont déjà vérifiés côté serveur ; le travail est **client** (stockage local du
  fichier, reprise, purge après succès) et donc **L3** (SDK Flutter requis, bloqué ici).
  *Effort M, risque faible, aucun changement serveur.*
- **(b) Base64 dans `POST /sync/push`** — ~~un seul canal pour tout l'hors-ligne~~ **FERMÉE par le
  lot L2E (2026-09-25)** : le serveur refuse désormais tout payload d'opération > 16 Ko et toute
  chaîne ≥ 4096 caractères strictement base64 (`PAYLOAD_TOO_LARGE_FOR_SYNC` /
  `PAYLOAD_BINARY_NOT_ALLOWED`, message nommant `POST /api/v1/media/upload`), car un tel payload
  était **stocké verbatim** dans `sync_operations.payload` (JSONB sans plafond), hors du pipeline
  média (ni consentement, ni plafond, ni `media_access_logs`). Rouvrir cette option supposerait de
  lever explicitement ce garde et de dimensionner corps JSON, lot et mémoire : le lot L2E a montré
  au passage qu'un corps de ~300 Ko rendait **500** au lieu de 413 (corrigé) — la surface n'est pas
  marginale. *Effort M+ ; non recommandée.*
- **(c) Retirer la voie hors-ligne du périmètre tant qu'aucune UI ne capture** — supprimer (ou
  refuser explicitement) `add_photo` côté serveur et client, et documenter « pas de photo hors
  ligne en V1 » ; la photo en ligne passe par `POST /media/upload`. *Effort XS, honnête, réversible ;
  c'est ce qui existe de fait aujourd'hui (aucune UI), mais le code laisse croire l'inverse.*

**Recommandation (mise à jour après L2E)** : **(a)** quand le travail client est ouvert (L3) —
c'est le canal qui réutilise tout l'existant (route média, plafond, consentements, audit) sans
élargir la surface du serveur ; **(c)** est l'option « zéro mensonge » si la capture photo n'est pas
au programme du pilote ; **(b)** est **fermée par le garde L2E** (il faudrait le relever
explicitement, décision qui n'a aucune raison d'être prise par défaut). **En attendant la décision**, deux verrous empêchent le contournement :
`media-client-wiring.test.mjs` refuse qu'une UI câble `enqueueOfflinePhoto` (voie qui produit un
asset sans octets) et refuse que les octets se mettent à transiter dans `registerFromSync` sans que
cette limite documentée soit mise à jour.

## 7. Définition de « fait » (par lot)

- [ ] Le correctif est justifié par une preuve **exécutée** citée dans la PR (commande + sortie) ;
- [ ] Le test qui **échoue sans le correctif** existe (rouge pré-correctif → vert), ou la preuve par
      mutation (`scripts/mutation-proof.sh`) est fournie pour les chemins sensibles ;
- [ ] Aucun cliquet baissé (couverture par fichier, seuils, suites) ;
- [ ] Les affirmations documentaires touchées sont mises à jour **dans le même commit** (pas de
      « doc à jour plus tard ») ;
- [ ] Ce que le lot **ne** couvre pas est écrit noir sur blanc (section « hors périmètre »).
