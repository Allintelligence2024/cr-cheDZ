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
| **Navigateur (Chromium Playwright)** | ❌ | **e2e navigateur : BLOQUÉ** (téléchargement refusé, 2 hôtes testés) |
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
| **L2** | **e2e** : compléter les 2 specs + garde anti-squelette | D2, D3 | 1–2 j | 13/13 collectés sans skip ; gardien CI, seed paie et preuve API 16/16 ; exécution Chromium encore attendue | 🟡 implémenté, navigateur bloqué |
| **L3** | **Vérité documentaire** : « limites connues » vérifiées contre le code | D4 | 0,5 j | gardien qui échoue si une limite citée n'existe plus | ⏳ |
| **L4** | **Durcir la CI** : CodeQL + scan d'images + job `quality` requis | D6, P0-4 | 1 j | workflows ajoutés ; demande de réglage dépôt documentée | ⏳ |
| **L5** | **UI d'anonymisation** dans `admin-web` (écran directeur) | D7 | 2 j | écran + test d'accès par rôle | ⏳ |

**Ordre recommandé** : L0 ✅ → L1 ✅ → L2 🟡 (implémenté, navigateur à exécuter) → L3 (documentation) → L4 (CI) → L5 (UI).

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

- Workflow **CodeQL** (TypeScript + JavaScript), hebdomadaire + PR.
- Scan d'images de conteneurs (Trivy) sur les 4 images GHCR.
- `quality` en check requis : **réglage dépôt**, hors de portée de l'intégration
  (403 observé) → consigné comme action manuelle avec la commande exacte.

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

## 12. Résultats du lot 2 — implémentation achevée, navigateur en attente

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

Le `tsc --noEmit` de `apps/admin-web` inclut maintenant `e2e/` et passe ; le
build `@creche/admin-web` passe. En revanche, **Playwright/Chromium n'a pas
été exécuté** : aucun navigateur n'était installé et `npx playwright install
chromium` a échoué au téléchargement. Ne pas présenter les 7 specs comme
vertes ; le passage navigateur sur la cible équipée reste à obtenir. Le garde
statique, le seed, les assertions API et le typecheck sont des preuves
complémentaires, pas un substitut au navigateur.

### 12.6 Non-régression et état de la CI documentaire

La batterie PG a été rejouée après le seed modifié : **70/75**, avec les mêmes
5 échecs Gate D qu'avant et l'A/B sans indexes établi au §11.2. Les tests
`claims-contract.test.mjs` passent maintenant **10/10** : les compteurs courants
sont corrigés, tandis que les relevés datés restent historiquement exacts ; le
contrat compare les marqueurs explicitement courants plutôt que de réécrire le
passé. `check-guards-wired.mjs` confirme **14/14 gardiens atteignables**.
