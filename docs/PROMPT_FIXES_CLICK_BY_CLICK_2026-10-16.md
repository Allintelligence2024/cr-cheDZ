# Exécution clic par clic — après la fusion de la PR #60

**Date** : 2026-10-16 · **Base** : `main` @ `7e8862b` (fusion de `arena/4efe1e90-cr-chedz`, 17 commits, 14/14 checks au vert dont le job `database` = Gate D strict, 34 min 35 s)
**À qui s'adresse ce document** : §1 à l'humain qui clique dans GitHub ; §2 à un agent (prompt autonome à copier-coller) ; §3–§5 aux tâches qui exigent une VM, Docker ou Flutter.

> Ce document ne remplace pas `docs/PLAN_FIX_GITHUB_ISSUES_SECURITY_QUALITY.md` (l'état vérifié
> et le relevé TZ, §9.1) ni `docs/HANDOFF-OPEN-ISSUES-2026-10-14.md` (règles du dépôt).
> Il ne décrit que **ce qui reste**, dans l'ordre où le faire.

---

## 1. Dans GitHub — clic par clic (10 min, sans risque)

### 1.1 Fermer les 5 issues périmées
Pour chacune : `Issues` → ouvrir l'issue → zone « Leave a comment » → coller le texte → bouton
**Close issue** (à droite de « Comment »). Le jeton de l'agent renvoie 403 en écriture : c'est une
action humaine.

| Issue | Coller ce commentaire |
|---|---|
| #55 | `Résolu sur main : npm audit --omit=dev → 0 vulnérabilité ; multer 2.4.0, nodemailer 10.x. Revérifié le 2026-10-16 (PR #60, job security vert).` |
| #35 | `Même cause que #55, même résolution. Audit prod 0 vulnérabilité sur racine/api/worker.` |
| #17 | `Périmé : npm run lint (--max-warnings=0) → 0 warning sur main. Le seul avertissement restant (MODULE_TYPELESS_PACKAGE_JSON) a été supprimé par "type":"module" dans packages/shared-config.` |
| #15 | `Résolu : intl ^0.20.3 dans les trois pubspec ; workflow flutter vert sur main.` |
| #16 | `Résolu : app_database.g.dart committé et régénéré ; workflow flutter vert sur main.` |

### 1.2 Corriger les critères de #14 (drill de restauration)
`Issues` → #14 → `...` → **Edit**. Deux remplacements dans le corps :
- « migrations 001–049 » → **`migrations 001–102 (101 fichiers)`** ;
- supprimer la référence à « 61/61 suites » → **`77/77 suites d'isolation + 59/59 contrôles du gate D`**.
Puis **Comment** : `Critères mis à jour le 2026-10-16 ; le drill reste à jouer sur VM vierge (voir docs/PROMPT_FIXES_CLICK_BY_CLICK_2026-10-16.md §3).`

### 1.3 Rattacher les issues de phase à la preuve (facultatif, 2 min)
Sur #38, #39, #40, #41, #42 — un commentaire de pointeur suffit :
`Suite de la session 2026-10-15/16 : voir docs/PLAN_FIX_GITHUB_ISSUES_SECURITY_QUALITY.md (fondu dans main via PR #60). Ce qui reste d'agent est listé dans docs/PROMPT_FIXES_CLICK_BY_CLICK_2026-10-16.md §2.`

### 1.4 Dependabot (l'agent n'a aucun levier ici)
`Settings` (du dépôt) → `Code security and analysis` → **Enable** sur *Dependabot alerts*, puis sur
*Dependabot security updates*. Le fichier `.github/dependabot.yml` est déjà versionné : sans ces deux
interrupteurs, les alertes ne sont jamais publiées et le job `security-audit` reste le seul signal.

### 1.5 Protecteurs de branche (recommandé, 3 min)
`Settings` → `Branches` → **Add branch protection rule** → `main` → cocher
*Require a pull request before merging* + *Require status checks to pass* (sélectionner
`database`, `quality`, `security`, `flutter-check`, `backup-drill`).
**Ne pas** cocher « Delete branch automatically on merge » : la branche de session Arena
(`arena/…`) doit survivre à la fusion.

### 1.6 Les six décisions à transmettre au client (à ne pas deviner)
À copier dans le canal client tel quel. Chacune bloque du code, pas de la documentation.

| # | Question au client | Bloque | Où consigner la réponse |
|---|---|---|---|
| D1 | Numérotation des factures : séquentiel légal (`FAC-AAAA-MM-NNNN`) ou référence publique opaque ? | #41, `next_org_sequence` | **l'ADR existe déjà** : `docs/adr/ADR-016-next-org-sequence-numbering.md`, statut **Proposé** — la réponse du client (et l'avis juridique) fait passer le statut à Accepté/Rejeté, elle ne se rédige pas ailleurs |
| D2 | Paie : conserve-t-on le calcul **sans prorata** (décision actuelle) ou non ? | #39 E5, #42 | plan H3 l.762 + ADR |
| D3 | Fournisseur SMTP + Twilio réels, et qui détient les secrets ? | #39 E2, invitations #41 | secrets de dépôt + `.env.prod` |
| D4 | La revue de sécurité du stockage et le pin de l'image MinIO sont-ils validés tels quels ? | #42 (qualification prod) | `docs/PHASE_H2I_STORAGE_SELECTION_RUNBOOK.md` + `SECURITY.md` |
| D5 | Keystore Android + qualification release : qui le détient, quelle date ? | #40 | runbook release |
| D6 | **Autorisation de merger** les PR de remédiation | tout | accord écrit (celui du 2026-10-16 a couvert #60) |
| D7 | Format de fil des colonnes `date` en HTTP : garder `AAAA-MM-JJT00:00:00.000Z` (actuel, déterministe depuis ce jour) ou passer à `YYYY-MM-DD` ? | contrat mobile + admin-web | ADR + `check:sync-contract` des deux côtés — **ne rien changer avant la réponse** |

---

## 2. Bloc à coller dans l'agent (prompt autonome, indépendant de cette session)

````text
TU ES un agent d'ingénierie sur le dépôt GitHub Allintelligence2024/cr-cheDZ (SaaS de crèches,
monorepo npm : apps/api NestJS+Jest, apps/worker, apps/admin-web React+Vite, apps/support-console,
apps/{parent,staff,director}-mobile Flutter, PostgreSQL 18 + RLS).
BASE DE TRAVAIL : main @ 7e8862b (ou plus récent). Lis OBLIGATOIREMENT avant de coder :
  docs/HANDOFF-OPEN-ISSUES-2026-10-14.md   (règles du dépôt, ordre d'exécution)
  docs/PLAN_FIX_GITHUB_ISSUES_SECURITY_QUALITY.md  (état vérifié + §9.1 relevé fuseaux)
  docs/PROMPT_FIXES_CLICK_BY_CLICK_2026-10-16.md    (ce fichier : la liste qui suit en détail)

INTERDICTIONS NON NÉGOCIABLES (elles ont une raison, écrite dans les docs ci-dessus) :
- Ne JAMAIS fusionner/merger une PR toi-même. Ouvre une PR, attends l'autorisation (décision D6).
- Migrations 001→102 IMMUABLES. Tout correctif de schéma = nouveau fichier à partir de 103.
- Ne JAMAIS lancer `npm audit fix` (les dépendances sont épinglées par `overrides` dans package.json).
- Ne JAMAIS affaiblir un test, un garde ou un contrat pour passer au vert. Si un test gêne, le test
  est soit une découverte à réparer dans le code, soit une preuve à documenter — jamais à éditer.
- Ne PAS toucher au fuseau de l'hôte ni retirer `ENV TZ=UTC` des Dockerfiles api/worker.
- Ne PAS changer le FORMAT DE FIL des colonnes `date` (AAAA-MM-JJT00:00:00.000Z) : c'est la décision
  client **D7**, en attente, à valider des DEUX côtés par `node scripts/check-sync-contract.mjs` (le
  contrat Dart fait partie de la validation — ne pas fusionner un côté seul). Les valeurs, elles, ne
  dépendent plus de l'hôte : `utcDayInstant` les fabrique depuis le jour civil (cf. §6).
- Les compteurs que tu écris dans un doc (suites, tests, gardiens, migrations) doivent être MESURÉS
  dans la commande que tu viens de lancer, jamais recopiés d'un doc antérieur. `tests/tenant-isolation/
  claims-contract.test.mjs` fait échouer la CI sur un doc qui gonfle la réalité.

COMMENT TRAVAILLER :
1. Une tâche à la fois, dans l'ordre T1→T7. Pour chaque tâche : reproduire d'abord (montrer la sortie
   rouge), corriger, re-mesurer (sortie verte), puis `git commit` (message conventionnel français,
   style `git log`, co-auteur `arena-agent`).
2. Vérifications rapides obligatoires avant chaque push :
     npm ci
     npm run lint && npm run typecheck && npm run test:unit
     node --test tests/tenant-isolation/claims-contract.test.mjs
     node scripts/check-guards-wired.mjs && node scripts/check-i18n-parity.mjs
   (tout doit sortir 0 ; `check-guards-wired` verrouille aussi les SUITES orphelines.)
3. Si une vérification exige PostgreSQL sans Docker :
     bash scripts/local-embedded-postgres.sh start
     eval "$(bash scripts/local-embedded-postgres.sh env)"
     node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
   Gate complet (rôles + grants de production, ~25 min) :
     ALLOW_DATABASE_RESET=1 npm run test:production-roles   # attendu : 77/77 suites, 59/59 contrôles
   Termine par : bash scripts/local-embedded-postgres.sh stop
4. Si une tâche est ambiguë, si sa preuve est impossible dans l'environnement, ou si elle touche à une
   décision D1–D6 : T'ARRÊTER et demander. Ne jamais remplacer une décision absente par une supposition.
5. Finir par un rapport : pour chaque tâche — commande de reproduction AVANT (extrait de sortie),
   fichier:ligne du correctif, commande APRES (extrait), commit SHA, et ce qui reste non prouvé.

TES TÂCHES :
T1 (P2, avec PostgreSQL local) — Les 4 suites qui échouent en mode autonome.
   FAIT ÉTABLI (mesuré le 2026-10-16, pas inféré) : `phase22-audit-fixes`,
   `phase36-notification-revocation`, `phase47-invitations`, `phase49-storage-selection` échouent via
   `ISOLATION_LOG_DIR=/tmp/x bash scripts/run-isolation-suites.sh <préfixe>` avec `DATABASE_URL` sur la
   base embarquée, **à `TZ=Africa/Algiers` comme à `TZ=UTC`** — donc sans lien avec le fuseau — et sont
   **vertes dans le gate D complet** (77/77, `ALLOW_DATABASE_RESET=1 npm run test:production-roles`).
   CAUSE NON ÉTABLIE : c'est TOI de la trouver, suite par suite, en lisant
   `/tmp/x/suite-<suite>.test.log` (ne pas raisonner par analogie — les 4 n'ont peut-être pas la même
   cause : rôles, reset, variables de stockage, port). Ensuite seulement : soit un environnement autonome
   explicite (`scripts/run-isolation-standalone.sh`, qui boote ce qui manque SANS dupliquer la logique du
   gate), soit rendre les suites autonomes. INTERDIT : les retirer du runner, les mettre en `skip`, ou
   relaxer une assertion pour qu'elles passent. Critère : les 4 vertes en mode autonome, et le gate
   toujours 77/77.
T2 (P2, sans Docker) — Couverture admin-web, niveau au-dessus. 36 tests existent (`src/api/client.test.ts`,
   `src/lib/*`, `src/auth/routeAccess.test.ts`). Les pages React (4 655 LOC hors tests) ne sont pas
   testées. Ajouter un test d'au moins 3 pages sur la logique réellement risquée (formatage des montants
   DA au format fr-DZ, gardes d'affichage par rôle, construction des paramètres d'export), avec la
   SEULE toolchain déjà présente (node --test, `--experimental-transform-types`). Ne pas ajouter
   jsdom/vitest sans justification écrite. Chaque test doit être validé par mutation (casser la source,
   montrer le rouge).
T3 (P1, Dart requis) — Issue #40, F2/F4 : `cd apps/staff-mobile && dart pub get && dart run build_runner
   build --delete-conflicting-outputs` puis `flutter analyze` et `flutter test` dans les trois apps
   mobiles, et `node scripts/check-sync-contract.mjs` EN TIER (sans `--node-only`, donc avec Dart 3.x
   + Flutter 3.47.1). Attendu : contrat de sync identique des deux côtés. Si l'environnement n'a pas
   Dart/Flutter : le dire — ne pas simuler ce qui n’a pas été exécuté.
T4 (P1, Docker requis) — `docker compose -f infrastructure/docker/docker-compose.staging.yml config` puis les gates
   `node scripts/test-worker-monitoring-stack.mjs` et `node scripts/test-metrics-collector-stack.mjs`,
   `node scripts/build-minio-image.mjs`, `node scripts/test-staging-stack.mjs`. Attendu : tous verts,
   aucune image non épinglée par somme SHA-256.
T5 (P2, doc) — Décisions : NE RIEN INVENTER, DEUX ADR EXISTENT.
   - Moteur : `docs/adr/ADR-015-moteur.md`, statut **Accepté** (PG 18 uniforme) → la ligne « décision
     moteur à consigner » du handoff Phase D est CLOSE, ne pas rouvrir l'ADR.
   - Numérotation : `docs/adr/ADR-016-next-org-sequence-numbering.md`, statut **Proposé**, en attente du
     client **et d'un avis juridique**. Tâche réelle : obtenir la réponse (D1), puis (a) passer le
     statut à Accepté ou Rejeté avec la date et qui a tranché, (b) si Accepté ≠ situation actuelle,
     implémenter dans `next_org_sequence` (migration ≥ 103, 001→102 immuables) + test d'isolation.
   Sans réponse : ne pas trancher, ne pas « pré-acter ». Le rôle de l'agent est de vérifier qu'aucun
   document ne revendique une décision absente — et de corriger le document, pas l'ADR.
T6 (P2) — Revérifier les 40 routes sans `@Roles`/`@Public` (`npm run check:routes-inventory`) contre
   `docs/architecture/authorization-matrix.md` après toute modification d'API ; justifier ligne à ligne,
   ne pas ajouter de garde sans test d'isolation associé (pattern `tests/tenant-isolation/phase61-…`).
T7 (P3) — Exécuter la batterie sous fuseau non-UTC pour garder la preuve fraîche :
   `TZ=Africa/Algiers ISOLATION_LOG_DIR=/tmp/tz-algiers bash scripts/run-isolation-suites.sh`
   Attendu : 77/77 (le gate fournit l'environnement des 4 suites de T1 une fois T1 fait). Les lectures
   de colonnes `date` dans les tests doivent se faire côté SQL (cf. correction phase56), jamais via
   `new Date(col).getUTCDate()`.
````

---

## 3. Issue #14 — le drill de restauration (humain, VM vierge)

**La procédure de référence est `docs/BACKUP-RUNBOOK.md`**, section « Procédure chronométrée »
(T0 → T0+2 min → …, avec l'option Docker). Ne pas la dupliquer ici. Ce que ce § ajoute, parce que
vérifié dans le code ce jour :

1. **Interfaces réelles** — pas d'options inventées :
   - `scripts/backup.sh` se pilote **uniquement par variables** : `DATABASE_URL`, `BACKUP_DIR`
     (défaut `/var/backups/creche`), `BACKUP_PASSPHRASE` (obligatoire), `KEEP_DAYS` (7),
     `BACKUP_OFFSITE_DIR` (copie hors site). Produit :
     `$BACKUP_DIR/daily/creche-AAAA-MM-JJ.sql.gz.gpg` **+** le `.sha256` **à côté** (donc
     `cd .../daily` avant `sha256sum -c`, le fichier ne contient que le nom de base).
   - `scripts/restore-drill.mjs` exige `DATABASE_URL` **+** `BACKUP_PASSPHRASE`, et refuse toute base
     qui ne finit pas par `_test` sauf `DRILL_ALLOW_NON_TEST=1` assumé. Il fait tout le cycle :
     backup → sha256 → **mauvaise passphrase doit échouer** (preuve de chiffrement) → restauration
     dans `restore_drill_target` → comparaison → nettoyage. Prérequis : `gpg`, `gzip`, `pg_dump`, `psql`
     dans le `PATH` (ou `PG_BIN`).
2. **Le chrono est contradictoire — à trancher dans l'issue, pas en silence** : le runbook annonce
   « < 30 min », le corps de #14 « < 15 min pour < 1 Go ». Les deux sont défendables (périmètres
   différents) mais pas interchangeables. Cliquer `... → Edit` sur #14 et fixer **un** objectif, en
   écrivant à quoi il s'applique (taille d'archive ou de base, restauration seule ou drill complet).
3. **Compteurs périmés dans #14** (le corps dit `001-049 OK` et `schema-check → 61/61`) : remplacer par
   `node scripts/migrate.mjs --status` → **001→102, 101 fichiers** et `node
   tests/tenant-isolation/schema-check.mjs --verbose` → **le décompte rendu ce jour-là** (le script
   affiche son propre total : recopier la sortie, ne pas écrire un nombre d'avance). Le runbook,
   ligne « Doit dire : Schéma cohérent, toutes migrations appliquées (001→NNN), checksums OK », est
   cohérent avec cette formulation.
4. **Version du client** : le runbook parle d'Ubuntu 22.04 ; le dépôt est uniformément en PostgreSQL 18
   (ADR-015). Sur la VM, `psql --version` et `pg_dump --version` doivent être **≥** la version du
   serveur, sinon `pg_dump` refuse et le drill est faussement vert. Installer
   `postgresql-client-18 gnupg gzip`.
5. **La comparaison source ↔ restauré, jouable à la main** (c'est la liste exacte du script) :
   ```bash
   for t in organizations users memberships roles children guardians \
            invoices payments sessions audit_logs consent_records background_jobs; do
     printf '%-18s source=%s restauré=%s\n' "$t" \
       "$(psql "$SOURCE_URL" -Atc "SELECT count(*) FROM $t")" \
       "$(psql "$RESTORED_URL" -Atc "SELECT count(*) FROM $t")"
   done
   # + SELECT count(*) FROM pg_policies  (identique des deux côtés)
   # + présentes côté restauré : auth_get_memberships(uuid) ;
   #   invite_accept(uuid, uuid) ;
   #   billing_webhook_apply(uuid, text, numeric, text, timestamptz, text)
   ```
   Écart sur un seul point = **drill raté** : on corrige la sauvegarde ou la restauration, jamais la
   comparaison.
6. **Deux vérifications en plus du script** (le script ne les fait pas) :
   `SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='children'` →
   les deux à `t` ; `SELECT rolbypassrls FROM pg_roles WHERE rolname='creche_app'` → **`f`**.
7. Clôture : dans #14, coller la sortie de l'étape 5, le chrono réel mesuré, l'heure de début/fin et le
   nom de l'opérateur (different de celui qui a écrit le runbook), puis **Close issue**. Si la preuve est
   versionnée dans `docs/`, retirer passphrase et tout hash.

---

## 4. Tâches qui exigent Docker ou Flutter (à confier à une machine dédiée)

Ce que l'agent de cette session **n'a pas** pu faire, et pourquoi (réseau fermé, ni Docker ni Dart) :

| Tâche | Commande | Attendu |
|---|---|---|
| Contrat de sync complet (côté Dart) | `node scripts/check-sync-contract.mjs` (sans `--node-only`) | généré = committé, sinon exit 1 |
| `generate-sync-contract` | `node scripts/generate-sync-contract.mjs --check` | vert après build API |
| Staff sync | `node scripts/check-staff-sync.mjs` | vert |
| Staging | `docker compose -f infrastructure/docker/docker-compose.staging.yml up -d && node scripts/test-staging-stack.mjs` | vert, puis `down -v` |
| Monitoring E2/H2k | `node scripts/test-worker-monitoring-stack.mjs`, `node scripts/test-metrics-collector-stack.mjs` | vert (images tirées via secrets de dépôt si plafond anonyme atteint) |
| Image MinIO (D4) | `node scripts/build-minio-image.mjs` | somme SHA-256 vérifiée, architecture attendue |
| Apps mobiles | `flutter analyze && flutter test` × 3 apps | 0 warning bloquant |

---

## 5. Vérifier que la fusion tient (5 min, n'importe quelle machine avec Node 22)

```bash
git clone https://github.com/Allintelligence2024/cr-cheDZ && cd cr-cheDZ   # Node 22 requis
git log -1 --oneline                    # 7e8862b ou plus récent
npm ci                                  # attendu : exit 0
npm audit --omit=dev --audit-level=low    # attendu : 0 vulnérabilité
npm run lint                            # attendu : 0 erreur, 0 warning (--max-warnings=0)
npm run typecheck                         # attendu : 4 workspaces verts
npm run test:unit                         # attendu : api 48 suites / 994 tests, worker 1 / 5
npm run test:unit --workspace @creche/admin-web   # attendu : 36 tests verts
node --test tests/tenant-isolation/claims-contract.test.mjs   # attendu : 12/12
node scripts/check-guards-wired.mjs       # attendu : 16 gardiens + 91 suites, tous appelés
node scripts/check-i18n-parity.mjs        # attendu : 369 clés fr / 369 ar, 502 appels t() résolus
npm run check:routes-inventory            # attendu : 205 routes, 40 sans garde (justifiées, matrice v15)
```

Avec une base de données (facultatif, prouve le cœur sécurité) :

```bash
bash scripts/local-embedded-postgres.sh start
eval "$(bash scripts/local-embedded-postgres.sh env)"
npm run build --workspace @creche/api && npm run build --workspace @creche/worker
ALLOW_DATABASE_RESET=1 npm run test:production-roles     # attendu : 77/77 suites, 59/59 contrôles, exit 0
node tests/tenant-isolation/schema-check.mjs --verbose
node tests/tenant-isolation/rls-behavior-check.mjs
bash scripts/local-embedded-postgres.sh stop
```

---

## 6. Ce qui est déjà clos (ne pas refaire)

- **Fuseaux (E4/Q5)** : lectures calendrier via `@creche/prod-config` (`businessDate`, `businessYear`,
  `toCivilDay`, `localCalendarDay`, `monthsBetweenDates`, `shiftDateOnly`) ; `TZ=UTC` épinglé dans les
  deux Dockerfiles ; portail parent (`GET /parent/invoices[/:id]`) rendu par `utcDayInstant` → plus
  aucune dépendance à l'hôte, **mêmes octets qu'avant** ; résidu mesuré sur 77 suites sous
  `TZ=Africa/Algiers` (plan §9.1) : plus aucun, le dernier faux positif (lecture de test dans `phase56`)
  est corrigé.
- **i18n arabe (Q4)** : 369 clés symétriques, `{n}` réellement interpolé, et le garde
  `scripts/check-i18n-parity.mjs` (job `quality`) qui rend la classe impossible à faire revenir.
- **Sécurité applicative** : `multer` 2.4.0 / `nodemailer` 10.x / `body-parser` 2.3.0 (audit prod 0),
  cookie `Path`, garde multi-tenant de la recherche parent, fencing `notif_queue`, validation des
  téléphones (`@IsAlgerianPhone` sur les 7 DTO).
- **Qualité** : lint 0 warning, `test:unit` des trois workspaces, gardiens tous câblés — y compris les
  **suites** désormais (`check-guards-wired`), et le glob de test admin-web qui ne saute plus les
  sous-dossiers en silence.
- **Inventaire des 40 routes** self-service : justifié ligne à ligne dans
  `docs/architecture/authorization-matrix.md` (v15).
