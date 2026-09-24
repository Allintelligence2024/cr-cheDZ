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
| **L1** | **Gardiens orphelins + garde de config + CSP edge** | vérif. §4.3, F2, F3 | ~2 h | 4 gardiens en CI ; test unitaire prod-config ; test de contrat en-têtes | **FAIT (ce commit)** |
| **L2** | **Rendre les médias réellement accessibles (F5)** | vérif. C3 | 1–2 j | test d'isolation : l'URL rendue au client est exploitable (hôte public, jamais `minio:9000`) | à démarrer |
| **L3** | **`parent-mobile` : session, erreurs, tests, lockfile** | vérif. C2, F4 | ~2 j | refresh single-flight + widget tests exécutés en CI (`flutter test` parent) | planifié |
| **L4** | **Rétention file de notifications/messages + mineurs (DPO)** | vérif. §4.7, ligne 60 | S/M (décision) | purge planifiée testée **ou** justification écrite au registre | décision requise |
| **L5** | **Vérité documentaire anti-« regonflage »** | vérif. F1, §4.4 | ~0,5 j | test de contrat « affirmations » + docs corrigées | planifié |
| **L6** (opt.) | **Worker : stub `compress_media`, k6, healthchecks** | vérif. F1/F2, §4.4 | S | décision tracée (implémenter **ou** retirer) ; healthcheck API/worker | optionnel |

**Ordre recommandé** : L1 (fait) → **L2** (bloque l'usage réel) → L3 (bloque les parents) → L5
(pas de dépendance, peut glisser entre les deux) → L4 (attend une décision DPO) → L6.

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
`isolation` + `phase3 → phase65`).

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
   **BLOQUÉ localement** : aucun SDK Flutter dans l'environnement de rédaction → à produire par un
   poste avec Flutter 3.47.1 (`flutter pub get` puis commit du lockfile).

### Lot 4 — Rétention et mineurs *(décision DPO requise)*
- **File de notifications / messages** : aucune purge n'existe (`notification_queue`, `messages`) ;
  seuls les journaux et les clips vidéo (30 j) sont outillés. Décision : purge planifiée (tick
  `scheduler_ticks` + `SECURITY DEFINER` + suite dédiée) **ou** justification de conservation
  écrite au registre (limitation de conservation, loi 25-11).
- **Mineurs** : le fondement de la représentation légale (tuteur, `guardians`, `consent_records`)
  est implémenté ; ce qui manque est la **trace documentaire** au registre des traitements. À
  formaliser par le DPO, pas par du code.

### Lot 5 — Vérité documentaire anti-« regonflage »
Sur le modèle d'`openapi-contract.test.mjs` (un test qui échoue si la doc redevient flatteuse) :
1. interdire les affirmations non implémentées (« Quartz », « healthcheck » sans directive réelle) ;
2. vérifier les compteurs revendiqués (ADR, runbooks, migrations, suites) contre le disque ;
3. corriger les chiffres des documents existants (`PLAN_*`, `README`, `SECURITY.md`).

### Lot 6 (optionnel) — Worker et charge
- `compress_media` : stub qui échoue explicitement (`main.ts:305`) — **décider** : implémenter
  (sharp/worker) ou retirer du handler (un stub permanent est une dette silencieuse) ;
- `tests/load/sync.k6.js` : **jamais exécuté** (k6 absent) — soit l'exécuter sur une cible
  prod-like et publier les résultats, soit le retirer du discours « tests de charge » ;
- `HEALTHCHECK` Docker : n'existe que pour Postgres ; en ajouter un pour l'API (`/api/v1/health`)
  et le worker (heartbeat `scheduler_health()`), avec `depends_on: service_healthy`.

---

## 5. Journal des preuves — Lot 1 (exécuté le 2026-09-24)

Environnement : `node v22.22.3`, `npm 10.9.8`, `npm ci` → 929 paquets. Poste **sans** PostgreSQL,
Docker ni SDK Flutter (d'où les tâches marquées BLOQUÉES). Toutes les sorties ci-dessous sont
**réelles**, copiées des commandes exécutées.

```
# Gardiens orphelins — ligne de base AVANT câblage CI (tous verts)
node scripts/check-env-example.mjs        → exit 0  (« .env.prod.example : 14 variables requises présentes », « .env.example : 5 »)
node scripts/check-android-manifest.mjs   → exit 0  (« 2 app(s) conformes, 4 avertissements »)
node scripts/inventory-route-guards.mjs   → exit 0  (« 195 routes HTTP inventoriées — 49 sans @Roles ni @Public (à revoir) »)
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

## 6. Décisions en attente (propriétaire explicite)

| # | Décision | Propriétaire | Bloque |
|---|---|---|---|
| D1 | Stockage : option **A** (stream same-origin) ou **B** (sous-domaine + TLS) | produit + ops | Lot 2 |
| D2 | Rétention `notification_queue`/`messages` : purger ou justifier | DPO | Lot 4 |
| D3 | `compress_media` : implémenter ou retirer | produit | Lot 6 |
| D4 | `parent-mobile` : offline-first complet maintenant, ou refresh + états d'erreur seuls | produit | portée du Lot 3 |

## 7. Définition de « fait » (par lot)

- [ ] Le correctif est justifié par une preuve **exécutée** citée dans la PR (commande + sortie) ;
- [ ] Le test qui **échoue sans le correctif** existe (rouge pré-correctif → vert), ou la preuve par
      mutation (`scripts/mutation-proof.sh`) est fournie pour les chemins sensibles ;
- [ ] Aucun cliquet baissé (couverture par fichier, seuils, suites) ;
- [ ] Les affirmations documentaires touchées sont mises à jour **dans le même commit** (pas de
      « doc à jour plus tard ») ;
- [ ] Ce que le lot **ne** couvre pas est écrit noir sur blanc (section « hors périmètre »).
