# Plan de correction — GitHub (issues, sécurité, qualité) — cr-cheDZ

**Date** : 2026-10-15 · **Branche** : `arena/4efe1e90-cr-chedz` · **Base** : `main` @ `4835bce`
**Périmètre** : 11 issues ouvertes (#14, #15, #16, #17, #35, #38, #39, #40, #41, #42, #55),
sécurité (`.github/workflows/security-audit.yml`, `codeql.yml`, `SECURITY.md`) et qualité
(`ci.yml` job `quality`, gardiens `scripts/*`).

> Ce document consolide l'analyse des pages GitHub (issues, sécurité, qualité) et définit
> l'ordre d'exécution. Il ne remplace pas `docs/HANDOFF-OPEN-ISSUES-2026-10-14.md` ni
> `docs/PLAN-MAITRE-REMEDIATION.md` : il en est la vue « GitHub ».

---

## 0. État vérifié au 2026-10-15 (base locale, sans Docker)

| Contrôle | Commande | Résultat |
|---|---|---|
| Audit prod | `npm audit --omit=dev --audit-level=low` | **0 vulnérabilité** |
| Lint | `npm run lint` (`--max-warnings=0`) | **0 erreur, 0 warning** (warning `MODULE_TYPELESS_PACKAGE_JSON` retiré par ajout `"type": "module"` à `packages/shared-config/package.json`) |
| Typecheck | `npm run typecheck` | vert (api, worker, admin-web, support-console) |
| Build | `npm run build --workspace @creche/api` / `@creche/worker` | vert |
| Tests unitaires | `npm run test:unit` | **49 suites / 999 tests verts** — api 48 suites / 994 tests, worker 1 suite / 5 tests (re-mesuré ce jour : les specs E4 et `utcDayInstant` ont ajouté 2 suites / 27 tests au compteur annoncé hier) |
| Migrations | `node scripts/migrate.mjs --status` | 101 appliquées (001→102) |
| Schéma / RLS | `schema-check.mjs --verbose`, `rls-behavior-check.mjs` | verts |
| Indexation tenant | `check-tenant-index.mjs --verbose` | vert |
| Garde RLS | `check-rls-usage.mjs` (avec PG) | 68 accès conformes |
| Env example | `check-env-example.mjs` | vert |
| Manifest Android | `check-android-manifest.mjs` | vert (6 avertissements non bloquants) |
| Gardiens câblés | `check-guards-wired.mjs` | 16 gardiens, vert |
| Contrat documentaire | `claims-contract.test.mjs` | 12/12 |
| Specs e2e | `check-e2e-skeletons.mjs` | 8 fichiers, aucun squelette |
| Chemins SPA | `check-spa-static-paths.mjs` | vert |
| **Gate D (rôles de prod)** | `test-production-roles.mjs` | **vert localement** (rejoué ce jour : `77/77 suites`, 59/59 contrôles, `0 ✗`, exit 0) **et en CI** (job `database` vert sur le head final), et rejoué par la CI à chaque push/PR (délégation de `run-isolation-suites.sh`, cf. §2 #38) |
| Inventaire routes | `check:routes-inventory` | 205 routes, **40 sans `@Roles`/`@Public`** (toutes self-service, justifiées dans `docs/architecture/authorization-matrix.md`) |

Non vérifié ici (hors périmètre sans Docker/Flutter) : `check-staff-sync.mjs`, tests Flutter, stacks monitoring (E2), `docker-compose.staging.yml`, build d'image Docker.

---

## 1. Sécurité — état et actions

### 1.1 Workflows

- `.github/workflows/security-audit.yml` : `npm audit --omit=dev --audit-level=low` hebdomadaire + ouverture d'issue auto. **Vert** aujourd'hui (0 vulnérabilité). L'issue #55/#35 est périmée → à fermer (action humaine, le jeton renvoie 403 sur l'écriture d'issue).
- `.github/workflows/codeql.yml` : analyse JS/TS sur PR/main + hebdo. **Non exécutable localement** (pas de CLI CodeQL) ; laisser à la CI. Aucune alerte ouverte accessible (403 sur l'API code-scanning pour ce jeton).
- `.github/workflows/ci.yml` job `security` : `npm audit --omit=dev` sur PR. Vert.
- Dependabot : activé (`.github/dependabot.yml`), alertes désactivées au niveau dépôt (403) — **pas de levier agent** ; dépend de l'admin dépôt.

### 1.2 Posture (SECURITY.md)

Déjà en place et vérifiée : RLS `USING`+`WITH CHECK` sur toutes les tables tenant, rôle `creche_app` `NOBYPASSRLS`, helper `app_tenant_id()` safe-by-default, JWT epoch (G4), TOTP chiffré au repos (G5), upload par l'API avec SHA-256 + signature binaire, lecture same-origin, presign d'écriture mort en prod. Voir `SECURITY.md` pour la liste complète et les limites connues (vidéo par l'API non implémentée, pas de retrait EXIF).

### 1.3 Actions sécurité restantes (agent)

| # | Action | Statut |
|---|---|---|
| S1 | Bump `multer`/`nodemailer` (issue #35/#55) | **Déjà fait** (`multer` 2.4.0 via override, `nodemailer` 10.x) — audit 0 |
| S2 | Overrides `body-parser` 2.3.0 (issue #42) | **Déjà fait** dans `package.json` ; `npm ls body-parser` → 2.3.0, aucune erreur ELSPROBLEMS |
| S3 | `packages/shared-config` `"type": "module"` (warning lint) | **Fait ce jour** — lint 0 warning |
| S4 | Vérifier qu'aucun secret n'est committé | `audit-seeds-pii.mjs --strict` vert ; `.env.prod` non versionné (`.gitignore`) |

### 1.4 Actions sécurité (humain)

- D3 (fournisseur SMTP/Twilio + secrets) — bloque E2 et invitations réelles.
- D4 (revue sécurité stockage / pin MinIO) — bloque la qualification prod.
- Activation des alertes Dependabot au niveau dépôt (admin).

---

## 2. Issues GitHub — tableau de bord

| Issue | Titre | État réel au 2026-10-15 | Action |
|---|---|---|---|
| #14 | Restore backup.sh sur VM vierge (P0) | Drill existe (`restore-drill.mjs`, CI `backup-drill`), pas exécuté ici (gpg absent, pas de VM). Critères périmés (001–049 → 001–102) | Humain : VM vierge + opérateur différent + chronométrage < 30 min |
| #15 | bump intl ^0.20.3 | **Résolu** : `intl ^0.20.3` dans les 3 pubspec, workflow flutter vert | Fermer (action humaine) |
| #16 | build_runner staff-mobile | **Résolu** : `app_database.g.dart` committé (3 582 lignes) | Fermer (action humaine) |
| #17 | burn-down 72 warnings lint | **Périmé** : `npm run lint` → 0 warning | Fermer (action humaine) |
| #35 | régression npm audit multer/nodemailer | **Résolu** : audit 0, multer 2.4.0, nodemailer 10.x | Fermer (action humaine) |
| #38 | Phase D — RLS effective en prod | **Gate vert** (59 suites/contrôles, preuve capturée ce jour). **Câblage CI : déjà en place** — vérifié dans le code, pas deviné : `scripts/run-isolation-suites.sh` contient `if GITHUB_ACTIONS=true && PRODUCTION_ROLE_TESTS!=1 && aucun argument de filtre → ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs`, et l'étape `database` de `ci.yml` appelle exactement ce runner sans argument. Le gate D strict tourne donc sur **chaque** push/PR (c'est la durée réelle du job : 33 à 35 min ; vert sur `0bb4d3a` run `38804941475`, et **re-vert sur le head final `12f5152`, run `38817525143`, job `database` 34 min 35 s — 14/14 checks au vert**, après `utcDayInstant`, la phase56 revue et les deux gardiens ajoutés) — d'où la ligne « Gate D non câblé » obtenue en cherchant `test:production-roles` dans le YAML seul. Le plan de rollback, lui, est déjà écrit ; et la « décision moteur » portée comme restante par `docs/HANDOFF-OPEN-ISSUES-2026-10-14.md` (l.101) est **close** : `docs/adr/ADR-015-moteur.md`, statut Accepté (2026-10-14) — le handoff la liste parce qu'il la précède dans la journée. `ADR-016` (numérotation) reste, lui, **Proposé** : c'est D1, rien à écrire d'autre. | Reste humain : relecture du rollback (et D1 pour la numérotation, ADR-016 au statut Proposé) |
| #39 | Phase E — fiabilité worker | E1–E6 implémentés et verts (phase27/28 dans le gate). Reste : décision paie sans prorata (D2), activation E2 (D3), gate monitoring (Docker) | Humain : D2, D3, CI pour monitoring |
| #40 | Phase F — contrat sync mobile bout-à-bout | F1/F3 vérifiés (phase29–34). F2/F4 côté Dart non vérifiés (pas de Flutter ici) | Agent avec Flutter 3.47.1 : `flutter analyze/test`, `check-staff-sync.mjs`, F4 |
| #41 | Phase G — HIGH restants | G1–G5 livrés et verts (gate). **Frontières privilégiées : fait** (Q2, matrice v15 + inventaire 40 lignes à ligne). **`anonymize.sql` : déjà couvert** — vérification faite ce jour, `phase52-anonymization.pg.test.mjs`, `phase56/56b-anonymize-child` sont dans `scripts/run-isolation-suites.sh` (donc dans le gate D) et `test-production-roles.mjs` rend la ligne de preuve H2l (canary scan, no-purge, réécriture déterministe, idempotence, garde de nom de base). Le runbook `docs/PHASE_H2L_ANONYMIZATION_RUNBOOK.md` est à jour ; binaire objet de stockage et remises vendeur restent hors périmètre (dit par le script). | Humain : D1 uniquement |
| #42 | Phase H — staging + dette MEDIUM/LOW | body-parser déjà résolu, lockfile à prouver sur clone propre, 40 routes justifiées (fait), H3 agent-tasks partiellement faits (téléphone, i18n, timezone) | Agent : lockfile proof, H3 restants ; humain : staging Docker |
| #55 | security-audit vulnérabilités prod | **Résolu** (même cause que #35) | Fermer (action humaine) |

---

## 3. Qualité — état et actions

### 3.1 Gardiens (tous verts, cf. §0)

`schema-check`, `rls-behavior-check`, `check-tenant-index`, `check-rls-usage`, `check-env-example`,
`check-android-manifest`, `check-guards-wired` (16 gardiens, tous câblés), `check-e2e-skeletons`,
`check-spa-static-paths`, `check-sync-contract` (partiel, sans Dart), `claims-contract` (12/12),
`media-client-wiring`, `parent-session-contract`, `sync-resync-contract`.

**Ajouté ce jour** : `scripts/check-i18n-parity.mjs` (`npm run check:i18n-parity`, step CI `quality`)
— parité des jeux de clés fr/ar, refus d'une valeur non traduite (sauf acronyme assumé),
conservation des jetons `{nom}` à travers la traduction, et existence de chaque `t('…')` appelé
depuis l'administration. La classe de défaut qu'il verrouille est exactement celle trouvée par
l'audit (deux chaînes laissées en français dans le bloc arabe + un `{n}` affiché littéralement) :
elle est silencieuse à l'exécution, donc invisible pour les tests applicatifs.

### 3.2 Couverture de tests

- API : 48 suites jest, 994 tests — dont 18 sur la seule matrice TZ de `business-calendar.spec.ts` (E4 + `utcDayInstant`) —, couverture ~20 % (seuils cliquets `jest.config.mts`).
- **Admin-web (Q7, fait ce jour)** : 4 suites `node --test`, **36 tests** pour 4 655 LOC hors tests.
  Sont désormais verrouillés, et seulement eux : les invariants de session du client API
  (`api/client.ts` — R14 cookie httpOnly et mémoire seule, A2 single-flight nettoyé en `finally` +
  re-tentative après re-login, 429/5xx ne déconnecte pas, rejet d’un 401 une seule fois, erreurs
  bilingues FR/AR, téléchargement binaire authentifié et onglet `noopener` révoqué à 60 s — LOT 2/F5), les champs `type="date"` (E4) et l’interpolation
  `{jeton}` (i18n). Les pages React restent non testées — c’est la dette réelle, elle reste documentée.
  Le runner du workspace utilisait `node --experimental-strip-types --test src/**/*.test.ts` :
  (a) `strip-types` refuse les *parameter properties*, donc `client.ts` — le module sensible —
  n’était **pas importable** par un test ; (b) le motif non protégé était développé par `sh` et
  ne voyait que les fichiers à une profondeur, les tests d’un sous-dossier plus profond étaient
  ignorés **en silence**. Corrigé en `node --experimental-transform-types --test "src/**/*.test.ts"`.
  Les tests ne sont pas décoratifs : **vérifiés par mutation** sur `client.ts` — retirer
  `credentials: 'include'`, supprimer le `finally` du single-flight, inverser le `retry`, retirer la
  garde `access ? … : {}`, rendre un 204 comme du JSON ou propager une erreur non-JSON rend la suite
  rouge (7 mutations rejouées, et la 8ᵉ — un faux changement sémantiquement neutre — reste verte,
  preuve que la suite ne se contente pas de répéter le code).
  Le contrat de vérité documentaire (`claims-contract.test.mjs`) ne verrouillait pas ces compteurs,
  c’est donc le présent document qui doit suivre l’état du disque — et non l’inverse.
- E2E Playwright : non bloquant (job `e2e`), honnête.

### 3.3 Actions qualité restantes (agent)

| # | Action | Effort |
|---|---|---|
| Q1 | Preuve lockfile sur clone propre | **Fait** — `git clone` + `npm ci` (920 paquets) → `git status --short` vide, exit 0 |
| Q2 | Frontières privilégiées (authorization-matrix déjà documenté ; vérifier les 40 routes self-service restent justifiées) | **Fait** — matrice v15 à jour, inventaire 205 routes / 40 self-service justifiées ligne à ligne |
| Q3 | H3 : validation téléphone (`algerian-phone.ts`) | **Fait** — les 7 DTO avec champ téléphone portent `@IsAlgerianPhone` ; `import.dto.guardian_phone` est validé dans le service (rapport FR/AR par ligne, pas un 400 global) |
| Q4 | H3 : i18n arabe | **Fait (périmètre vérifiable)** — 369 clés fr/ar symétriques ; `bill.exportExcel`/`bill.exportRequested` traduits en arabe ; `{n}` de `children.imported` réellement interpolé ; rapport d'import affiche `message_ar` en locale ar. Les notifs push/WhatsApp/inbox portent déjà les deux langues et suivent `users.locale` |
| Q5 | H3 : harmonisation timezone | **Fait** — voir E4 ci-dessous. Le format de fil des colonnes `date` reste `AAAA-MM-JJT00:00:00.000Z` (ce que mobile et administration reçoivent déjà) mais n'est **plus produit par le fuseau de l'hôte** : `utcDayInstant` construit ces octets depuis le jour civil. Aucune décision client n'est donc requise, et le `TZ=UTC` des images devient un renforcement de défense en profondeur plutôt qu'une condition de justesse |
| Q6 | Lint : avertissement `MODULE_TYPELESS_PACKAGE_JSON` | **Fait** |
| Q7 | Admin-web : augmenter la couverture (1 test → objectif minimal) | **Fait** — 36 tests dans 4 suites : `api/client.test.ts` 14 (invariants de session, éprouvés par mutation), `lib/interpolate.test.ts` 7, `lib/dates.test.ts` 4, `auth/routeAccess.test.ts` 11 ; runner réparé (`transform-types` + glob protégé) ; détaillé en §3.2 |

### E4 — harmonisation des fuseaux (exécutée 2026-10-15)

Défaut vérifié : `node-postgres` construit les colonnes `date` en **minuit local** du
process ; les relire via `toISOString().slice(0,10)` recule le jour dès que le fuseau du
serveur est en avance sur UTC — le cas d'Alger (UTC+1). Corrections :

| Zone | Effet du défaut | Après correction |
|---|---|---|
| `health` — fenêtre d'autorisation de médicament | le **dernier jour autorisé** était rejeté (422) et la **veille du premier jour** acceptée | bornes incluses ; phase10-health épingle les deux cas (rouge sous `TZ=Asia/Tokyo` avant, vert après) |
| `billing` — caisse (`CASH_OPEN_PREVIOUS_DAY`) | message nommant le mauvais jour | jour calendaire exact |
| `attestations` — « Fait le » du PDF | jour UTC (une émission entre 00:00 et 01:00 à Alger datée de la veille) | jour civil du fuseau métier |
| `worker` — « Générée le » de la facture | horodatage UTC | horodatage Alger (`businessDateTime`) |
| `analytics` — fenêtres 30/90 jours | `from` en UTC contre `to` à Alger | deux bornes en jours civils d'Alger |
| `children`/`import`/`enrollment` — année des références, âge légal (décret 19-253) | dépendaient du fuseau du serveur (jusqu'à un faux « date de naissance dans le futur ») | calendrier pur (`toCivilDay`, `monthsBetweenDates`, `businessYear`) |
| `admin-web` — champs `type="date"` | s'ouvraient sur la veille entre 00:00 et 01:00 à Alger | `localDateInputValue()` |
| `parents` (H2d) — portail parent, `due_date` des factures | la valeur HTTP dépendait de la machine : sous `TZ=Africa/Algiers` **comme** sous `TZ=Asia/Tokyo`, la suite phase38 rendait la veille de l'échéance ; sous `TZ=UTC` elle passait — c'est pourquoi la classe restait invisible | `parentInvoiceWireRow` + `utcDayInstant` : mêmes octets sur le fil, jour civil épinglé, plus aucune dépendance à l'hôte |

Déploiement : `TZ=UTC` est épinglé dans `apps/api/Dockerfile` et `apps/worker/Dockerfile`
(commenté dans `.env.prod.example`), ce qui fige le rendu HTTP des colonnes `date` et rend
le comportement identique quel que soit l'hôte.

Helpers partagés dans `@creche/prod-config` (`businessDate`, `businessDateTime`,
`businessYear`, `localCalendarDay`, `toCivilDay`, `monthsBetweenDates`, `shiftDateOnly`),
couverte par `business-calendar.spec.ts` et `age-creche.spec.ts` (chaque cas TZ est rejoué
dans un **processus enfant** à `TZ` forcé — Jest épingle `TZ=UTC`).

### 3.4 Actions qualité (humain)

- Revue de sécurité du stockage / pin MinIO (D4).
- Qualification Android release (keystore, D5).

---

## 4. Décisions humaines à obtenir (transmises au client)

| # | Décision | Bloque | Référence |
|---|---|---|---|
| D1 | Numérotation factures : séquentiel légal vs référence publique opaque | #41 | ADR-016 |
| D2 | Paie sans prorata | #39, #42 | plan H3 l.762 |
| D3 | Fournisseur SMTP / Twilio + secrets | #39 E2, #41 invitations | plan l.321, l.524 |
| D4 | Revue sécurité stockage / pin MinIO | #42 | plan l.643 |
| D5 | Keystore Android + qualification release | #40 | plan l.480 |
| D6 | Autorisation de merger les PR de phase | tout | règle du dépôt |

---

## 5. Ordre d'exécution recommandé (agent)

1. **Vérifications rapides** (déjà faites) : #15, #16, #17, #35, #55 → à fermer par un humain.
2. **Lockfile** (Q1) — preuve sur clone propre.
3. **Phase D** — preuve gate capturée ce jour (59/59) ; rollback déjà écrit ; décision moteur à consigner.
4. **Phase F** — nécessite Flutter 3.47.1 (réseau) ; à faire sur machine avec accès.
5. **Phase H3 agent-tasks** (Q3, Q4, Q5) — téléphone, i18n, timezone.
6. **Phase G** — frontières privilégiées (Q2).
7. **#14** — drill sur VM (opérateur humain).
8. **Décisions D1–D6** — transmises au client.

---

## 6. Ce qui ne peut pas être fait sans Docker/Flutter (à confier à la CI ou à une machine dédiée)

- `docker-compose.staging.yml` (H1) ; `build-minio-image.mjs` ; `registry-pull.mjs`.
- Stacks monitoring (E2, H2j/H2k) : `test-worker-monitoring-stack.mjs`, `test-metrics-collector-stack.mjs`.
- `test-staging-stack.mjs`.
- Build d'image Docker (`docker.yml`).
- `check-staff-sync.mjs`, tests Flutter, F4 bout-à-bout (nécessitent Dart/Flutter).

---

## 7. Actions GitHub (à faire par un humain si le jeton renvoie 403)

Fermer avec ce commentaire :

- **#55, #35** : « Résolu sur `main` : `npm audit --omit=dev` → 0 vulnérabilité ; `multer` 2.4.0, `nodemailer` 10.x. Revérifié le 2026-10-15. »
- **#17** : « Périmé : `npm run lint` (`--max-warnings=0`) → 0 warning sur `main`. »
- **#15** : « Résolu : `intl ^0.20.3` dans les trois apps ; workflow `flutter` vert sur `main`. »
- **#16** : « Résolu : `app_database.g.dart` committé et généré ; workflow `flutter` vert sur `main`. »

Mettre à jour les critères de **#14** (migrations 001–102, plus de « 61/61 ») et ajouter une référence à ce document aux issues #38–#42.

---

## 8. Travaux déjà réalisés ce jour (branche `arena/4efe1e90-cr-chedz`)

1. `packages/shared-config/package.json` : ajout `"type": "module"` → suppression du warning `MODULE_TYPELESS_PACKAGE_JSON` ; lint toujours 0 warning.
2. Preuve **Gate D** capturée : 59 suites/contrôles verts avec rôles et grants de production (logs dans `/tmp/creche-roles-gate-*`).
3. Build `@creche/worker` réalisé (prérequis du gate D).
4. Schéma / RLS / indexation tenant / garde RLS vérifiés verts.
5. Ce document de plan.
6. **Q7 (couverture admin-web)** : 12 tests d’invariants de session sur `api/client.ts`, extraction
   de `interpolate` dans `lib/interpolate.ts` + 7 tests, soit 35 tests dans le workspace ; runner
   réparé (`--experimental-transform-types`, glob protégé) — sans cela `client.ts` n’était ni
   importable ni testable, et les suites d’un sous-dossier profond étaient silencieusement ignorées.
7. **#41 anonymize** : statut vérifié (rien à refaire) — suites et preuve H2l déjà dans le gate.
8. **Q2** : inventaire 205 routes / 40 sans garde, rejoué sur cette branche ; la section
   « Inventaire des 40 routes » de `docs/architecture/authorization-matrix.md` (v15) les justifie.
9. **TZ résiduelle** : le format de fil des colonnes `date` reste dépendant du fuseau du **processus**
   (mesuré, pas supposé) — voir §9.1.

---

## 9. Limites de cette session

- Aucun accès aux pages GitHub « Security » (dependabot/code-scanning/secret-scanning) : le jeton renvoie 403. Les alertes éventuelles sont à consulter par un admin dépôt.
- Pas de Docker ni de Flutter/Dart dans l'environnement : tâches Docker/Flutter restent à la CI ou à une machine dédiée.
- Aucun merge effectué (règle du dépôt) ; les changements sont sur la branche de session, à ouvrir en PR.

### 9.1 Résidu hors UTC — mesuré ce jour, plus que rien ne reste en suspens côté livré

Question posée au lieu d'être supposée : « le `TZ=UTC` des images est-il la seule chose
qui rend le rendu correct ? ». Réponse obtenue en rejouant les **77 suites d'isolation
sous `TZ=Africa/Algiers`** (le fuseau du client) :

| Résultat | Suites | Attribution |
|---|---|---|
| vertes | 72 | dont toutes les suites de calendrier, facturation, caisse, exports, sync, santé |
| rouges, **sans lien avec le fuseau** | 4 (phase22, phase36, phase47, phase49) | se reproduisent **à l'identique sous `TZ=UTC`** en mode autonome : ce sont les rôles/reset que fournit `test-production-roles.mjs`, absents de la commande isolée ; **vertes dans le gate D complet** (77/77, cf. §0) |
| rouge **imputable au fuseau** | 1 (phase56, anonymisation enfant) | lecture de TEST, pas de code livré : `new Date(colonne_date).getUTCDate()` relit en UTC un `Date` construit en minuit local → le 30 au lieu du 1er, alors que la base stockait bien le 1er (migration 067). Corrigée (assertion prise côté SQL), verte sous UTC / Alger / Tokyo / Los Angeles, et vérifiée rouge quand on force le jour attendu à « 02 » |

Deux choses à retenir de ce relevé : la **minimisation confidentielle n'a jamais été
fausse** (seule sa preuve était fragile), et le format de fil des colonnes `date` ne
dépend plus de l'hôte sur le chemin public parent (`utcDayInstant`, tableau E4). Le
passage à `YYYY-MM-DD` reste **une décision client non prise** — volontairement, il
serait une rupture de contrat mobile à valider par `check:sync-contract` des deux côtés.
