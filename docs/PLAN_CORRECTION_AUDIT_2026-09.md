# PLAN DE CORRECTION — Audit 2026-09 (findings C1–C8 + HIGH/MEDIUM/LOW)

> **Document de pilotage exécutable** — à cocher tâche par tâche.
> Fait suite à [`PLAN_EXECUTION_PROCHAINES_PHASES.md`](PLAN_EXECUTION_PROCHAINES_PHASES.md) et
> [`PROMPT_FIX_AUDIT.md`](PROMPT_FIX_AUDIT.md).
> **Version** : 1.0 — 2026-09-13

---

## Principe directeur

L'audit a établi un diagnostic en une phrase : **fort noyau, périmètre fragile**.
Les bugs les plus graves ne sont pas *dans* le code, ils sont **entre** le code :

- contrats jamais testés bout-à-bout (sync mobile : DTO serveur ≠ client Dart),
- features écrites mais jamais invoquées (4 handlers worker sans producteur),
- tests qui prouvent une propriété que la production désactive (RLS validée en
  `NOBYPASSRLS`, prod connectée en superuser).

**Ce plan ne corrige donc pas seulement des lignes : chaque phase ajoute le test
qui aurait attrapé le bug.** Une correction sans son test de non-régression est
considérée comme incomplète.

---

## 0. Ce qui est vérifié vs. ce qui reste à confirmer

### 0.1 Confirmés par lecture de code dans CE dépôt (`cr-cheDZ`, 52 migrations)

| Ref | Finding | Preuve (fichier:ligne) |
|---|---|---|
| **C1** | 6 `@Get` de `staff.controller.ts` sans contrôle de rôle | `roles.guard.ts` : `if (!roles \|\| roles.length === 0) return true` (fail-open) ; `@Get` l.45, 50, 55, 81, 98, 126 sans `@Roles` alors que les 7 `@Post`/`@Patch` ont `@Roles(...WRITE_ROLES)` |
| **C2** | `addRoleAssignment` permet d'attribuer `super_admin` | garde présente `invitations.service.ts:46-47` (`ROLE_FORBIDDEN`), absente de `users.service.ts` (seul contrôle = doublon avec rôle principal) |
| **C4** | Token d'invitation accepté comme token d'accès (7 j) | `jwt-auth.guard.ts` ne lit jamais `purpose` ; `signAccessToken` (`auth.service.ts:540`) n'en émet pas ; même `JwtService` des deux côtés ; invitation porte `{purpose,sub,orgId,role}` et `orgId` → `organizationId` attendu par le garde |
| **C6** | Sync mobile mort-né | `SyncPushDto.device_id` / `SyncPullDto.device_id` = `@IsUUID()` **requis** ; **0 occurrence** de `device_id` dans `apps/staff-mobile/lib` et `apps/parent-mobile/lib` → 400 systématique |
| **C7** | APK release sans accès réseau | `app/src/main/AndroidManifest.xml` : **aucune** `<uses-permission>` ; INTERNET uniquement dans `debug/` et `profile/`. Identique parent + staff |
| **C8** | RLS bypassée en prod | `POSTGRES_USER=creche_app` (`.env.prod`, `.env.prod.example`, compose dev/staging/prod) = superuser créé par l'image Postgres ; `roles.sql` jamais monté (`docker-compose.dev.yml:5` : « plus jamais par docker-entrypoint-initdb.d ») |
| **C8-bis** | `roles.sql` est **inopérant même exécuté** | `IF NOT EXISTS (… rolname='creche_app') THEN CREATE ROLE … NOBYPASSRLS` → le rôle existe déjà (superuser), le bloc est sauté silencieusement |
| **HIGH-1** | Jobs `processing` orphelins à jamais | `jobs_claim_next()` (024:105) ne prend que `status='pending'` ; aucun reaper ; **aucun** `SIGTERM`/`SIGINT` dans `apps/worker/src/` |
| **HIGH-2** | 4 types de jobs jamais planifiés | `JOB_HANDLERS` (`main.ts:307-313`) enregistre `retention_purge`, `video_clips_purge`, `payments_expire`, `send_monthly_invoices` ; **0** INSERT/enqueue hors `tests/` ; aucun `cron`/`setInterval`/scheduler |
| **HIGH-3** | Dates d'export pourries | `main.ts:267` et `main.ts:293` : `String(row.date).slice(0,10)` → `"Sun Sep 13"` (reproduit en Node). La ligne 95 fait correctement `.toISOString?.().slice(0,10)` |
| **HIGH-4** | Auto-DoS sur l'authentification | `trust proxy` **absent** de tout `apps/api/src` et de l'infra ; `rate-limit.guard.ts:25` : `const ip = request.ip ?? 'unknown'` → derrière nginx, tous les clients partagent l'IP du proxy |
| **HIGH-5** | Staging ne démarre jamais | `docker-compose.staging.yml:34-40` : `migrate` monte `scripts/`, `infrastructure/database`, `package.json` — **pas `tests/`** — puis exécute `node tests/tenant-isolation/schema-check.mjs` → exit ≠ 0 → api/worker jamais lancés |
| **HIGH-6** | `notif_queue_finish` marque « sent » sans livraison | 042:43-46 : `IF p_success THEN status='sent', failure_reason=NULL`. Or `main.ts:487` appelle `notif_queue_finish($1, true, 'PUSH_NOT_CONFIGURED_OR_NO_DEVICE')` → le motif est **ignoré** et `failure_reason` **effacé**. Contredit le commentaire de `main.ts:314-318` |
| **HIGH-7** | Facturation mensuelle ignore `start_date` | `start_date` : 0 occurrence dans `apps/worker/src/main.ts` |

### 0.2 Corrigés par rapport à l'audit initial

Trois claims de l'audit ne s'appliquent **pas** tels quels à ce dépôt :

1. **« Duplication monorepo : racine = copie périmée (48 vs 52 migrations, NestJS 10 vs 11) » → FAUX ici.**
   Ce dépôt a une seule arborescence (`apps/`, `packages/`, `infrastructure/`) avec **52** migrations
   (jusqu'à `052_fix_webhook_amount_guard.sql`). Pas de second arbre. Ce finding provient
   vraisemblablement d'un autre workspace (`p3-crcheDZ`). **Action « supprimer la copie racine » : sans objet.**

2. **C3 (path traversal) → partiellement mitigé.** La migration `049_storage_key_safety.sql` durcit
   déjà la base : caractères sûrs `[A-Za-z0-9_\-./]`, `..` interdit, slash initial interdit, ≤ 500 —
   sur `video_clips`, `media_assets`, `staff_documents`, `report_exports`.
   **Ce qui reste vrai** : `RegisterMediaDto.storage_key` n'a que `@IsString/@MinLength(3)/@MaxLength(500)`,
   donc **aucune exigence de préfixe tenant** (ni DTO, ni SQL). Le risque cross-tenant subsiste,
   le risque traversal non.

3. **C1 surexpose `list()`.** `staff.service.ts:31` fait un SELECT **explicite** (`id, user_id,
   employee_number, qualification, contract_type, hire_date, is_active, email, first_name,
   last_name, active_assignments`) → `GET /staff` ne fuit ni `national_id`, ni `cnas_number`, ni
   `base_salary`. En revanche `getById()` (l.50) fait `SELECT sp.*` → **là tout fuit**, salaire inclus.
   Le vecteur précis est `GET /staff/:id`, pas la liste. Le bug de contrôle d'accès, lui, est réel
   sur les 6 endpoints.

### 0.3 Non vérifiés à ce jour (à confirmer en Phase A)

C5 (`room_id` non validé, `import.service.ts:156`), RLS `organization_id IS NULL OR …` sur
`feature_flags`/`background_jobs`/`outbox`, régression GUC 029 vs 018, race trigger 023
(pas de `FOR UPDATE` sur payment), PIN/OTP parent sans check de statut, compteurs de lockout
non atomiques, énumération de comptes, push sans `can_view_journal`, exports privacy
(notes de journal + dossier médical par accountant), DPIA auto-approuvable, `anonymize.sql`
incomplet, OpenAPI < 10 %, `/metrics` public, `next_org_sequence` non hashé, payroll sans
prorata, invitation token affiché sans garde `NODE_ENV`, `STORAGE_BACKEND` divergent,
+ l'ensemble des MEDIUM/LOW.

**Règle : aucun de ces items ne passe en correction tant qu'il n'est pas reproduit.**
L'audit initial annonçait ~3 faux positifs sur ~110 claims ; on a déjà trouvé 3 claims
non applicables. La vérification préalable est donc rentable.

---

## Ordre des phases et justification

| Phase | Objet | Pourquoi cet ordre |
|---|---|---|
| **A** | Restaurer un signal CI fiable | Impossible de piloter 8 phases si `security` est rouge partout pour une raison sans rapport |
| **B** | Débloquer le mobile (C7) | PR #34 ouverte et mergeable ; B4/B5 de l'issue #8 en dépendent |
| **C** | Critiques sécurité enfants (C1, C2, C4) + C3/C5 | Données enfants + salaires ; correctifs locaux, faible risque de casse |
| **D** | Restaurer la garantie multi-tenant en prod (C8) | Le plus grave architecturalement, mais **le plus risqué opérationnellement** : se fait après C, avec sauvegarde et rollback |
| **E** | Fiabilité worker (jobs orphelins, scheduler, notif, dates, facturation) | Dépend de D : le worker doit d'abord tourner avec le bon rôle pour que les tests soient représentatifs |
| **F** | Contrat de sync mobile bout-à-bout (C6) | Le plus gros chantier ; inutile avant B (manifest) et E (jobs) |
| **G** | HIGH auth/RLS restants | Accumulés, à traiter par grappes homogènes |
| **H** | Staging + dette MEDIUM/LOW | Staging doit marcher **avant** H pour pouvoir valider H |

> ⚠️ **Note sur D** : l'audit plaçait C8 en priorité n°1. C'est le bon diagnostic de gravité,
> mais le mauvais ordre d'exécution : basculer la prod en rôle non-superuser casse les migrations
> si `creche_migrator` n'est pas câblé d'abord. On corrige donc **C (rapide, local) puis D (lent, risqué)**.
> Si la prod est déjà déployée avec de vraies données enfants, ajouter en tête de D une décision
> explicite : corriger en place, ou repartir d'une base propre.

---

# PHASE A — Restaurer un signal CI fiable

**Objectif** : `npm audit --omit=dev` → 0 vulnérabilité, et que ce verdict signifie quelque chose.

> **Statut : A1 FAIT et VALIDÉ le 2026-09-13.** A2 partiellement bloqué (permissions).
> Détails d'exécution et découvertes en §A3.

### A1. Régression de dépendances (issue #35) — *bloquant pour tout le reste* ✅ FAIT

`main` est vulnérable **sans qu'aucun commit n'ait changé** : les advisories ont été publiés le
08/09 *après* le dernier run vert (11:26 UTC). `npm audit` interroge la base en direct.

- [x] `apps/api/package.json` : `"nodemailer": "^9.0.3"` → `"^9.1.1"`
      (couvre GHSA-8m3c-c648-2xjj, GHSA-wmmp-3585-3rmp, GHSA-2x7j-588g-ccc2, GHSA-cc9r-2j5m-2m83)
- [x] `package.json` racine — étendre `overrides` :
      ```diff
           "@nestjs/platform-express": {
      -      "body-parser": "1.20.6"
      +      "body-parser": "1.20.8",
      +      "multer": "2.3.0"
           },
           "express": {
      -      "body-parser": "1.20.6"
      +      "body-parser": "1.20.8"
           },
      ```
      (couvre CVE-2026-77078 / GHSA-wc9g-mqfw-jrwm + 3 autres sur `multer` 2.2.0)
- [x] **Étape non prévue au plan, devenue obligatoire** : bump `body-parser` 1.20.6 → **1.20.8**
      (voir §A3.2 — le pin à 1.20.6 tire `qs` 6.15.3 et faisait **régresser** l'audit)
- [x] Lockfile régénéré (voir §A3.1 — une régénération **complète** était la seule voie)
- [x] **`npm audit fix` n'a PAS été utilisé** : il propose `@nestjs/core@7.5.5`, un downgrade
      de 11.x vers 7.x qui casserait l'API
- [x] Tests de non-régression — voir §A3.3
- [x] **GATE atteint** : `npm audit --omit=dev` → **`found 0 vulnerabilities`**

### A2. Empêcher que ça se reproduise silencieusement — ⚠️ BLOQUÉ (permissions)

Le vrai problème n'est pas la vulnérabilité, c'est qu'**elle est passée inaperçue** :
`security` n'est pas requis par la branch protection (seul `database` l'est, cf. en-tête de
`flutter.yml`), et l'audit planifié ne tourne que le lundi 05:17 UTC.

- [ ] **ACTION HUMAINE** — Ajouter `security` aux `required_status_checks` de la branch protection
      `main`. Vérifié le 2026-09-13 : lecture → **403** `Resource not accessible by integration`,
      écriture → **404**. Le bot n'a pas la permission `administration`
- [ ] **ACTION HUMAINE** — Ajouter `workflow_dispatch` + `schedule` quotidien sur le job `security`
      de `ci.yml`. Bloqué par la permission `workflows` manquante, **déjà documentée** dans
      [`CI-RESTORE.md`](CI-RESTORE.md) : tout push touchant `.github/workflows/*` est refusé
      (« refusing to allow a GitHub App to create or update workflow »). Le patch exact est en §A3.4
- [ ] **ACTION HUMAINE** — `security-audit.yml` : le label `security` a été créé le 2026-09-13 ;
      la clause `|| true` de `gh issue create` masque toujours un échec de création d'issue.
      Même blocage `workflows`
- [ ] **GATE (à faire après les 3 items ci-dessus)** : une PR de test avec une dépendance
      vulnérable volontaire doit être **bloquée**

### A3. Exécution réelle du 2026-09-13 — découvertes à retenir

#### A3.1 Le lockfile committé n'est PAS reproductible (piège majeur)

**Symptôme** : avec `package-lock.json` présent, `npm install` (10.9.8 / Node 22) **refuse de
re-résoudre** et reproduit l'arbre existant, en ignorant les changements de manifests. Il accepte
même un lockfile objectivement incohérent :

```
packages["apps/api"].dependencies.nodemailer          = "^9.1.1"   (contrainte)
packages["apps/api/node_modules/nodemailer"].version  = "9.0.3"    (résolution)
```

Commandes toutes inefficaces, renvoyant « up to date » : `npm install`,
`npm install --package-lock-only`, `npm update nodemailer -w @creche/api`,
`npm install nodemailer@^9.1.1 -w apps/api`.

**Tentative de chirurgie ciblée** (retirer seulement les entrées `multer`/`nodemailer`/
`body-parser` du lockfile) → **échec** : npm a supprimé `multer` de l'arbre sans le remplacer
(`platform-express` déclarait `multer 2.2.0` sans entrée correspondante), et `npm audit` a alors
renvoyé `0 vulnerabilities` **parce qu'il n'y avait plus rien à auditer**. Faux vert.

**Seule voie qui fonctionne** : `rm -rf node_modules package-lock.json && npm install`.

**Conséquence à connaître** : cette régénération fait bouger **170 paquets** (AWS SDK
3.1101→3.1131, Jest 30.4→30.5, `@opentelemetry/api-logs` **0.57.2→0.220.0**, 195 entrées
ajoutées / 236 retirées dont `@sentry/*` et `react-router`), et l'arbre passe de 1021 à
923 paquets. **Ce n'est donc pas un simple bump de sécurité** : la validation de §A3.3 est
indispensable, et le reviewer doit savoir ce qu'il merge.

> À traiter en Phase H : rendre le lockfile reproductible (vérifier s'il a été généré avec un
> npm/pnpm différent — le dépôt contient un `pnpm-workspace.yaml` alors que la CI utilise `npm ci`).

#### A3.2 Le pin `body-parser: 1.20.6` était périmé et faisait régresser l'audit

Une fois `multer` et `nodemailer` corrigés, l'audit remontait encore **2 moderate** :

```
qs 2.2.5 - 6.15.3   →   node_modules/body-parser/node_modules/qs
body-parser 1.20.5 - 1.20.6   (depends on vulnerable qs)
```

Chaîne causale vérifiée :

| Fait | Valeur |
|---|---|
| `qs` 6.15.x publié | `6.15.0, 6.15.1, 6.15.2, 6.15.3` — **toutes vulnérables**, aucune 6.15.4+ |
| `body-parser@1.20.6` exige | `qs: "~6.15.1"` → ≥6.15.1 <6.16.0 → **ne peut pas** prendre 6.16.0 |
| `body-parser@1.20.8` exige | `qs: "~6.16.0"` → résout à **6.16.0** ✅ |
| `express@5.2.1` exige | `body-parser: "^2.2.1"` |

Donc le pin `1.20.6` **verrouillait structurellement** `qs` 6.15.3. Un `override` scopé
`{"body-parser": {"qs": "6.16.0"}}` a été testé : **sans effet** (npm ne force pas hors de la
contrainte déclarée dans ce cas).

**Deux découvertes accessoires** :

1. **L'override `@nestjs/platform-express.body-parser` est inerte depuis l'origine** :
   `@nestjs/platform-express@11.1.28` ne déclare **pas** `body-parser` dans ses dépendances
   (`cors, express, multer, path-to-regexp, tslib` uniquement). L'override ne cible donc rien.
   Il a été bumpé à 1.20.8 par cohérence, mais il pourrait être **supprimé**.
2. **Le pin `express.body-parser: 1.20.x` force un downgrade majeur** : Express 5.2.1 veut
   `^2.2.1` et reçoit 1.20.8. Sur `main` (avant ce correctif) l'arbre avait naturellement
   `body-parser` **2.3.0** + `qs` 6.16.0 — donc **l'override est la cause de la régression qs**,
   pas son remède.

**Décision retenue** : bump minimal 1.20.6 → 1.20.8 (préserve l'intention du pin 1.x, corrige `qs`).
**Décision à revoir en Phase H** : supprimer purement les deux overrides `body-parser` et laisser
Express 5 utiliser sa 2.x naturelle — plus propre, mais l'intention du pin d'origine est inconnue
(introduit par PR #33, aucun commentaire explicatif).

#### A3.3 Validation de non-régression (exécutée, pas supposée)

Environnement : Node 22.22.3 / npm 10.9.8, PostgreSQL **18.4** embarqué (`run_pg.mjs`, port 54329),
mêmes variables d'environnement que le job CI `database`.

| Contrôle | Résultat |
|---|---|
| `npm audit --omit=dev` | ✅ **found 0 vulnerabilities** |
| Arbre physiquement vérifié | ✅ `multer` 2.3.0 (hoisté, `require.resolve` OK depuis `apps/api`), `body-parser` 1.20.8, `nodemailer` 9.1.1, **une seule** entrée `qs` = 6.16.0, `express` 5.2.1 |
| `npm run typecheck` | ✅ 5 workspaces (prod-config, admin-web, api, support-console, worker) |
| `npm run build` | ✅ les 5 workspaces |
| `npm run lint` (`--max-warnings=0`) | ✅ 0 warning |
| `npm run test:unit` | ✅ 12/12 |
| `scripts/migrate.mjs` (reset → apply → status) | ✅ **52** migrations, checksums cohérents |
| `scripts/seed.mjs` | ✅ |
| `schema-check.mjs --verbose` | ✅ RLS complète, contraintes financières, curseur monotone |
| `rls-behavior-check.mjs` (rôle `NOBYPASSRLS`) | ✅ **9/9** — gate de l'architecture |
| `run-isolation-suites.sh` | ✅ **28/28 suites vertes** (isolation 31, phase3 40, phase4 38, phase5 28, phase6 34, phase7 34, phase8-billing 55, … phase24 26) + garde anti-bypass RLS : 61 accès `pool.query` conformes |

**Note sur le test « envoi multipart réel » prévu au plan** : devenu sans objet —
`multer` n'est **utilisé nulle part** dans le code (`0` occurrence de `FileInterceptor`,
`FilesInterceptor`, `MulterModule`, `UploadedFile` dans `apps/api/src` et `apps/worker/src`).
C'est une dépendance **transitive dormante** de `@nestjs/platform-express`. Le risque de
régression 2.2.0 → 2.3.0 est donc quasi nul, mais le bump reste nécessaire pour l'audit.

**Test nodemailer** (réellement utilisé — `privacy.service.ts:268`, import dynamique +
`sendMail`) : `createTransport` validé avec exactement les options du service
(`host`/`port`/`secure`/`auth`) → charge en 9.1.1, `sendMail` présent.
Un envoi SMTP de bout en bout reste à faire quand un serveur SMTP de test sera disponible.

> Les `ERROR` visibles dans le log PostgreSQL pendant les suites sont les **tests négatifs
> attendus** (violations RLS, `INVOICE_IMMUTABLE`, `PAYMENT_ALLOCATION_EXCEEDS_*`,
> `video_clips_storage_key_safe` rejetant `../escape.jpg` et `/absolu/secret.mp4`) —
> c'est la preuve que les garde-fous fonctionnent, pas des échecs.

#### A3.4 Patch prêt à appliquer pour A2 (bloqué `workflows`)

À appliquer manuellement, ou après octroi de la permission `workflows` à la GitHub App.

`.github/workflows/ci.yml` — détecter les régressions d'advisory **sans** push :

```diff
 on:
   push:
     branches: [main]
   pull_request:
+  schedule:
+    - cron: '23 6 * * *'   # quotidien 06:23 UTC — décalé de security-audit.yml (lundi 05:17)
+  workflow_dispatch: {}
```

> ⚠️ Un `schedule` sur `ci.yml` rejouerait **tous** les jobs (dont `database`, ~14 min).
> Pour ne rejouer que l'audit, préférer un workflow dédié, ou ajouter
> `if: github.event_name != 'schedule' || matrix.job == 'security'`.

`.github/workflows/security-audit.yml` — ne plus masquer un échec de création d'issue :

```diff
-            --label security || true
+            --label security
```

Branch protection (via UI ou API avec un token `administration`) :

```
PUT /repos/Allintelligence2024/cr-cheDZ/branches/main/protection/required-status-checks
  strict: false
  contexts: ["database", "security"]
```


---

# PHASE B — Débloquer le mobile (C7)

**Objectif** : qu'un `flutter build apk --release` produise un APK qui parle à l'API.

### B1. Permission INTERNET en release — PR #34

État vérifié : `main/AndroidManifest.xml` n'a **aucune** permission ; `debug/` et `profile/`
ont INTERNET. C'est le défaut du template `flutter create`. La CI ne peut pas le voir :
`flutter-check` ne fait que `pub get` + `analyze`.

- [ ] Dans `apps/parent-mobile/android/app/src/main/AndroidManifest.xml` **et**
      `apps/staff-mobile/...`, ajouter avant `<application>` :
      ```xml
      <uses-permission android:name="android.permission.INTERNET"/>
      ```
- [ ] Les déclarations dans `debug/` et `profile/` deviennent redondantes mais inoffensives
      (le manifest merger déduplique) — on peut les laisser
- [ ] Évaluer `android.permission.ACCESS_NETWORK_STATE` (utile pour la bannière offline du
      SyncEngine) et `POST_NOTIFICATIONS` (Android 13+, requis pour les push)
- [ ] **GATE** : `flutter build apk --release` puis `aapt dump permissions app-release.apk`
      doit lister `android.permission.INTERNET`

### B2. Test de non-régression (le vrai livrable)

Un manifest correct aujourd'hui peut redevenir faux au prochain `flutter create`.

- [ ] Ajouter au workflow `flutter.yml` une étape qui **vérifie le manifest**, pas seulement l'analyse :
      ```
      grep -q 'android.permission.INTERNET' apps/*/android/app/src/main/AndroidManifest.xml
      ```
      (échoue si la permission disparaît de `main/`)
- [ ] Documenter dans `docs/pilot/` que la validation device (B4 de l'issue #8) doit se faire
      **en release**, pas en debug — sinon ce bug reste invisible

> 🔒 **Contrainte de session** : la PR #34 vit sur `feat/mobile-android-scaffolding`. Une session
> Arena est verrouillée sur sa propre branche et ne peut pas pousser dessus. B1 se fait soit par
> le propriétaire du dépôt, soit dans une session dédiée à cette branche.

---

# PHASE C — Critiques sécurité (C1, C2, C4, C3, C5)

**Objectif** : aucun parent ne lit de salaire, aucun director ne devient `super_admin`,
aucun token d'invitation ne sert de session.

### C1. Contrôle d'accès sur `staff.controller.ts`

Deux défauts distincts — corriger **les deux** :

- [ ] **Fail-open du garde** : `roles.guard.ts` renvoie `true` quand aucune metadata n'est trouvée.
      C'est le défaut structurel. Options, par ordre de préférence :
      1. **Fail-closed ciblé** : ajouter `@Roles(...READ_ROLES)` explicite sur les 6 `@Get`
         (`list`, `expiring`, `getById`, `documents`, `assignments`, `attendance`) — rapide, lisible
      2. **Fail-closed global** : un `@Roles` au niveau **classe** (`@Controller('staff')` +
         `@Roles(...)` sur le contrôleur) que les handlers en écriture surchargent — le garde lit
         déjà handler **puis** classe (`roles.guard.ts:14-16`), donc c'est supporté
      3. **Inventaire** : script qui liste tous les handlers HTTP sans `@Roles` ni `@Public` —
         c'est le seul moyen de savoir si `staff` est un cas isolé ou un pattern
- [ ] **Fuite par wildcard** : `staff.service.ts:50` fait `SELECT sp.*` → remplace par une liste
      explicite de colonnes, et **retire `national_id`, `cnas_number`, `base_salary`, `phone`**
      des réponses destinées aux rôles non-RH
- [ ] Décider la matrice d'autorisation et la documenter : qui lit `base_salary` ?
      (`super_admin`, `director`, `accountant` ?) — l'audit signale déjà un accountant qui exporte
      des dossiers médicaux, donc la matrice est floue au-delà de staff
- [ ] **Test de non-régression** : dans `tests/tenant-isolation/`, un scénario
      « rôle `parent` appelle `GET /staff/:id` → 403 » et « la réponse ne contient pas les clés
      `national_id`/`cnas_number`/`base_salary` ». **Ce test doit échouer avant le correctif.**

### C2. Escalade de rôle via `addRoleAssignment`

- [ ] Dans `users.service.ts` `addRoleAssignment` : refuser `super_admin`, sur le modèle de
      `invitations.service.ts:46-47` (`ROLE_FORBIDDEN`, 403)
- [ ] Mieux : **centraliser** la garde. Un helper `assertRoleAssignable(role_slug)` appelé par
      *tous* les chemins d'attribution (invitations, users, migrations de rôle) — sinon le prochain
      endpoint ajouté réintroduira le trou. C'est exactement le pattern « module voisin oublié »
- [ ] Vérifier `removeRoleAssignment` et tout autre point d'écriture sur `role_assignments`
- [ ] **Test** : director appelle `POST /users/:id/roles` avec le `role_id` de `super_admin` → 403

### C4. Confusion de tokens (le plus subtil des trois)

Un token d'invitation (7 j, signé avec le même secret, portant `orgId`) est accepté comme
token d'accès par `JwtAuthGuard`, puis autorisé par `RolesGuard` sur le rôle qu'il embarque.

- [ ] **Émettre un `purpose` sur TOUS les tokens** : `signAccessToken` (`auth.service.ts:540`)
      doit signer `purpose: 'access'` ; refresh → `'refresh'` ; invitation → `'invitation'` (déjà fait)
- [ ] **Vérifier le `purpose` attendu par type de route.** Deux approches :
      1. `JwtAuthGuard` exige `purpose === 'access'` par défaut, avec un opt-out explicite
         (`@TokenPurpose('invitation')`) pour les routes d'acceptation d'invitation
      2. Mieux : **ne pas partager le secret** — un `JwtService` distinct (ou un `aud`/`iss`
         différent) pour les tokens d'invitation. La séparation cryptographique est plus robuste
         qu'une vérification de champ
- [ ] Vérifier que `acceptInvitation` (`auth.service.ts:393-408`) continue de fonctionner — il
      contrôle déjà `payload.purpose !== 'invitation'`, donc il est du bon côté
- [ ] **Rejouer le scénario d'attaque en test** : récupérer un token d'invitation, l'utiliser en
      `Authorization: Bearer` sur `PATCH /users/:id/2fa` → doit être **401**. C'est le cas concret
      cité par l'audit (activation 2FA sur le compte de la victime avant acceptation)
- [ ] **GATE** : aucun token dont `purpose ≠ 'access'` ne passe `JwtAuthGuard` sur une route non publique

### C5. Validation `room_id` dans l'import (à confirmer d'abord)

- [ ] **Reproduire avant de corriger** : `import.service.ts:156` — vérifier si un `room_id`
      appartenant à une autre organisation peut être inséré. La RLS devrait le bloquer **si** le
      rôle est `NOBYPASSRLS` (voir Phase D) — donc ce bug est peut-être un symptôme de C8, pas
      un bug autonome. À trancher après D
- [ ] Si confirmé : validation explicite du `room_id` dans le tenant courant + erreur ligne par
      ligne FR/AR cohérente avec le reste de l'import

### C3. Préfixe tenant sur `storage_key`

- [ ] `RegisterMediaDto.storage_key` : exiger un préfixe tenant. Soit
      `@Matches()` avec le tenant injecté (difficile en DTO pur), soit — mieux — **validation dans
      le service** après résolution du tenant : la clé doit commencer par `{organization_id}/`
- [ ] **Ne pas faire confiance à la clé du client** : la politique la plus sûre est de **générer**
      la clé côté serveur (`{org_id}/{child_id}/{uuid}`) et de ne laisser au client que le contenu.
      Vérifier si c'est déjà le cas pour `video_clips` (la regex `^(?!.*\.\.)[\w\-./]{1,200}$` citée
      par 049 suggère que oui) et aligner `media_assets` dessus
- [ ] Contrainte SQL en défense en profondeur (comme 049) : la clé doit préfixer par le
      `organization_id` de la ligne — un trigger ou un `CHECK` ne peut pas voir le GUC facilement,
      donc privilégier la génération serveur
- [ ] **Test** : org A enregistre un média avec une clé préfixée org B → 400/403 ; et une URL
      présignée générée pour A ne résout pas un objet de B

---

# PHASE D — Restaurer la garantie multi-tenant en production (C8)

**Objectif** : que la prod bénéficie réellement des 28 suites d'isolation qui la valident.

> **C'est la phase la plus grave et la plus risquée.** À faire avec sauvegarde vérifiée
> ([`BACKUP-RUNBOOK.md`](BACKUP-RUNBOOK.md)) et plan de rollback écrit **avant** de commencer.

### D0. Décision préalable (à trancher explicitement)

- [ ] La prod contient-elle déjà de vraies données enfants ?
      - **Non** → on peut recréer la base proprement, beaucoup plus simple
      - **Oui** → correction en place, avec fenêtre de maintenance
- [ ] Qui est propriétaire des tables aujourd'hui ? Si `creche_app` (superuser) est propriétaire,
      le transfert de propriété vers `creche_migrator`/`postgres` est un prérequis

### D1. Séparer les rôles : superuser ≠ migrateur ≠ applicatif

Le dépôt **prévoit déjà** cette séparation (`roles.sql` crée `creche_migrator` pour le DDL et
`creche_app` en `NOBYPASSRLS` pour l'app). Elle n'est simplement jamais appliquée.

- [ ] **Compose** : ne plus faire de l'utilisateur applicatif le superuser d'init. Pattern standard :
      ```yaml
      POSTGRES_USER: postgres          # superuser, sert UNIQUEMENT à l'init
      POSTGRES_DB: creche
      ```
      et `DATABASE_URL` de l'api/worker pointe vers `creche_app`
- [ ] **Câbler `roles.sql`** : soit via `docker-entrypoint-initdb.d` (uniquement sur base vierge),
      soit — préférable, car reproductible — via un service `bootstrap-roles` qui dépend de
      `postgres: healthy` et que `migrate` attend
- [ ] **Corriger `roles.sql`** : le `IF NOT EXISTS` actuel est un piège (voir C8-bis). Remplacer par
      un upsert idempotent qui garantit l'état final, pas seulement la création :
      ```sql
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='creche_app') THEN
          CREATE ROLE creche_app LOGIN NOBYPASSRLS NOSUPERUSER;
        ELSE
          ALTER ROLE creche_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
      ```
- [ ] Mots de passe distincts pour `creche_app` et `creche_migrator` (secrets → [`OPERATIONS-SECRETS.md`](OPERATIONS-SECRETS.md))
- [ ] Le runner de migrations (`scripts/migrate.mjs`) doit utiliser `creche_migrator`, l'api/worker `creche_app`

### D2. Prouver que la RLS s'applique vraiment en prod

C'est le cœur du problème : les tests valident une propriété que la prod désactive.

- [ ] Ajouter un **démarrage refusé** si le rôle applicatif est superuser — garde-fou dans
      `apps/api` au boot :
      ```sql
      SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user
      ```
      → si `rolsuper` ou `rolbypassrls` est vrai en environnement `production`, **l'API refuse de
      démarrer** avec un message explicite. C'est le seul moyen de garantir que la régression
      ne revienne pas silencieusement
- [ ] Le même check dans `scripts/migrate.mjs` (le migrateur **peut** avoir plus de droits, mais
      ne doit jamais être utilisé par l'app)
- [ ] Faire tourner **les 28 suites de `tests/tenant-isolation/` contre la configuration de prod**
      (mêmes rôles, mêmes grants) et non contre le superuser. C'est le GATE de cette phase
- [ ] Rejouer `schema-check.mjs` et `rls-behavior-check.mjs` (8/8 attendu) avec le rôle `creche_app`
- [ ] **GATE** : `tests/tenant-isolation` vert **en utilisant les rôles de prod**. Tant que ce gate
      n'est pas vert, D n'est pas terminé — et C5 ne peut pas être tranché

### D3. Vérifier les grants

- [ ] `roles.sql` contient `GRANT … ON ALL TABLES IN SCHEMA public` — à **rejouer après toute
      migration ajoutant une table** (le commentaire le dit déjà). Automatiser : l'appeler en fin
      de `migrate.mjs`, sinon la 53e migration créera une table que `creche_app` ne peut pas lire
- [ ] Vérifier les `GRANT EXECUTE` sur les fonctions `SECURITY DEFINER` (015, 016, 024, 042, 051…)
- [ ] **Test** : après une migration ajoutant une table fictive, l'api peut la lire sans intervention manuelle

---

# PHASE E — Fiabilité du worker

**Objectif** : aucun job perdu, aucun faux statut, et les jobs promis **existent vraiment**.

### E1. Jobs orphelins (perte silencieuse de travail)

`jobs_claim_next()` ne reprend que `status='pending'`. Un worker tué pendant `processing`
abandonne le job **définitivement**.

- [ ] **Reaper** : fonction SQL `jobs_reap_stale(p_timeout interval)` qui repasse en `pending`
      (ou en `failed` si `attempts >= max_attempts`) tout job `processing` dont `started_at` est
      plus ancien que le timeout. Migration **053** (les 001-052 sont immuables — ADR-007)
- [ ] **Arrêt gracieux** : handlers `SIGTERM`/`SIGINT` dans `apps/worker/src/main.ts` — finir le job
      en cours, ne plus en réclamer, puis sortir. Sans ça, chaque déploiement Docker abandonne un job
      (Docker envoie SIGTERM puis SIGKILL après le grace period)
- [ ] Boucle de reaper périodique dans le worker (ou job dédié, voir E2)
- [ ] **Test de non-régression** : lancer un job long, tuer le worker (SIGKILL), vérifier que le job
      est repris après le timeout. **Ce test doit échouer aujourd'hui**
- [ ] Vérifier `docker-compose.prod.yml` : `stop_grace_period` suffisant pour l'arrêt gracieux

### E2. Le scheduler manquant — bug systémique

4 handlers enregistrés, **0 producteur**. Conséquence concrète : la purge DPIA 30 j
(`video_clips_purge`), promise par `video.service.ts:23` et `:206`, **n'existe pas** →
des vidéos d'enfants sont conservées indéfiniment. C'est un enjeu loi 25-11, pas seulement technique.

- [ ] **Choisir un mécanisme** et l'écrire dans un ADR (`docs/adr/`) :
      1. **Boucle interne au worker** (`setInterval` + verrou `SELECT … FOR UPDATE SKIP LOCKED` sur
         une table `scheduler_ticks`) — simple, mais multi-réplicas = risque de doublon
      2. **Cron externe** (cron hôte / Kubernetes CronJob) qui insère les jobs — plus robuste en
         multi-réplicas, mais ajoute une dépendance d'exploitation
      3. **pg_cron** — élégant mais dépend d'une extension non présente dans l'image Postgres standard
      Recommandation : **(1)** avec verrou en base, tant que le worker est mono-réplica ;
      documenter le switch vers (2) si passage multi-réplica
- [ ] **Définir les fréquences** (à valider avec le métier) :
      | Job | Fréquence proposée | Justification |
      |---|---|---|
      | `video_clips_purge` | quotidien | purge DPIA 30 j — tolérance 24 h |
      | `retention_purge` | quotidien | `RETENTION_DAYS` défaut 1825 j — pas urgent |
      | `payments_expire` | horaire | expiration SATIM à 72 h |
      | `send_monthly_invoices` | mensuel (1er, après minuit) | idempotent, donc rejeu sûr |
      | `jobs_reap_stale` (E1) | toutes les 5 min | reprise des orphelins |
- [ ] **Idempotence vérifiée** pour chacun avant de le planifier — `send_monthly_invoices` est
      déjà documenté idempotent (`main.ts:116`) et testé (`phase11-hardening.api.test.mjs:144`)
- [ ] **GATE** : un test d'intégration qui avance l'horloge (ou injecte des `scheduled_at` passés)
      et vérifie que chaque job **s'exécute réellement**. Aujourd'hui rien ne prouve qu'ils tournent
- [ ] **Alerte** : si un job planifié n'a pas tourné depuis N périodes → notification. Un scheduler
      silencieux qui s'arrête est pire que pas de scheduler, car la purge DPIA semble assurée

### E3. Faux statut de notification (HIGH-6)

`main.ts:487` passe `p_success=true` **avec** un `failure_reason` — mais `notif_queue_finish`
ignore le motif quand `p_success=true` et met `failure_reason=NULL`. Le commentaire du worker
(`main.ts:314-318`) promet exactement l'inverse de ce que le code fait.

- [ ] **Décider la sémantique** et aligner les deux bouts. Deux options :
      1. **Trois états** : `sent` / `failed` / `skipped` (ou `undelivered`). Une notification
         non poussée mais présente dans l'inbox n'est ni un succès ni un échec — c'est le cas réel ici
      2. **Étendre la fonction** : `notif_queue_finish(p_id, p_success, p_failure_reason)` conserve
         `failure_reason` même quand `p_success=true`. Migration **054** (042 est immuable)
- [ ] Le commentaire de `main.ts:314-318` décrit l'option 2 — c'est donc probablement l'intention
      d'origine, perdue à l'implémentation
- [ ] **Test** : notification sans device configuré → statut **et** `failure_reason` cohérents,
      vérifiés en base. Le test actuel ne peut pas attraper ça puisque le worker et la fonction
      sont d'accord pour mentir

### E4. Dates d'export (HIGH-3)

- [ ] `main.ts:267` et `main.ts:293` : remplacer `String(row.date).slice(0,10)` par un formatage
      explicite. **Piège à éviter** : `.toISOString().slice(0,10)` (utilisé ligne 95) est correct
      pour un `timestamptz` mais **décale d'un jour** un `DATE` pg en timezone négatif, car
      node-postgres parse un `DATE` en minuit **local** puis `toISOString()` repasse en UTC
- [ ] **Décider une politique unique** (l'audit signale déjà « timezone UTC+1 vs UTC éparpillé ») :
      soit parser les `DATE` en string via un `pg.types.setTypeParser(1082, v => v)` — le plus sûr,
      la valeur arrive déjà en `YYYY-MM-DD` — soit formater explicitement
      (`getFullYear/getMonth/getDate` + `padStart`)
- [ ] Centraliser dans un helper (`packages/` ?) plutôt que 3 implémentations divergentes
- [ ] **Test** : export contenant un `DATE` au 1er du mois → la cellule vaut `YYYY-MM-01`, pas
      `Mon Sep 01`. Tester avec `TZ` négatif **et** positif pour attraper le décalage
- [ ] Vérifier `pdf.ts:68` (`Échéance : ${data.dueDate}`) qui consomme la ligne 95

### E5. Facturation mensuelle ignore `start_date` (HIGH-7)

On facture un enfant avant son arrivée.

- [ ] Confirmer le périmètre : `sendMonthlyInvoices` (`main.ts:116`) itère les contrats actifs sans
      regarder `start_date` (0 occurrence dans `main.ts`)
- [ ] Décider la règle métier **avec le client** — ce n'est pas qu'un bug technique :
      - arrivée en cours de mois → **prorata** ? mois entier ? rien le premier mois ?
      - l'audit signale aussi « payroll sans prorata » : même question pour les salaires
      - décret 19-253 impose-t-il quelque chose sur la facturation ? (voir `docs/regulatory/`)
- [ ] Implémenter le prorata si retenu, en cohérence avec les triggers d'intégrité financière
      (C04) et l'immuabilité des factures payées
- [ ] **Test** : contrat démarrant le 15/09 → facture de septembre au prorata (ou nulle selon la
      règle retenue), **pas** un mois plein. Et un contrat démarrant le 01/10 ne génère rien en septembre

### E6. Export date-simple bloqué en `pending`

- [ ] Reproduire : un export avec une date simple reste `pending` à vie
- [ ] Vérifier le lien avec E4 (même famille de bug de parsing de date) — probable
- [ ] Ajouter un timeout/statut `failed` explicite plutôt qu'un `pending` éternel : un export
      bloqué doit être visible, pas silencieux

---

# PHASE F — Contrat de sync mobile bout-à-bout (C6)

**Objectif** : que le mobile se synchronise **vraiment**. C'est le plus gros chantier.

### F0. Diagnostic complet du contrat (avant d'écrire du code)

L'audit décrit 4 défauts distincts. Les vérifier un par un :

- [ ] **`device_id` absent du client** : `SyncPushDto.device_id` et `SyncPullDto.device_id` sont
      `@IsUUID()` **requis** ; `device_id` apparaît **0 fois** dans `apps/staff-mobile/lib` et
      `apps/parent-mobile/lib` → chaque push/pull renvoie 400. Confirmer en lisant
      `apps/staff-mobile/lib/core/sync/sync_engine.dart`
- [ ] **Aucun enregistrement d'appareil** : le backend a une notion de device (l'API a un module
      `devices`, et Phase 2 annonce « appareils + révocation distante »). Vérifier si le mobile
      s'enregistre avant de synchroniser — sinon `sync_cursors(device_id, organization_id)`
      (`sync.service.ts:347`) référence un device inconnu
- [ ] **Curseur renvoyé en string** : `SyncPullDto.cursor` est `@IsInt() @Min(0)` côté client →
      vérifier le type renvoyé par `pull()` côté serveur. Un JSON number vs string casse le parse Dart
- [ ] **Aucun émetteur d'événements `child`** : vérifier qui écrit dans `sync_changelog` (C02).
      Si rien n'émet d'événement pour les entités `child`, le pull ne renverra jamais rien —
      le mobile serait « synchronisé » avec un jeu de données vide, ce qui est **pire** qu'une erreur visible

### F1. Établir le contrat comme artefact de première classe

La cause racine est structurelle : **le contrat n'existe nulle part comme source de vérité**.
Le DTO TypeScript d'un côté, le code Dart de l'autre, et rien entre les deux.

- [ ] **Spécifier le contrat de sync** dans `docs/architecture/` : shape exacte des requêtes/réponses,
      types JSON précis (number vs string), codes d'erreur, sémantique du curseur, ordre des opérations
- [ ] **Générer le client Dart depuis la spec** plutôt que l'écrire à la main. Le dépôt a déjà une
      spec OpenAPI (mais l'audit dit qu'elle couvre < 10 % des endpoints et qu'aucun swagger n'est
      dans le code — à vérifier en Phase H). Options : `openapi-generator` (dart), ou un générateur
      maison minimal pour le seul module sync
- [ ] Si la génération complète est trop lourde : **au minimum** un schéma JSON partagé
      (`packages/sync-contract/`) validé des deux côtés

### F2. Corriger le client Dart

- [ ] Enregistrer/obtenir un `device_id` stable (UUID persisté localement, ou issu de
      l'enregistrement d'appareil) et l'envoyer dans **chaque** push/pull
- [ ] Enregistrement de l'appareil auprès de l'API avant la première sync
- [ ] Parser le curseur dans le bon type ; stocker/rejouer le curseur via Drift (`app_database.dart`)
- [ ] Gérer le 400/401 explicitement : aujourd'hui un échec de sync est probablement silencieux

### F3. Corriger le serveur si nécessaire

- [ ] Émetteurs d'événements pour les entités manquantes (`child` et les autres)
- [ ] Type de retour du curseur cohérent avec la spec
- [ ] `sync_cursors` : contrainte d'intégrité sur `device_id` (FK vers la table devices ?)

### F4. **GATE — test bout-à-bout** (le vrai livrable)

> C'est la leçon centrale de l'audit : « jamais testé bout-à-bout ». Sans ce test, F n'est pas fini.

- [ ] Test d'intégration qui fait tourner **le vrai client Dart contre la vraie API** :
      1. enregistrement d'appareil
      2. push d'une opération depuis le mobile
      3. pull depuis un second appareil → l'opération apparaît
      4. curseur rejoué → pas de doublon
      5. conflit → résolution conforme à la spec
- [ ] À défaut de pouvoir exécuter du Dart en CI (coûteux) : un **test de contrat** qui valide des
      fixtures JSON réelles du client Dart contre les DTO TypeScript (validation croisée). Moins
      fort qu'un E2E, mais attrape exactement la classe de bug observée
- [ ] **GATE** : la sync est démontrée fonctionnelle, pas seulement compilée

---

# PHASE G — HIGH restants (auth, RLS, intégrité)

**Prérequis** : chaque item doit être **reproduit avant** d'être corrigé (voir §0.3).

### G1. Authentification

- [ ] **`trust proxy`** : l'activer dans `app.factory` / `main.ts` de l'api
      (`app.set('trust proxy', 1)` — **1 seul saut**, puisque nginx est devant ; ne jamais mettre
      `true`, qui ferait confiance à n'importe quel `X-Forwarded-For` forgé).
      Sans ça, `rate-limit.guard.ts:25` voit l'IP de nginx pour tout le monde → le premier
      utilisateur qui rate-limit **bloque l'authentification de tous les autres**
- [ ] Configurer nginx en conséquence (`X-Forwarded-For` correctement propagé, pas d'accumulation)
- [ ] **PIN/OTP parent sans check de statut** : un compte suspendu obtient une session. Ajouter le
      contrôle de statut dans le chemin OTP (`auth.service.ts:186-232`) **et** PIN
- [ ] **Compteurs de lockout non atomiques** : passer en `UPDATE … SET attempts = attempts + 1
      RETURNING` (une seule requête) plutôt que lecture-modification-écriture. Sinon deux requêtes
      concurrentes réinitialisent le compteur → le lockout 5 échecs/15 min est contournable
- [ ] **Énumération de comptes** : le statut est révélé avant la validation du mot de passe →
      uniformiser les réponses (`401` générique), et vérifier que le rate-limit couvre bien cette route
- [ ] **Tests** : rate-limit avec 2 IP clientes distinctes derrière un proxy simulé (2 limites
      séparées, pas une globale) ; login sur compte suspendu → 403 ; 10 échecs concurrents → lockout effectif

### G2. RLS

- [ ] **`organization_id IS NULL OR …`** sur `feature_flags`, `background_jobs`, `outbox` :
      ce pattern autorise n'importe quel tenant à écrire/supprimer des lignes **globales**.
      Reproduire, puis décider : soit ces tables ne sont pas tenantées (et l'app ne doit pas y
      avoir accès en écriture — retirer le `GRANT`), soit elles le sont strictement
- [ ] **029 réintroduit le pattern GUC que 018 avait corrigé** : lire les deux migrations,
      comprendre ce que 018 corrigeait, et vérifier si 029 est une régression réelle ou un
      faux positif. Les migrations étant immuables (ADR-007), le correctif passe par une **055**
- [ ] **Race dans le trigger d'allocation 023** : pas de `FOR UPDATE` sur `payment` → deux
      allocations concurrentes peuvent dépasser le montant. Reproduire avec 2 transactions
      parallèles, puis corriger en 055 (`SELECT … FOR UPDATE`)
- [ ] **Tests** : les 3 scénarios ci-dessus dans `tests/tenant-isolation/`, exécutés avec le rôle
      `creche_app` de prod (dépend de D2)

### G3. Intégrité financière et conformité

- [ ] Vérifier `jobs_finish($1, true, …)` appelé systématiquement après le handler
      (`main.ts:349`) : le commentaire de `main.ts:314-318` laisse entendre que la livraison est
      vérifiée ailleurs — confirmer que le drain (E3) est bien la seule voie, et que le job
      `send_parent_notification` ne marque pas « sent » trop tôt
- [ ] `next_org_sequence` non hashé → numéros de facture devinables. Décider si c'est acceptable
      (les numéros de facture séquentiels sont souvent **légalement requis**) — si oui, documenter
      la décision dans un ADR au lieu de laisser un finding ouvert ; si non, ajouter un composant non devinable
- [ ] DPIA auto-approuvable sans audit : ajouter une séparation des rôles (l'approbateur ≠ le déclarant)

---

# PHASE H — Staging, dette MEDIUM/LOW

### H1. Réparer staging (**avant** de traiter le reste de H)

Staging est l'environnement qui permet de valider tout ce qui précède. Il ne démarre pas.

- [ ] `docker-compose.staging.yml:34-40` : le service `migrate` monte `scripts/`,
      `infrastructure/database`, `package.json` mais **pas `tests/`**, puis exécute
      `node tests/tenant-isolation/schema-check.mjs` → échec → api/worker jamais démarrés
- [ ] Deux options :
      1. Monter `../../tests:/app/tests`
      2. **Mieux** : sortir `schema-check.mjs` de `tests/` vers `scripts/` — c'est un outil de
         déploiement, pas un test. Sa place dans `tests/tenant-isolation/` est la cause du bug
- [ ] Vérifier le même problème dans `docker-compose.prod.yml` et `dev.yml`
- [ ] **GATE** : `docker compose -f docker-compose.staging.yml up` → api et worker healthy
- [ ] Ajouter un job CI qui **fait réellement démarrer** le compose staging. Ce bug est invisible
      tant que personne ne lance staging — exactement la classe de problème que l'audit dénonce

### H2. MEDIUM (par grappes homogènes)

- [ ] **Confidentialité** : notifications push sans check `can_view_journal` ; exports privacy
      incluant les notes privées du journal ; accountant exportant des dossiers médicaux.
      → Reprendre la **matrice d'autorisation** de C1 et l'appliquer systématiquement aux modules
      `journal`, `exports`, `privacy`, `notifications`. C'est un seul chantier cohérent, pas 3 bugs
- [ ] **`anonymize.sql`** laisse `guardians`/`staff`/`messages`/`sessions` intacts → l'anonymisation
      est partielle, ce qui est un enjeu RGPD/loi 25-11. Vérifier `docs/regulatory/`
- [ ] **`/metrics` public** avec totaux cross-tenant + format Prometheus invalide → authentifier
      (ou restreindre au réseau interne), et **valider le format** avec un parseur Prometheus réel.
      Un `/metrics` invalide ne sera pas scrapé, donc l'aveuglement est double
- [ ] **OpenAPI** : l'audit dit « prétendu auto-généré, aucun swagger dans le code, < 10 % des
      endpoints ». À vérifier — si c'est exact, soit générer réellement (et c'est aussi un prérequis
      de F1 pour le contrat de sync), soit **arrêter de le prétendre** dans la doc
- [ ] `STORAGE_BACKEND` : défaut divergent entre config prod et runtime → aligner, et faire échouer
      le démarrage si la valeur est ambiguë
- [ ] Invitation token affiché sans garde `NODE_ENV` → n'afficher qu'en `development`
- [ ] Payroll sans prorata → voir E5 (même règle métier à décider)
- [ ] **Reproductibilité du lockfile** *(issu de §A3.1)* : le `package-lock.json` committé n'est pas
      reproductible — `npm install` refuse de re-résoudre même face à une contradiction
      contrainte/résolution, et toute modification déclenche une régénération de **170 paquets**.
      Chercher la cause : le dépôt contient un `pnpm-workspace.yaml` alors que la CI fait `npm ci`.
      Uniformiser sur **un seul** gestionnaire, puis vérifier qu'un `npm ci` sur clone vierge
      redonne exactement l'arbre committé
- [ ] **Overrides `body-parser`** *(issu de §A3.2)* : décider s'ils restent. L'override
      `@nestjs/platform-express.body-parser` est **inerte** (platform-express ne déclare pas
      body-parser) ; l'override `express.body-parser: 1.20.8` force un **downgrade majeur**
      (Express 5.2.1 veut `^2.2.1`) et c'est lui qui avait introduit `qs` 6.15.3.
      Supprimer les deux laisserait `body-parser` 2.3.0 + `qs` 6.16.0 (état naturel de `main`)

### H3. LOW

- [ ] Validation téléphone algérien (format `+213` / `0X XX XX XX XX`)
- [ ] `nap_start` non traduit ; `{n} enfant(s)` non interpolé ; i18n push français-only
      → l'app est FR/AR, donc l'arabe manquant est un défaut fonctionnel pour le marché cible,
      pas cosmétique. À remonter en priorité dans LOW
- [ ] Test parent-mobile = template compteur qui ne compile pas → le remplacer par un test réel
      (widget test sur un écran existant). **Un test qui ne compile pas est pire qu'aucun test** :
      il donne l'illusion d'une couverture
- [ ] Timezone UTC+1 vs UTC éparpillé → voir E4, à traiter ensemble
- [ ] `flutter.zip` 142 MB + SDK dans le workspace → hors de ce dépôt (vérifier `.gitignore`) ;
      ne jamais committer un SDK

---

## Synthèse — ordre d'exécution et gates

| Phase | Livrable principal | GATE de sortie | Dépend de |
|---|---|---|---|
| **A** | `security` vert + requis | **A1 ✅ atteint le 2026-09-13** : `npm audit --omit=dev` = 0 + 28/28 suites vertes. **A2 ⚠️ bloqué** (permissions `administration` + `workflows`) — voir §A3.4 | — |
| **B** | APK release réseau-fonctionnel | `aapt dump permissions` liste INTERNET ; grep en CI | — |
| **C** | C1/C2/C4 corrigés | tests 403/401 **rouges avant**, verts après | A |
| **D** | RLS effective en prod | `tests/tenant-isolation` vert **avec les rôles de prod** ; l'API refuse de booter en superuser | A, C |
| **E** | Aucun job perdu, aucun faux statut, 4 jobs planifiés | kill -9 du worker → job repris ; chaque job planifié s'exécute réellement | D |
| **F** | Sync démontrée | test bout-à-bout (ou de contrat) push→pull→curseur→conflit | B, D |
| **G** | Auth/RLS/intégrité durcis | rate-limit par IP réelle ; lockout atomique ; races reproduites puis corrigées | D |
| **H** | Staging opérationnel + dette | compose staging démarre ; matrice d'autorisation appliquée | E, G |

### Fil rouge méthodologique

Pour **chaque** bug corrigé, le livrable est le couple **(correctif, test qui échouait avant)**.
Trois des bugs les plus graves de cet audit (C6 sync, C8 superuser, jobs non planifiés) partagent
la même cause : une propriété était **affirmée** (par un commentaire, une doc, ou un test) sans
jamais être **vérifiée dans les conditions réelles**. Les gates ci-dessus existent pour ça.

### Ce qu'il ne faut PAS faire

- ❌ Corriger C8 avant d'avoir câblé `creche_migrator` → casse les migrations en prod
- ❌ `npm audit fix` sur ce dépôt → downgrade `@nestjs/core` 11.x → 7.5.5
- ❌ Corriger C3 en durcissant seulement le DTO → la contrainte de préfixe tenant doit être
      appliquée là où le tenant est connu (service), ou mieux : générer la clé côté serveur
- ❌ Merger la PR #34 sans B1 → APK release sans réseau, et le bug sera attribué à l'étape B2/B5
- ❌ Traiter un finding de la liste §0.3 sans l'avoir reproduit → l'audit initial contenait déjà
      ~3 faux positifs et 3 claims non applicables à ce dépôt

---

## Annexes

### Annexe 1 — Migrations à créer

Les migrations 001-052 sont **immuables** (ADR-007). Tout correctif SQL passe par une nouvelle migration :

| Migration | Objet | Phase |
|---|---|---|
| `053_jobs_reap_stale.sql` | reaper de jobs `processing` orphelins | E1 |
| `054_notif_queue_finish_fix.sql` | conserver `failure_reason` / état « non délivré » | E3 |
| `055_rls_and_race_fixes.sql` | pattern GUC (régression 029 vs 018) + `FOR UPDATE` trigger 023 | G2 |
| `056_scheduler.sql` | table/verrou de scheduler si option (1) retenue | E2 |

### Annexe 2 — Issues GitHub

| Issue | Objet | Phase |
|---|---|---|
| **#35** | Régression `npm audit` (multer 2.3.0 + nodemailer 9.1.1) — **ouverte**. Correctif A1 ✅ appliqué et validé le 2026-09-13 ; à fermer au merge. **Débordement découvert** : `body-parser` 1.20.6 → 1.20.8 également nécessaire (§A3.2) | A1 |
| **#8** | Flutter build + run — B1 (scaffolding, PR #34) → B5. Le commentaire de recadrage y est déjà, **posté deux fois** le 08/09 (IDs `5584413192`, `5584414851`) — le doublon mal rendu est à supprimer manuellement (403 pour le bot) | B |
| **PR #34** | Scaffolding Android — `MERGEABLE / UNSTABLE`, 8/9 checks verts. **Ne pas merger avant B1.** Trois commentaires y documentent : le rouge `security` (sans rapport), son rectificatif, et C7 | B |
| à créer | Une issue par phase C→H, avec le gate de sortie comme critère d'acceptation | — |

### Annexe 3 — Vérifications effectuées pour ce plan

Reproductions effectuées (pas seulement lues) :

```bash
# HIGH-3 — dates d'export
node -e "const d=new Date(2026,8,13); console.log(String(d).slice(0,10))"
# → "Sun Sep 13"                                    (main.ts:267, :293)
# → d.toISOString().slice(0,10) = "2026-09-13"       (main.ts:95, correct)

# A1 — régression main
npm audit --omit=dev    # sur main @ 7401589 → 4 high severity vulnerabilities

# C6 — client Dart
grep -rn 'device_id' apps/staff-mobile/lib apps/parent-mobile/lib   # → 0 résultat
```

Dernier run CI vert de `main` : `7401589`, 08/09/2026 11:26 UTC.
Advisories postérieurs : `multer` GHSA-wc9g-mqfw-jrwm (08/09 21:30 UTC),
`nodemailer` GHSA-8m3c-c648-2xjj (08/09).
