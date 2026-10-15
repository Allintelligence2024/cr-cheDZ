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
| Tests unitaires | `npm run test:unit` | 46 suites / 967 tests verts (api) + 5 (worker) |
| Migrations | `node scripts/migrate.mjs --status` | 101 appliquées (001→102) |
| Schéma / RLS | `schema-check.mjs --verbose`, `rls-behavior-check.mjs` | verts |
| Indexation tenant | `check-tenant-index.mjs --verbose` | vert |
| Garde RLS | `check-rls-usage.mjs` (avec PG) | 68 accès conformes |
| Env example | `check-env-example.mjs` | vert |
| Manifest Android | `check-android-manifest.mjs` | vert (6 avertissements non bloquants) |
| Gardiens câblés | `check-guards-wired.mjs` | 15 gardiens, vert |
| Contrat documentaire | `claims-contract.test.mjs` | 12/12 |
| Specs e2e | `check-e2e-skeletons.mjs` | 8 fichiers, aucun squelette |
| Chemins SPA | `check-spa-static-paths.mjs` | vert |
| **Gate D (rôles de prod)** | `test-production-roles.mjs` | **vert** (59 suites/contrôles, 0 échec) — preuve capturée ce jour |
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
| #38 | Phase D — RLS effective en prod | **Gate vert** (59 suites/contrôles, preuve capturée ce jour). Reste : plan de rollback (déjà écrit), décision moteur (ADR), câblage CI | Agent : documenter la preuve ; humain : relecture rollback + décision moteur |
| #39 | Phase E — fiabilité worker | E1–E6 implémentés et verts (phase27/28 dans le gate). Reste : décision paie sans prorata (D2), activation E2 (D3), gate monitoring (Docker) | Humain : D2, D3, CI pour monitoring |
| #40 | Phase F — contrat sync mobile bout-à-bout | F1/F3 vérifiés (phase29–34). F2/F4 côté Dart non vérifiés (pas de Flutter ici) | Agent avec Flutter 3.47.1 : `flutter analyze/test`, `check-staff-sync.mjs`, F4 |
| #41 | Phase G — HIGH restants | G1–G5 livrés et verts (gate). Reste : décision `next_org_sequence` (D1), privilèges (frontières), anonymize.sql | Humain : D1 ; agent : frontières privilégiées + anonymize |
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

- API : 46 suites jest, 967 tests, couverture ~20 % (seuils cliquets jest.config.mts). Admin-web : 1 test pour 4 342 LOC (dette documentée).
- E2E Playwright : non bloquant (job `e2e`), honnête.

### 3.3 Actions qualité restantes (agent)

| # | Action | Effort |
|---|---|---|
| Q1 | Preuve lockfile sur clone propre | **Fait** — `git clone` + `npm ci` (920 paquets) → `git status --short` vide, exit 0 |
| Q2 | Frontières privilégiées (authorization-matrix déjà documenté ; vérifier les 40 routes self-service restent justifiées) | **Fait** — matrice v15 à jour, inventaire 205 routes / 40 self-service justifiées ligne à ligne |
| Q3 | H3 : validation téléphone (`algerian-phone.ts`) | **Fait** — les 7 DTO avec champ téléphone portent `@IsAlgerianPhone` ; `import.dto.guardian_phone` est validé dans le service (rapport FR/AR par ligne, pas un 400 global) |
| Q4 | H3 : i18n arabe | **Fait (périmètre vérifiable)** — 369 clés fr/ar symétriques ; `bill.exportExcel`/`bill.exportRequested` traduits en arabe ; `{n}` de `children.imported` réellement interpolé ; rapport d'import affiche `message_ar` en locale ar. Les notifs push/WhatsApp/inbox portent déjà les deux langues et suivent `users.locale` |
| Q5 | H3 : harmonisation timezone | **Fait (lectures/affichages)** — voir E4 ci-dessous ; format de fil des colonnes `date` volontairement non changé (décision client + gate deux côtés) |
| Q6 | Lint : avertissement `MODULE_TYPELESS_PACKAGE_JSON` | **Fait** |
| Q7 | Admin-web : augmenter la couverture (1 test → objectif minimal) | ouvert |

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

---

## 9. Limites de cette session

- Aucun accès aux pages GitHub « Security » (dependabot/code-scanning/secret-scanning) : le jeton renvoie 403. Les alertes éventuelles sont à consulter par un admin dépôt.
- Pas de Docker ni de Flutter/Dart dans l'environnement : tâches Docker/Flutter restent à la CI ou à une machine dédiée.
- Aucun merge effectué (règle du dépôt) ; les changements sont sur la branche de session, à ouvrir en PR.
