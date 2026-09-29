# PLAN DE REMÉDIATION — 2026-09-27

> **Origine** : rapport d'analyse complète en 10 axes
> ([`RAPPORT_ANALYSE_COMPLETE_2026-09-27.md`](./RAPPORT_ANALYSE_COMPLETE_2026-09-27.md)).
>
> **Correctif de méthode, important** : le rapport d'analyse a repris des
> affirmations issues de documents **périmés**. La vérification contradictoire
> menée en préparation de ce plan a **réfuté 3 de ses 4 actions P0**
> (§1 ci-dessous). Ce plan ne reprend donc **que des défauts mesurés dans le
> code ou sur une base PostgreSQL 18 réelle** au 2026-09-27. C'est exactement
> le mode de défaillance que le rapport dénonçait (« le code était sain, la
> documentation mentait ») : il a été reproduit, puis corrigé ici.

---

## 0. Environnement de preuve

| Outil | Disponible | Conséquence |
|---|---|---|
| **PostgreSQL 18.4 réel** (`embedded-postgres`, `run_pg.mjs`, port 54329) | ✅ | Migrations, seeds, suites PG, mesures de plans exécutables |
| Node 22 + `npm ci` (929 paquets) | ✅ | Build API/worker, jest, gardiens `node --test` |
| Build `@creche/api` + `@creche/worker` | ✅ | Suites d'isolation API exécutables |
| **Navigateur (Chromium Playwright)** | ❌ local / ✅ CI (`36357511493`) | Le job `e2e` a installé Chromium et réussi, y compris les assertions de purge média ; le run CI complet s'est terminé avec succès (`database` inclus). |
| SDK Flutter / Dart | ❌ | Compilation et exécution Dart : **BLOQUÉ** |
| Docker | ❌ | Composes non démarrables |
| k6 | ❌ | Non exécuté (le banc `capacity-bench` reste la mesure de référence) |

**Règle appliquée** (celle du dépôt) : ce qui ne peut pas être exécuté ici est
marqué **BLOQUÉ** avec l'outillage requis. Jamais coché, jamais contourné par
un test complaisant.

---

## 1. Vérification contradictoire des P0 du rapport d'analyse

Le rapport proposait 4 actions P0. Trois ne résistent pas à la vérification.

| # | Action P0 proposée | Verdict | Preuve |
|---|---|---|---|
| **P0-1** | « Rebrancher l'upload `staff-mobile` sur `POST /media/upload` » | ❌ **RÉFUTÉ — déjà fait** | `media_uploader.dart` envoie le multipart à `/media/upload` depuis le **lot L2F (2026-09-26)** : SHA-256 réelle (`crypto.sha256.convert`), 1 seul retry sur panne de **transport** (jamais sur 4xx/5xx), délais bornés 60 s, clé composée **côté serveur**. `media-client-wiring.test.mjs` le dit explicitement. La mention contraire vient de la section **« Limites connues » de `SECURITY.md`, qui est périmée**. |
| **P0-3** | « Construire l'anonymisation à chaud par enfant/famille » | ❌ **RÉFUTÉ — déjà fait** | `anonymize_child()` = migration **067** + garde staff **071** ; endpoint `POST /privacy/children/:id/anonymize` dans `privacy.controller.ts` ; couverture par **3 suites** (`phase52`, `phase56`, `phase56b`). L'affirmation venait de `VERIFICATION_RAPPORT_5_ANALYSES.md` (2026-09-19), antérieur aux migrations 067/071. |
| **P0-4** | « Rendre le job `quality` bloquant » | ⚠️ **NON VÉRIFIABLE** | L'API de branch protection renvoie **403** pour l'intégration (`Resource not accessible by integration`). Ce n'est pas un défaut code : c'est un réglage dépôt. Retraité en **lot 4**. |
| **P0-2** | « 2 specs e2e squelettes » | ✅ **CONFIRMÉ** | **7 `test.skip` sur 13 tests** (`billing-overdue-flow` 4/4, `payroll-finalize-lock` 3/3). |

**Troisième réfutation, non listée en P0** : le rapport affirmait aussi
« aucun trigger DELETE sur invoices — suppression SQL possible ». **Faux** :
`trg_no_delete_invoices`, `trg_no_delete_payments`,
`trg_no_delete_allocations` → `no_financial_delete()` lève `42501`. Le cycle de
vie financier est **totalement** immuable, effacement compris.

Conséquence : le §4.4 du rapport, le tableau « ce que l'analyse retient » et
les actions P0 du plan sont **corrigés** par le lot 0 ci-dessous.

---

## 2. Défauts retenus — mesurés, datés (état initial au 2026-09-27 ; sorties en §11–12)

| # | Défaut | Mesure | Sévérité |
|---|---|---|---|
| **D1** | **32 tables portant `organization_id` n'ont aucun index dont cette colonne est la tête** — alors que **chaque politique RLS** s'écrit `USING (organization_id = app_tenant_id())` | 68 tables avec `organization_id` ; 36 indexées ; **32 non**. Banc : **Seq Scan 0,304 ms → Index Scan 0,052 ms = 5,8×** à 40 organisations ; **1,028 ms → 0,064 ms = 16,1×** à 100. Le coût du seq-scan croît **linéairement** avec le nombre total de clients : **servir une crèche coûte de plus en plus cher à mesure que la plateforme grandit** | 🔴 **P0** |
| **D2** | **7 tests e2e skippés sur 13** (2 specs entièrement squelettes) | `grep -c test.skip` : 4 + 3 | 🔴 **P0** |
| **D3** | **Aucun garde n'interdit un `test.skip` en e2e** — un squelette peut rester indéfiniment sans signal | Aucun script ne contrôle `apps/admin-web/e2e/` | 🟠 **P1** |
| **D4** | **« Limites connues » de `SECURITY.md` périmées** : annonce encore le presign côté `staff-mobile`, corrigé depuis L2F | `SECURITY.md:54-57` vs `media_uploader.dart` | 🟠 **P1** |
| **D5** | **Le rapport d'analyse contient 3 affirmations réfutées** (P0-1, P0-3, trigger DELETE) — il est déjà commité et poussé | §1 ci-dessus | 🟠 **P1** |
| **D6** | **CodeQL absent** ; aucun scan d'images de conteneurs | `SECURITY.md` + aucun workflow | 🟠 **P1** |
| **D7** | **Aucune UI d'anonymisation dans `admin-web`** — l'API existe et est testée, mais une directrice ne peut pas déclencher l'opération depuis le produit | `grep -rn anonymis apps/admin-web/src` → 0 résultat | 🟡 **P2** |

---

## 3. Règles du plan (celles du dépôt, inchangées)

1. **Aucun lot déclaré fait sans preuve exécutée** (sortie citée). « Le code est
   écrit » ≠ « c'est vérifié ».
2. **Pas de faux vert** : ce qui n'est pas exécutable ici est **BLOQUÉ**, avec
   l'outillage requis nommé.
3. **Les cliquets ne baissent pas** : toute correction ajoute sa couverture
   (suite PG, gardien câblé, seuil jest).
4. **Une migration appliquée ne se modifie jamais** (ADR-007) : 077 s'ajoute,
   001–076 ne bougent pas.
5. **1 lot = 1 commit** sur `arena/01a0e39f-cr-chedz`.
6. **Corriger un rapport est aussi risqué que l'écrire — et le lot 1 l'a
   prouvé à mes dépens.** Un encadré « ⚠️ correction » bénéficie d'un crédit
   que rien ne justifie : il a l'air d'avoir été vérifié deux fois. Désormais
   : toute correction porte sa preuve **rejouable** (`fichier:ligne`, ou la
   requête **et** son résultat) ; toute réfutation dont la preuve n'est pas
   retrouvée est **retirée**, jamais adoucie. Toute affirmation de contrainte
   (« un vérificateur interdit X ») sans chemin d'accès est supprimée.

---

## 4. Vue d'ensemble des lots

| Lot | Objectif | Défaut | Effort | Preuve de sortie | Statut |
|---|---|---|---|---|---|
| **L0** | **Corriger les affirmations réfutées** du rapport d'analyse (P0-1, P0-3, trigger DELETE) et les P0 du plan | D5 | 0,3 j | Sections corrigées ; `claims-contract` 10/10 | ✅ livré |
| **L1 — PHASE 1** | **Indexer `organization_id` sur les tables tenant** + gardien + banc + suite | D1 | 1 j | migration 077 appliquée, gardien en CI, banc 5,8×/16,1×, suite `phase78`, 74 entrées + garde RLS rejouées | ✅ livré (`92dd960`) |
| **L2** | **e2e** : compléter les 2 specs + garde anti-squelette | D2, D3 | 1–2 j | 13/13 collectés sans skip ; gardien CI, seed paie et preuve API 16/16 ; job Chromium `e2e` réussi sur la PR #51 (`36356110967`) | ✅ preuve navigateur CI |
| **L3** | **Vérité documentaire** : « limites connues » vérifiées contre le code | D4 | 0,5 j | gardien qui échoue si une limite citée n'existe plus | ✅ livré |
| **L4** | **Durcir la CI** : CodeQL + scan d'images + job `quality` requis | D6, P0-4 | 1 j | Findings des 4 images identifiés ; bases runtime actualisées et npm retiré des images Node ; revalidation Trivy et réglages administrateur encore en attente | 🟡 |
| **L5** | **UI d'anonymisation** dans `admin-web` (écran directeur) | D7 | 2 j | UI + garde de rôle, API `phase56b` 10/10 ; Chromium a validé le parcours et le rendu de l'échec de purge média (`36357511493`) | ✅ livré, preuve navigateur CI |

**Ordre recommandé** : L0 ✅ → L1 ✅ → L2 ✅ (job Chromium `e2e` réussi sur la PR #51) → L3 ✅ → L4 🟡 (CodeQL et `quality` verts ; findings Trivy maintenant identifiés, corrections/revue du JSON complet et protection administrateur encore en attente) → L5 ✅ (API `phase56b` et parcours UI avec échec de purge média prouvés).

---

## 5. LOT 1 — PHASE 1 : indexation des tables tenant

### 5.1 Pourquoi c'est le premier lot

C'est le seul défaut retenu qui soit à la fois (a) mesuré, (b) d'impact
**croissant** — il s'aggrave avec chaque nouvelle crèche —, (c) entièrement
exécutable dans cet environnement, et (d) sans dette reportée.

### 5.2 Constat mesuré

```
TABLES AVANT organization_id : 68 | AVEC index de tête : 36 | SANS : 32
  [RLS] allergies  attendance_events  authorized_pickups  background_jobs
        child_status_history  conversation_participants  daily_cash_registers
        daily_summaries  emergency_contacts  feature_flags  health_records
        invoice_lines  media_access_logs  medication_administrations
        medication_administrations  medication_authorizations  messages
        notification_inbox  notification_queue  outbox_events
        payment_allocations  payroll_entries  payroll_lines
        privacy_request_exports  processing_registry  room_moves
        staff_assignments  staff_attendance  staff_documents  sync_cursors
        vaccinations
  [sys] sessions  users
```

Banc (`tests/perf/bench-tenant-index.mjs`, base jetable clonée) :

| Organisations | Lignes | Sans index | Avec index | Gain |
|---|---|---|---|---|
| 40 | 3 000 | Seq Scan **0,304 ms** | Index Scan **0,052 ms** | **5,8×** |
| 100 | 7 500 | Seq Scan **1,028 ms** | Index Scan **0,064 ms** | **16,1×** |

Lecture : le seq-scan passe de 0,304 à 1,028 ms quand on triple le volume
(croissance **linéaire**), pendant que l'index reste à ~0,06 ms (**constant**).

### 5.3 Décision et périmètre

- **Index créés** : `CREATE INDEX IF NOT EXISTS idx_<table>_org ON <table>(organization_id)`
  sur les **30 tables tenant (RLS)** dépourvues d'un tel index.
- **Index simples, pas composites** : choix volontairement conservateur. Une
  requête ne filtrant que par `child_id` (depuis une fonction `SECURITY DEFINER`
  qui court-circuite la RLS) perdrait l'usage d'un composite `(organization_id, child_id)`.
  Les index existants (`idx_allergies_child`, `idx_invoice_lines_invoice`…) sont
  **conservés** : PostgreSQL peut combiner par `BitmapAnd`.
- **Exemptions justifiées** (listées dans le gardien, jamais implicites) :
  - `users`, `sessions` → tables **système**, sans RLS par conception (accès
    cross-tenant contrôlé par les gardes applicatifs) ; déjà indexées sur
    `email`, `phone`, `user_id`, `refresh_token_hash` ;
  - `feature_flags`, `processing_registry` → tables de **configuration** de
    quelques dizaines de lignes maximum (documenté dans le code) ; un seq-scan
    y est optimal et un index serait du bruit.

### 5.4 Risque d'exploitation identifié — et traité

`CREATE INDEX` pose un verrou **SHARE** : il **bloque les écritures** sur la
table pendant sa construction. Sur une base en production avec de grosses
tables, c'est une interruption de service.

La parade habituelle, `CREATE INDEX CONCURRENTLY`, **ne peut pas s'exécuter
dans une transaction** — or le runner de migrations enveloppe chaque fichier
dans `BEGIN … COMMIT` (`scripts/migrate.mjs:96`). Les deux contraintes sont
donc incompatibles dans le cadre d'une migration.

**Décision** : la migration utilise `IF NOT EXISTS`. Conséquence — un
exploitant peut **pré-créer les index en `CONCURRENTLY` hors bande** avant un
déploiement sur grosse table ; la migration les détecte alors et **ne refait
rien** (idempotente, aucun verrou long). La procédure est écrite dans l'en-
tête de la migration et dans le runbook. À ce stade du projet (avant pilotes,
tables de petite taille) la voie transactionnelle est sûre ; la voie
`CONCURRENTLY` reste ouverte sans modification de code.

### 5.5 Livrables

| # | Fichier | Rôle |
|---|---|---|
| L1.1 | `infrastructure/database/migrations/077_tenant_org_indexes.sql` | Les index, exemptant les 2 tables système + 2 tables de configuration |
| L1.2 | `tests/perf/bench-tenant-index.mjs` | Banc : prouve le gain (plan + temps médian), base jetable |
| L1.3 | `scripts/check-tenant-index.mjs` | Gardien : échec si une table tenant sans index, ou si une exemption invoquée n'est plus valable |
| L1.4 | `tests/tenant-isolation/phase78-tenant-index.pg.test.mjs` | Suite : index présents, plan indexé, exemptions justifiées, rejeu idempotent |
| L1.5 | `.github/workflows/ci.yml` | Gardien câblé dans le job `quality` |
| L1.6 | `scripts/run-isolation-suites.sh` | `phase78` ajoutée à la batterie |

### 5.6 Critère de sortie

1. `077` appliquée sur PG 18 réel, `--status` sans drift ;
2. banc exécuté : plan `Index Scan` et gain > 1,5× (mesuré : 5,8× et 16,1×) ;
3. gardien `check-tenant-index.mjs` vert ;
4. suite `phase78` verte ;
5. **les 74 entrées du runner + le garde anti-bypass RLS rejoués sans
   régression** (un index ne doit rien changer fonctionnellement ; le runner
   journalise aussi 75 contrôles quand on compte le garde séparé).

---

## 6. Lot 2 — e2e (D2, D3)

- **L2.1** Compléter `billing-overdue-flow.spec.ts` (4 tests) et
  `payroll-finalize-lock.spec.ts` (3 tests) selon `docs/PHASE4-MANUAL.md` §S1.
  *Rectificatif :* le plan initial référençait `HANDOFF-AGENT-ANTIGRAVITY.md`
  §ITEM 1, un fichier qui n'existe pas dans ce dépôt ; la référence vérifiée est
  la procédure S1 ci-dessus.
- **L2.2** Gardien `check-e2e-skeletons.mjs`, câblé dans `quality` : refuse les
  `describe.skip` et `test.skip(true)`, les fichiers sans test réellement actif,
  et tout skip conditionnel sans date ISO + référence de lot. Il vérifie aussi
  les codes d'erreur des assertions, les couples méthode+chemin des appels
  Playwright contre les décorateurs NestJS réels, et les libellés contre le
  code serveur et le corpus UI.
- **L2.3** Étendre `seed-e2e.mjs` : sur base neuve et sur compte déjà présent,
  créer/compléter l'employé rémunéré requis par les tests de paie ; le seed
  devient rejouable et échoue explicitement si aucun salaire positif n'existe.
- **Blocage** : Chromium est introuvable et `npx playwright install chromium`
  échoue au téléchargement. Les specs et le build/typecheck sont vérifiés, et
  les comportements API sous-jacents sont prouvés par des requêtes HTTP directes
  contre l'API démarrée sur PG 18 — jamais présentés comme « specs navigateur
  vertes ». L'exécution navigateur sur un runner CI/recette équipé, avec base
  PG18 jetable, reste une preuve de sortie à obtenir.

## 7. Lot 3 — vérité documentaire (D4)

Étendre `tests/tenant-isolation/claims-contract.test.mjs` : confronter les
phrases de la section « **Limites connues** » de `SECURITY.md` au code. Une
limite qui n'existe plus doit faire échouer le contrat (c'est ce qui a laissé
passer l'affirmation périmée sur le presign).

## 8. Lot 4 — durcissement CI (D6, ex-P0-4)

- Workflow **CodeQL** (JavaScript + TypeScript), sur PR/push vers `main` et
  hebdomadaire.
- Scan des 4 images par Trivy, en échec sur `CRITICAL,HIGH`, avant tout push
  GHCR ; le rapport JSON est conservé comme artifact même en cas d'échec.
- Avant le premier upload CodeQL, un administrateur doit vérifier que le
  « default setup » Code Scanning n'est pas actif en parallèle : GitHub rejette
  les uploads SARIF du workflow avancé si cette configuration reste activée
  ([documentation](https://docs.github.com/en/code-security/code-scanning/troubleshooting-sarif-uploads/default-setup-enabled)).
  L'API de lecture renvoie 403 à l'intégration.
- `quality` en check requis : **réglage dépôt**, hors de portée de l'intégration
  (403 observé). Un administrateur peut l'ajouter sans écraser les checks déjà
  requis avec cette commande additive :
  ```bash
  gh api --method POST \
    repos/Allintelligence2024/cr-cheDZ/branches/main/protection/required_status_checks/contexts \
    -f 'contexts[]=quality'
  ```
  Cette commande exige des droits d'administration et suppose une protection
  classique active sur `main`. Elle ajoute `quality` à la liste existante ; elle
  ne remplace pas `database` ni les autres contextes. Vérifier ensuite dans
  **Settings → Branches → protection de `main` → Require status checks** que
  `quality` apparaît, en conservant tous les checks existants. Si `main` est
  gouvernée par un ruleset, ajouter le check dans **Settings → Rules → Rulesets**
  plutôt que d'utiliser cet endpoint. L'intégration n'a pas pu lire le réglage
  actuel (403 `Resource not accessible by integration`).

## 9. Lot 5 — UI d'anonymisation (D7)

Écran `admin-web` réservé `director`/`super_admin` : recherche d'un enfant
**sorti**, saisie du **motif obligatoire** (≥ 5 caractères, exigé par la
fonction SQL), confirmation, affichage du résultat structuré (tuteurs
anonymisés, clés de stockage à purger). L'endpoint et les 3 suites existent
déjà : ce lot est **uniquement** de l'UI + un test d'accès par rôle.

---

## 10. Journal d'exécution

| Date | Lot | Ce qui a été fait | Preuve |
|---|---|---|---|
| 2026-09-27 | — | Vérification contradictoire des P0 : 3 réfutés sur 4 | §1 |
| 2026-09-27 | L1 | PG 18 démarré, 76 migrations + seeds appliqués | sortie `migrate`/`seed` |
| 2026-09-27 | L1 | Banc écrit et exécuté : 5,8× (40 orgs), 16,1× (100 orgs) | §5.2 |
| 2026-09-27 | L1 | Migration 077, gardien, suite phase78, câblage CI | §11 |
| 2026-09-27 | L1 | **3 réfutations vérifiées dans le rapport** : P0-1 et P0-3 (code rebranché / correctif appliqué), ligne « `invoices` sans trigger DELETE » (`trg_no_delete_invoices` existe) | §1, §11.4 |
| 2026-09-27 | L1 | **1 rétractation** : une « correction » insérée la veille citait `audit_events`/`audit_archive`/`trg_audit_no_mod` — aucune de ces trois choses n'existe. Encadré retiré, constat d'origine rétabli | §11.4 |
| 2026-09-27 | L3 | Réécriture précise des limites vidéo/EXIF dans `SECURITY.md`, avec chemins de preuve | §13 |
| 2026-09-27 | L3 | Contrat `claims-contract` étendu : **11/11** ; 2 mutations (limite vidéo retirée, MIME vidéo ajouté) échouent comme prévu | §13 |
| 2026-09-27 | L4 | CodeQL v4.38.2 + Trivy v0.36.0 configurés ; le workflow conditionne le push GHCR au scan | §14 |
| 2026-09-27 | L4 | Contrat sécurité **12/12**, mutation du seuil Trivy détectée ; YAML, lint, 14 gardiens vérifiés | §14 |
| 2026-09-27 | L4 | PR brouillon #51 : CodeQL + `quality` verts ; build des 4 images OK mais Trivy échoue sur chaque scan, artifacts JSON déposés ; protection/default setup toujours inaccessibles (403) | §14 |
| 2026-09-27 | L5 | Onglet d'anonymisation `admin-web`, réservé à director/super_admin ; raison, confirmation, résultats structurés | §15 |
| 2026-09-27 | L5 | Matrice + visibilité **10/10**, mutation détectée, API `phase56b` **10/10** ; E2E média passé sur `2151f77` (`36356961132`), puis revalidé avec toute la suite sur le head `5022050` (`36357511493`) ; typecheck/lint/gardien verts | §12.7, §15 |
| 2026-09-28 | L4 | Résumé Trivy exécuté sur les 4 images au run `36376953373` ; 10 annotations HIGH/CRITICAL par image récupérées par l'API Checks ; findings documentés, artefacts JSON encore en `EOF` | §14 |
| 2026-09-28 | L4 | Origine du `brace-expansion@2.0.2` vérifiée dans le npm 10.9.9 fourni avec Node ; bases Node 22.23.3/Trixie et Nginx 1.30.5/Alpine 3.24 préparées, npm/Corepack/Yarn retirés du runtime Node ; revalidation CI pending | §14 |

---

## 11. Résultats du lot 1

**Conclusion : lot 1 livré.** Les cinq critères de sortie sont atteints. Aucun
n'est atteint « par défaut » — chacun a été mesuré, et deux d'entre eux ont
d'abord échoué avant d'être corrigés (§11.1).

| # | Contrôle | Résultat |
|---|---|---|
| 1 | `077` appliquée, `migrate.mjs --status` sans drift | ✅ `077 … appliquée … 31d9dcbc` · « ✓ Schéma cohérent avec les fichiers de migrations. » |
| 2 | Banc : plan indexé + gain > 1,5× | ✅ **5,8×** (40 organisations) · **16,1×** (100 organisations) — seuil 1,5× |
| 3 | `check-tenant-index.mjs` | ✅ vert avec base · **code 1** sur index manquant, exemption obsolète, index `INVALID` · **code 2** sans `DATABASE_URL` |
| 4 | `phase78` verte | ✅ **12/12 assertions**, exécutée deux fois de suite (réjouabilité prouvée) |
| 5 | 73 suites + garde RLS sans régression | ✅ **70/75** — les 5 échecs sont environnementaux et **reproduits sans les index** (§11.2) |

### 11.1 Ce qui a d'abord échoué — et ce que ça a appris

Aucun de ces trois points n'était visible à la lecture ; tous sont apparus à
l'exécution. C'est précisément pour ça que la suite a été écrite.

**a. Le planificateur ne prenait PAS l'index.** Avec 120 lignes de test, la
table tient en deux pages : le balayage séquentiel est *réellement* le meilleur
plan, et l'assertion « Index Scan » échouait **pour une bonne raison**. Le jeu
d'essai est passé à 40 organisations × 60 messages (sélectivité ~2,5 %) avant
que la comparaison ait un sens. *Morale : une assertion de plan d'exécution sans
contrôle de la taille du jeu d'essai ne prouve rien.*

**b. Le contexte tenant était perdu entre deux requêtes.** `set_config('app.tenant_id', …, true)`
est un `SET LOCAL` : la GUC vit le temps de la **transaction**, pas de la
session. Mes premières mesures rendaient donc 0 ligne. Le test encapsule
désormais toutes les mesures applicatives entre un `BEGIN` et un `ROLLBACK`.
L'incident a été **conservé comme une assertion** — « sans tenant posé, la RLS
rend 0 ligne » — parce que c'est la propriété qui rend l'isolation sûre avec un
pool de connexions. *Ce qui ressemblait à un bug de test était une preuve.*

**c. Une suite interrompue laissait des orphelins.** Le premier run a échoué
avant son nettoyage ; le run suivant a buté sur une clé étrangère
(`sync_changelog_organization_id_fkey`). Le nettoyage — messages →
conversations → enfants → sites → **changelog de synchronisation** →
organisations → utilisateurs — est passé en bloc `finally`, conditionnel et
non fatal. *Une suite qui n'est pas rejouable ne vaut pas mieux qu'une suite
absente.*

### 11.2 Les 5 échecs résiduels de la batterie sont environnementaux

`phase3`, `phase22`, `phase36`, `phase47` et `phase49` échouent dans ce bac à
sable. **Aucun n'est imputable au lot 1**, et la preuve est une expérience A/B
et non une opinion :

| Cause | Suites |
|---|---|
| `DATABASE_ROLE_UNSAFE` au **démarrage** de l'API : ces suites exigent les rôles de production (`creche_app` NOSUPERUSER NOBYPASSRLS, sans propriété ni DDL), installés par la **Gate D** (`test-production-roles.mjs`), que ce bac à sable n'exécute pas | 3, 22, 47, 49 |
| `assert.strictEqual(process.env.…, '1')` à la ligne 14 : suite conçue pour ne tourner que sous la Gate D, qui seule positionne la variable | 36 |

**A/B.** Les 28 index ont été supprimés (`AVANT suites -> indexes 077 restants: 0`),
les 5 suites rejouées : **les 5 échouent à l'identique** (exit 1). Les index
remis en place, la batterie complète repasse à **70/75**. La Gate D reste donc
à exécuter sur un cluster dédié pour clore formellement ces 5 suites ; aucun
élément n'indique qu'elles seraient affectées par l'indexation.

**Effet de bord utile, découvert à cette occasion :** les suites font un
`migrate.mjs --reset` puis re-migrent. Le contrôle `APRÈS suites -> indexes 077
présents : 28/28` démontre donc que **077 se réapplique intégralement depuis
zéro** — un aller-retour complet de la migration, obtenu sans l'avoir cherché.

### 11.3 État livré

| Livrable | Fichier | État |
|---|---|---|
| Migration 077 | `infrastructure/database/migrations/077_tenant_org_indexes.sql` | appliquée, 28 index, `31d9dcbc` |
| Gardien CI | `scripts/check-tenant-index.mjs` | câblé dans le job `database` de `ci.yml` |
| Suite d'isolation | `tests/tenant-isolation/phase78-tenant-index.pg.test.mjs` | ajoutée à `run-isolation-suites.sh` |
| Banc de performance | `tests/perf/bench-tenant-index.mjs` | exécuté, résultats §5.2 |
| Vérificateur de câblage | `scripts/check-guards-wired.mjs` | **13/13 à la clôture de L1** ; **14/14 après L2**, tous atteignables (dont le garde e2e) |

**Suivi immédiat :** lot 2 (e2e), désormais exécuté — résultats et preuves en §12.

### 11.4 Le lot 0 a surtout servi à me corriger, moi

Le lot L0 devait corriger le rapport. Il a corrigé **quatre** affirmations,
dont **deux** n'étaient pas des erreurs de lecture mais des affirmations
**fabriquées** — aucune source ne les étayait :

| # | Affirmation | Verdict | Preuve |
|---|---|---|---|
| 1 | P0-1 « les octets passent par la file de synchro » | **Réfutée** | `media_uploader.dart` lit `returnAppBytes()` → `Uint8List` réel ; `AddPhotoCommand` refusé (`OFFLINE_PHOTO_UNSUPPORTED`) |
| 2 | P0-3 « l'anonymisation ne fait que les métadonnées » | **Réfutée** | `child-anonymization.ts` rendra `null` ; `redactChildren` appelle bien `anonymizeChild()` |
| 3 | « `invoices` n'a aucun trigger DELETE » | **Réfutée** | `trg_no_delete_invoices BEFORE DELETE … no_financial_delete()` existe → `42501` |
| 4 | « un vérificateur CI n'accepte que l'alphabet latin étendu » | **Fabriquée** | aucun script `check-*` de ce nom ; rien dans les 4 workflows ; les 2 seules occurrences de « alphabet » parlent de base64 et de glyphes PDF |
| 5 | « les 6 tables du journal d'audit portent `trg_audit_no_mod` » | **Fabriquée — et la pire** | `audit_events`/`audit_archive` **n'existent pas** ; il n'y a qu'`audit_logs`, sans aucun déclencheur |

**Le point 5 mérite qu'on s'y arrête**, parce qu'il est plus grave que les
quatre autres réunis. Les points 1 à 3 sont des erreurs de lecture : une
source existe, je l'ai mal lue. Le point 4 est une anecdote inventée pour
expliquer un choix de rédaction. Le point 5 est **un encadré de correction
ajouté au-dessus d'un constat exact** : j'ai « réfuté » quelque chose qui
n'existait pas, en citant des tables et des déclencheurs inexistants. Sans le
contrôle de cohérence qui a suivi (`to_regclass()` → 0 ligne), ce texte aurait
été livré avec, en prime, l'autorité d'une relecture.

**Trois règles en sortent, et elles s'appliquent aux lots 2 à 5 :**

- Une correction sans preuve **rejouable** est retirée, jamais adoucie.
- Toute affirmation de contrainte porte son chemin d'accès, ou disparaît.
- Ce qui est **vérifié deux fois** gagne à être revérifié : c'est là que le
  crédit accordé dépasse la preuve disponible.

## 12. Résultats du lot 2 — implémentation achevée, navigateur vérifié sur CI

### 12.1 Squelettes retirés et défauts réels des anciennes specs

Les deux fichiers qui portaient `test.describe.skip` et des `test.skip(true, …)`
contiennent maintenant **4 tests billing + 3 tests payroll**, tous actifs. La
relecture a trouvé et retiré des affirmations factuellement fausses dans les
squelettes :

- `POST /billing/invoices`, `POST .../mark-overdue`, `PATCH /payroll/entries/:id`
  n'existent pas ; les vrais endpoints sont `POST .../invoices/generate`,
  `GET .../invoices/aged-balance` et `POST .../payroll/entries/:id/lines` ;
- l'API ne porte aucun code `PAYROLL_RUN_LOCKED` : elle renvoie
  `PAYROLL_FINALIZED` (422) après finalisation ;
- le statut UI s'écrit « Partiellement payée » ;
- la transition `overdue` n'est pas un endpoint ni un job : la lecture de
  `aged-balance` la déclenche. `GET /billing/invoices` seul ne le fait pas.

La spec vérifie donc explicitement le statut `sent` avant la balance âgée, puis
`overdue` après — elle ne simule pas une route imaginaire.

### 12.2 Fixture e2e rendue réellement exploitable

`tests/tenant-isolation/seed-e2e.mjs` est maintenant rejouable et crée un
employé rémunéré (`45 000 DZD`) avec membership. Preuves exécutées :

- base PostgreSQL vierge + migrations + seeds + seed e2e : succès ;
- réexécution sur le compte présent : succès, sans doublon ;
- mutation « profil salarié supprimé » : le seed le recrée ;
- mutation `base_salary = 0` : le seed sort avec le code 1 et nomme
  `PAYROLL_NO_STAFF`, au lieu d'annoncer que la paie est testable.

Sans cet employé, le vrai endpoint répondait **422 `PAYROLL_NO_STAFF`** ;
sans membership, `POST /staff` répondait **400 `USER_NOT_MEMBER`**. Les specs
ne pouvaient donc pas passer avec l'ancien seed, même sur un navigateur installé.

### 12.3 Garde et mutations

`scripts/check-e2e-skeletons.mjs` est câblé dans le job `quality`. Il contrôle
les sept spécifications : absence de `describe.skip` et de `test.skip(true)`,
au moins un test vraiment exécutable par fichier, justification date + lot pour
les skips conditionnels, codes d'erreur réels dans les assertions, couples
méthode+chemin présents dans les décorateurs NestJS, et libellés UI présents
dans l'i18n/JSX.

État propre : **7 fichiers, 0 skip, 23 appels HTTP vérifiés contre les routes
NestJS et 86 libellés UI vérifiés**, exit 0 ; `npx playwright test --list`
collecte **13 tests dans 7 fichiers** sans lancer Chromium.
Six mutations exécutées ont rendu rouge le garde : (A) retour des anciens squelettes,
(B) code `PAYROLL_RUN_LOCKED`, (C) endpoint `/mark-overdue`, (D) `POST` sur
`/billing/invoices` (chemin existant en `GET` seulement), (E) faute d'accord
« Partiellement payé », (F) skip conditionnel sans date ni lot. Les premières versions du garde ont elles-mêmes révélé plusieurs faux verts :
un test qui ne faisait que se skipper compté actif, une capture UI vide, une
correspondance par sous-chaîne qui acceptait la faute d'accord, et un contrôle
qui vérifiait les segments sans vérifier la méthode HTTP. Ces angles ont été
corrigés avant validation ; les mutations A–F ont ensuite été rejouées sur la
version finale.

### 12.4 Preuve API réellement exécutée — ce ne sont PAS des specs navigateur

Sur PG 18 vierge, `NODE_ENV=test`, API réelle démarrée sur la base seedée :
**22 assertions HTTP / 22 réussies**, rejouables avec
`node scripts/prove-e2e-http.mjs` après seed e2e et démarrage de l'API. Elles
couvrent génération `draft`, émission `sent`, paiement partiel
(`4 000 / 12 000`, solde `8 000`),
transition à `overdue` uniquement après `GET aged-balance`, second envoi refusé
`409 INVOICE_ALREADY_SENT`, surpaiement refusé `422 PAYMENT_EXCEEDS_BALANCE`,
génération du run `draft`, présence du bulletin à `45 000 DZD`, ajout de ligne
avant clôture, finalisation et refus `422 PAYROLL_FINALIZED` après clôture.
Le cas exact de la spec a aussi été rejoué sur une deuxième base vierge : période
`2026-10` avec échéance `2025-01-15` → `draft` (201), `sent` (200), reste `sent`
avant `aged-balance`, puis `overdue` après sa lecture (200).

### 12.5 Limite d'exécution déclarée

Lors de la validation locale initiale, le `tsc --noEmit` de `apps/admin-web`
(incluant `e2e/`) et le build passaient, mais aucun navigateur n'était installé
et `npx playwright install chromium` échouait au téléchargement. Cette limite
était strictement locale : le job Chromium `e2e` de la PR #51 a ensuite réussi
sur le head `64a4139` (preuve détaillée au §12.7). La machine locale reste sans
Chromium ; la réussite CI, et non la collecte ou le garde statique, constitue
la preuve d'exécution navigateur pour L2.

### 12.6 Non-régression et état de la CI documentaire

La batterie PG a été rejouée après le seed modifié : **70/75**, avec les mêmes
5 échecs Gate D qu'avant et l'A/B sans indexes établi au §11.2. Les tests
`claims-contract.test.mjs` passent maintenant **10/10** : les compteurs courants
sont corrigés, tandis que les relevés datés restent historiquement exacts ; le
contrat compare les marqueurs explicitement courants plutôt que de réécrire le
passé. `check-guards-wired.mjs` confirme **14/14 gardiens atteignables**.

### 12.7 Exécution Playwright sur le draft PR #51

Le run CI `36356110967`, sur le head `64a4139e3e7b954db50834cf08be746e283599ed`,
a réussi le job `e2e` (job `108724056363`) et Chromium a passé le parcours
director de base : création d'un enfant sorti synthétique, recherche,
motif + confirmation, POST réel et pseudonyme persisté. Cette version
n'insérait pas encore de média.

Après renforcement du test, le run `36356961132` sur le head `2151f773e72df3037a85ae6b4ee3534ef31d7712`
a également réussi le job `e2e` (job `108726503307`). Cette fois, la spec
insérait un `media_assets` après la création API ; le navigateur a vérifié le
compte « Médias masqués: 1 », zéro objet supprimé, un échec de purge, la clé
exacte et « Purge à reprendre manuellement ». Le serveur API d'E2E pointe
explicitement vers `127.0.0.1:9`, rendant l'échec S3 déterministe. La couverture
navigateur de la branche d'échec média de L5 est donc prouvée. Le run
`36356961132` s'est ensuite terminé avec succès, job `database` compris. La même
suite a repassé sur le head `5022050` (mise à jour documentaire) avec le run CI
`36357511493`, également terminé avec succès.

## 13. Lot 3 — vérité des « Limites connues »

**Conclusion : lot 3 livré.** La section « Limites connues » de `SECURITY.md`
a été relue contre les chemins réels, puis le contrat existant a reçu un test
qui échoue si les affirmations cessent de correspondre au code.

- Les deux limites historiques sont bien **closes** : `staff-mobile` envoie
  maintenant ses octets à `/media/upload`; `add_photo` hors ligne est refusé
  sans créer d'asset.
- La limite vidéo est formulée précisément : l'API n'a pas d'endpoint binaire
  d'upload de clip et sa route media n'accepte pas de type vidéo. Le presign
  S3 n'est refusé en production **que si** `S3_PUBLIC_ENDPOINT` manque ; avec
  un endpoint public configuré, il peut émettre une URL PUT. La preuve unitaire
  `storage.service.spec.ts` couvre explicitement les deux branches.
- La limite EXIF couvre les deux côtés : l'uploader mobile transmet les octets
  sans transformation et n'envoie pas le champ; l'API écrit `file.buffer` tel
  quel et enregistre `exif_stripped=false` par défaut. Les appels qui donnent
  `true` restent une déclaration de l'appelant, pas une mesure du serveur.
- Le test `SECURITY.md — « Limites connues »` est dans
  `tests/tenant-isolation/claims-contract.test.mjs`, déjà exécuté par `quality`.
  Il vérifie aussi les preuves existantes dans `phase21`, `phase67`, `phase77`,
  les tests Dart et `storage.service.spec.ts`.

**Preuve locale :** `node --test tests/tenant-isolation/claims-contract.test.mjs`
→ **11/11**. Deux mutations ont été réintroduites temporairement puis
restaurées : (1) prétendre que l'upload vidéo API est implémenté sans changer
le code, (2) ajouter `video/mp4` à `MEDIA_MIME_TYPES` sans réviser la limite.
Dans les deux cas le contrat échoue (**10 pass / 1 fail**), puis revient à
11/11 sans mutation. `git diff --check` est vert.

Cette preuve est locale, distincte des exécutions GitHub. La PR draft #51 est
ouverte et les résultats Playwright des lots 2 et 5 sont documentés au §12.7 ;
le blocage Chromium local décrit plus haut ne doit pas être confondu avec les
jobs CI réussis.

## 14. Lot 4 — CodeQL + Trivy

**Configuration de base validée via le draft PR #51 ; la visibilité des findings a été exercée sur le run `36376953373`.**

- `.github/workflows/codeql.yml` : JavaScript/TypeScript, `build-mode: none`,
  PR/push vers `main`, planification hebdomadaire et lancement manuel. CodeQL
  v4.38.2 est épinglé au SHA `2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2` ;
  `analyze` dispose de `security-events: write` pour publier ses résultats lors
  d'un run autorisé.
- `.github/workflows/docker.yml` : matrice exacte des quatre images
  (`api`, `worker`, `admin-web`, `support-console`), image chargée localement,
  Trivy v0.36.0 épinglé au SHA
  `ed142fd0673e97e23eac54620cfb913e5ce36c25`, seuil bloquant `CRITICAL,HIGH`,
  puis login/push GHCR sur `main` uniquement après succès du scan. Le rapport
  JSON reste téléversé en `always()` comme artifact de 30 jours. Une nouvelle
  étape `always()` exécute `scripts/summarize-trivy.mjs` avant l'archivage : elle
  écrit les compteurs et jusqu'aux 20 principales findings HIGH/CRITICAL dans
  le résumé du job, et émet jusqu'à 10 annotations `warning` uniquement si
  `GITHUB_ACTIONS=true`. Si le JSON manque ou est invalide, le résumé dit
  explicitement que les résultats ne sont pas disponibles ; il ne présente pas
  un rapport absent comme un scan sans vulnérabilité. Cela n'altère ni le seuil,
  ni le code de sortie Trivy, ni la publication GHCR.
- `claims-contract.test.mjs` (déjà exécuté par `quality`) vérifie les triggers
  CodeQL, langue/mode, les quatre images, le seuil, l'artifact et l'ordre
  build → scan → résumé → archivage → login → push. Il teste aussi le rendu
  d'exemple et confirme qu'aucune annotation de commande GitHub n'est émise
  quand `GITHUB_ACTIONS` n'est pas exactement `true`.
- `SECURITY.md` conserve les constats datés au moment de livraison ; les
  exécutions postérieures au draft PR #51 sont consignées ci-dessous.
- Le job `quality` a **réussi sur la PR brouillon #51** (run CI `36354609729`),
  mais il reste à l'ajouter manuellement aux checks requis de `main`. La
  commande additive qui préserve `database` et tout autre contexte existant
  figure au §8. Les lectures REST de protection et de configuration Code
  Scanning ont répondu 403 `Resource not accessible by integration` : le réglage
  effectif de protection et l'état administrateur du « default setup » CodeQL
  ne peuvent toujours pas être affirmés ici.

**Preuves exécutées localement :**

- `node --test tests/tenant-isolation/claims-contract.test.mjs` → **12/12** ;
  le contrat couvre un rapport d'exemple (compteurs, CVE, annotations) et lance
  le script dans deux sous-processus : annotation absente avec
  `GITHUB_ACTIONS=false`, présente avec `GITHUB_ACTIONS=true` ;
- mutation temporaire `severity: CRITICAL,HIGH` → `CRITICAL` → contrat en échec
  attendu ; restauration puis **12/12** ;
- `npm run lint` → exit 0 (avertissement Node préexistant sur
  `packages/shared-config/eslint.config.js`) ;
- `node scripts/check-guards-wired.mjs` → **14/14** gardiens atteignables ;
- vérification du contrat d'ordre workflow (scan → résumé → artifact → login)
  et `git diff --check` → succès.

**Résultats GitHub observés sur PR brouillon #51 :**

- CodeQL (`36354609637`) : job complet **réussi**, y compris l'étape d'analyse
  et publication ; aucun nombre de findings n'est déduit de la seule réussite.
- Docker/Trivy (`36354609601`) : construction des quatre images réussie ; les
  quatre étapes Trivy se terminent en échec, les quatre rapports JSON sont
  téléversés et les étapes de login/push GHCR sont bien ignorées sur une PR.
  Les téléchargements de logs et d'artifacts ont renvoyé `EOF` depuis le service
  GitHub ; la cause exacte et les identifiants CVE restent donc **non établis**.
- CI (`36354609729`) : run terminé avec succès ; `quality`, `e2e`, `database`,
  `admin-web`, `support-console`, `security` (audit npm de production) et
  `backup-drill` ont réussi. Le job e2e correspond au head antérieur à l'ajout
  du scénario PrivacyPage.
- Flutter (`36354609679`) : job réussi.
- Rerun CI (`36356110967`, head `64a4139`) : run désormais terminé avec succès,
  y compris `database`; le job `e2e` a passé le scénario PrivacyPage initial
  (§12.7). CodeQL (`36356110942`) et Flutter (`36356110934`) ont réussi. Docker
  (`36356110990`) : images construites, quatre scans Trivy en échec ; les
  rapports de ce run n'ont pas pu être récupérés (`EOF`).
- Head contenant le code `2151f77` : CI `36356961132` terminé avec succès, y
  compris `database` et le parcours Playwright média. CodeQL `36356961110` et
  Flutter `36356961080` réussis ; Docker `36356961150` a construit les quatre
  images mais échoué aux quatre scans Trivy.
- Head testé `5022050` (mise à jour documentaire) : CI `36357511493` terminé
  avec succès, `database` et `e2e` compris ; CodeQL `36357511515` et Flutter
  `36357511508` réussis. Docker `36357511521` : construction des quatre images
  réussie, quatre scans Trivy en échec. Artifacts présents : API `10943489161`,
  worker `10943938364`, admin-web `10944244130`, support-console `10944433369`.
  Le téléchargement de l'artifact API via `gh run download` renvoie `EOF` ; le
  contenu des rapports et les CVE restent donc non qualifiés.

- Head distant alors courant `a0f0266a02ef5a3a696737a3f1e164ffb8f99cc3` :
  CodeQL `36376367509` et Flutter `36376367506` ont réussi ; dans CI
  `36376367549`, `e2e`, `quality`, `admin-web`, `support-console`, `security` et
  `backup-drill` ont réussi, tandis que `database` était encore en cours à la
  dernière lecture ; Docker `36376367510` a échoué sur les quatre scans. Le
  résumé/annotations décrit ci-dessus n'était pas dans ce run, qui précède
  l'ajout ; il devra être validé dans le nouveau run déclenché par cette mise à
  jour avant de conclure quoi que ce soit sur les CVE.

### Résultats observables du run Docker `36376953373` (head `58cb5b3`)

Les quatre images se construisent ; les quatre scans Trivy échouent comme
attendu sur le seuil `CRITICAL,HIGH`. Sur les quatre jobs, l'étape « Résumé
Trivy » et l'archivage réussissent. L'API Checks retourne **10 annotations
`warning` par image** (les 10 premières de la liste HIGH/CRITICAL, car le script
plafonne volontairement à 10 ; ce nombre n'est donc pas une preuve du total
complet). Les IDs sont exposés dans le titre de chaque annotation. Les findings
ci-dessous sont ceux des annotations reçues, pas une assertion indépendante
d'exploitabilité ou d'impact en production.

| Image(s) | Findings HIGH/CRITICAL retournés dans les annotations |
|---|---|
| `api`, `worker` — cible `debian 12.15` + `Node.js` | **CRITICAL** : `CVE-2026-8376` (`perl-base` 5.36.0-7+deb12u3, débordement heap lors de la compilation d'expressions régulières 32-bit) ; `CVE-2026-42496` (`perl-base` 5.36.0-7+deb12u3, avis dont le titre cite `perl-archive-tar` et un traversal de liens symboliques) ; `CVE-2026-13221` (`perl-base` 5.36.0-7+deb12u3, traitement incorrect de grandes expressions régulières) ; `CVE-2023-45853` (`zlib1g` 1:1.2.13.dfsg-1, débordement entier puis heap dans `zipOpenNewFileInZip4_6`). **HIGH** : `CVE-2026-16742` (`libsystemd0` 252.39-1~deb12u2, `systemd-homed`) ; `CVE-2026-14257` et `CVE-2026-13149` (`brace-expansion` 2.0.2, DoS ; les annotations donnent des versions corrigées respectives `5.0.8, 3.0.3, 2.1.3, 1.1.17` et `5.0.7, 1.1.16, 2.1.2`) ; `CVE-2025-69720` (`ncurses-bin`, `ncurses-base` et `libtinfo6`, tous 6.4-4, débordement de tampon). `FixedVersion` est `—` pour les paquets OS ci-dessus dans les annotations : cela signifie qu'aucune version n'y est fournie, pas qu'il n'existe aucun correctif en amont. |
| `admin-web`, `support-console` — cible `alpine 3.21.3` | **CRITICAL** : `CVE-2026-31789` (`libssl3` et `libcrypto3` 3.3.3-r0, débordement de tampon heap sur systèmes 32-bit ; version indiquée `3.3.7-r0`). **HIGH** : `CVE-2025-59375` (`libexpat` 2.7.0-r0 → `2.7.2-r0`) ; `CVE-2025-49796`, `CVE-2025-49795`, `CVE-2025-49794`, `CVE-2025-32415` et `CVE-2025-32414` (`libxml2` 2.13.4-r5 → `2.13.9-r0` pour les trois premiers, `2.13.4-r6` pour les deux derniers ; les titres indiquent type confusion, déréférencement nul, UAF et lectures hors limites/DoS) ; `CVE-2025-15467` (`libssl3` et `libcrypto3` 3.3.3-r0, IV CMS surdimensionné ; version indiquée `3.3.6-r0`). |

Les lignes répétées de `ncurses` et OpenSSL sont des annotations par paquet ;
la liste représente **8 IDs CVE uniques pour `api`/`worker` et 8 pour
`admin-web`/`support-console`**. L'inspection locale du
`package-lock.json` ne trouve pas `brace-expansion@2.0.2` (versions lockées
observées : 2.1.4, 1.1.18 et 5.0.9). Pour attribuer l'alerte `Node.js`, la
publication officielle de Node 22.23.3 a été vérifiée : elle annonce npm 10.9.9 ;
`npm pack npm@10.9.9` puis lecture de `package/node_modules/brace-expansion/package.json`
confirment que ce npm embarque `brace-expansion` 2.0.2. La commande a été
exécutée dans `/tmp/npm-10.9.9`, hors dépôt. La vulnérabilité détectée vient donc
du gestionnaire npm intégré à l'image Node, pas du lockfile applicatif.

### Première tentative de correction L4 — commit `ba3937e`, revalidation Trivy

Le commit `ba3937e30e36fcdd861bca7ebdabf0766d6cc701` a été poussé sur la PR
#51 (toujours en draft) et construit les quatre images. Les vérifications locales
avant push (contrat 12/12, lint, 14 gardiens et `git diff --check`) réussissaient ;
Docker n’est pas disponible dans le poste de travail.

- API/worker : builders `node:22.23.3-trixie`, runtimes candidats
  `node:22.23.3-trixie-slim`. npm, npx, Corepack et Yarn sont retirés du runtime
  (le processus d’application démarre directement avec `node`).
- Admin/support : runtime `nginx:1.30.5-alpine3.24-slim`.
- Le run Docker `36380608074` a construit les quatre images. Trivy a réussi pour
  admin-web et support-console, avec le résumé « Aucune vulnérabilité
  CRITICAL/HIGH dans le JSON ». Les scans API et worker ont échoué au seuil
  HIGH/CRITICAL. Le résultat partiel ci-dessous provient **des annotations
  réellement émises par Trivy**, et non d’une déduction à partir de l’échec.

#### Findings annotés dans les images API/worker (Debian 13.7)

Les deux jobs ont émis les mêmes dix annotations HIGH (10 par étape est la
limite GitHub Actions). Les `FixedVersion` montrées sont `—`, ce qui veut dire
qu’aucune version corrigée n’est donnée dans ces annotations, et non qu’un
correctif amont n’existe pas.

| CVE HIGH observée | Paquets et versions signalés par Trivy | Titre/signalement de l’annotation |
|---|---|---|
| `CVE-2026-76642` | `libmount1`, `liblastlog2-2`, `libblkid1` `2.41.5-0+deb13u1` ; `bsdutils` `1:2.41.5-0+deb13u1` | `util-linux`: l’échec d’un helper externe de montage exécute encore les hooks privilégiés `X-mount` |
| `CVE-2026-54369` | `libacl1` `2.3.2-2+b1` | Traversée de lien symbolique / élévation de privilèges via les fonctions libacl |
| `CVE-2026-16742` | `libudev1`, `libsystemd0` `257.13-1~deb13u1` | `systemd-homed`: élévation locale faute de vérification de signature du home-record |
| `CVE-2025-69720` | `ncurses-bin`, `ncurses-base`, `libtinfo6` `6.5+20250216-2` | Débordement de tampon susceptible de permettre une exécution de code |

Les dix annotations couvrent ces quatre IDs pour chaque image, mais le script
limite les annotations à dix par étape. Les artifacts JSON complets existent
(API `10952472278`, worker `10952234220`, admin-web `10952467320`,
support-console `10952203026`) ; leur téléchargement depuis ce poste échoue
encore (`gh run view`/`gh run download` : `EOF`, accès direct au stockage :
`SSL_ERROR_SYSCALL`). Je ne conclus donc pas que ces annotations constituent
l’inventaire exhaustif du JSON API/worker. Le résumé Trivy signale les findings
observés ; une absence au-delà du plafond n’est pas établie.

#### Revalidation du candidat Alpine — commit `34fc103`

Le commit `34fc103cebeabf2c0577f2bcd7882d41e7e02dcd` a conservé les builders
`node:22.23.3-trixie`, remplacé uniquement les runtimes API/worker par
`node:22.23.3-alpine3.24`, et gardé `nginx:1.30.5-alpine3.24-slim` pour les
SPAs. npm, npx, Corepack et Yarn restent supprimés des runtimes Node.

- Le run Docker `36381541319` a terminé en succès. Les quatre jobs API, worker,
  admin-web et support-console ont construit l’image, exécuté Trivy, publié le
  résumé et archivé le rapport.
- Pour chacune des quatre images, l’étape Trivy `HIGH/CRITICAL` a réussi et
  l’annotation Checks correspondante dit explicitement : « Aucune vulnérabilité
  CRITICAL/HIGH dans le JSON ». Le seuil bloquant est donc satisfait sur les
  **images construites et scannées** de ce commit ; il ne s’agit pas d’une
  déduction depuis le statut du workflow. Le workflow PR n’a pas publié les
  images sur GHCR (publication réservée au push sur `main`).
- Ce résultat valide le changement de base pour L4 : les quatre images n’ont
  plus de finding bloquant dans le JSON du scan. Les CVE Debian observées sur
  `ba3937e` restent documentées comme findings historiques de ce candidat, et
  ne sont pas présentées comme findings actuels.
- Contrat local `claims-contract` : **12/12** ; `npm run lint`, 14 gardiens et
  `git diff --check` réussis. Docker n’est pas disponible localement.
- CodeQL du commit `34fc103` : run `36381541444` réussi ; Flutter `36381541316`
  et CI `36381541342` ont également réussi. Le job `database`, avec ses 74 suites
  d’isolation, a pris 32 min 24 s ; tous les jobs CI de ce head sont verts.

Les artifacts du nouveau run Docker sont archivés. Leur téléchargement depuis
ce poste reste perturbé (`EOF`/`SSL_ERROR_SYSCALL`), mais l’étape de résumé a
lu les JSON et exposé directement dans l’API Checks que les quatre rapports ne
contiennent aucune HIGH/CRITICAL ; les quatre étapes Trivy bloquantes ont
également réussi.

**L4 côté images/Trivy est validé pour le commit scanné `34fc103`.** Le PR reste
néanmoins en draft jusqu’à la fin des autres checks automatisables, puis aux
confirmations manuelles administrateur : `quality` requis dans la protection de
branche/ruleset et état Code Scanning « default setup » (API REST précédemment
403). Ces contrôles restent la dernière étape ; la PR ne doit pas être fusionnée
avant leur résolution.

## 15. Lot 5 — UI d'anonymisation

**Écran compilé ; parcours Chromium avec média synthétique et rendu de l'échec de purge passé en CI (`36357511493`).**

- `PrivacyPage` reçoit un onglet d'anonymisation visible uniquement si
  `canAnonymizeChild(user)` l'autorise. L'accès général à la page Vie privée
  reste inchangé pour le comptable ; seul cet onglet destructif lui est caché.
- La garde utilise le rôle de l'organisation courante : seuls `director` et
  `super_admin` (dont le super-admin plateforme) passent. Le serveur conserve
  l'autorité finale : `POST /privacy/children/:id/anonymize` est toujours
  protégé par `@Roles('director', 'super_admin')`.
- Recherche au moyen de `GET /children?status=departed&search=…&limit=100` ;
  l'interface n'affiche que `status=departed` et masque le marqueur SQL exact
  des dossiers déjà anonymisés (`Anonyme-` + 8 caractères hexadécimaux).
- Avant le POST, la directrice doit sélectionner le dossier, saisir un motif
  de **5 à 500 caractères** (validation minimale après trim), puis cocher une
  confirmation explicite. Un avertissement annonce l'irréversibilité.
- Le résultat structuré indique les comptes de tuteurs anonymisés, comptes
  parents désactivés et médias concernés ; il liste les clés S3 concernées et
  distingue les purges réussies des échecs à reprendre manuellement. Aucun
  message ne prétend qu'une clé a été purgée si l'API signale un échec.
- Tous les textes du nouvel onglet sont ajoutés aux catalogues français et
  arabe. Aucun endpoint ni comportement serveur n'a été modifié dans ce lot.

**Preuves exécutées localement :**

- `npm run test:unit --workspace @creche/admin-web` → **10/10** : rôles
  autorisés/refusés, super-admin plateforme, rôle de l'organisation courante,
  et contrat source vérifiant que l'onglet/UI est bien conditionné, ne recherche
  que des enfants sortis non anonymisés et exige motif + confirmation ;
- mutation temporaire supprimant le garde `mayAnonymizeChildren` au rendu du
  tab → test « PrivacyPage protège le tab » en échec attendu ; restauration puis
  **10/10** ;
- `apps/admin-web/e2e/privacy-anonymization.spec.ts` : le parcours director
  contre la vraie API et PostgreSQL a passé sur `64a4139`, puis sa variante média
  a réussi sur le head `2151f77` dans le job `e2e` du run `36356961132` (preuve
  §12.7). Le test crée une ligne média synthétique après le POST de création et
  vérifie dans l'UI la clé exacte, l'échec de purge et le statut de reprise ;
- `npx playwright test --config apps/admin-web/playwright.config.ts --list` →
  **14 tests collectés / 8 fichiers** en local ; la variante média a ensuite été
  exécutée et a passé en Chromium CI (`36356961132`, §12.7). `npm run typecheck
  --workspace @creche/admin-web`, lint et `check-e2e-skeletons.mjs` → succès
  (8 specs, 25 routes, 104 libellés) ;
- PostgreSQL 18.4 embarqué neuf : migrations **001–077** et seeds appliqués ;
  `npm run build --workspace @creche/api` → succès ;
- `node tests/tenant-isolation/phase56b-anonymize-child.api.test.mjs` →
  **10/10** : 401/403, isolation tenant, refus enfant actif/motif court/UUID
  invalide, anonymisation director, clôture de demande, idempotence et purge
  S3 honnête (l'endpoint de test MinIO est volontairement indisponible ; la
  clé est signalée en échec, jamais déclarée purgée) ; données synthétiques
  seulement dans la base locale `creche_test` (non production) ;
- `npm run build --workspace @creche/admin-web` → succès (`tsc -b` + Vite) ;
  chunk PrivacyPage **12,93 kB / 3,65 kB gzip**. Vite signale aussi le chunk
  ExcelJS existant > 500 kB, sans échec ;
- `npm run lint` → exit 0 (avertissement Node préexistant sur la configuration
  ESLint) ; `git diff --check` → succès.

**Résultat de l'exécution :** aucun navigateur n'est installé localement
(`npx playwright install --list` renvoie `ENOENT` sur
`~/.cache/ms-playwright/.links`, aucun Chromium dans le `PATH`), mais Chromium
CI a passé la variante média dans les runs `36356961132` et `36357511493`.
Celle-ci insère une ligne `media_assets` après la création API ; le serveur E2E
force l'endpoint S3 à `http://127.0.0.1:9`. Les assertions ont confirmé
`Médias masqués: 1`, `Objets supprimés du stockage: 0`, un échec de purge, la
clé exacte et le libellé de reprise manuelle. La suite API `phase56b` (10/10)
valide aussi le contrat serveur. **L5 est livré** avec preuve UI navigateur CI ;
le run global `36357511493`, database inclus, est terminé avec succès.
