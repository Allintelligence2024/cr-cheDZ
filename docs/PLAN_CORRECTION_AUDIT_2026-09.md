# PLAN DE REPRISE — Audit 2026-09, phases D→H (v2.0)

> **Document de pilotage pour la prochaine session agent.**
> Remplace la v1.x du même fichier (historique : voir `git log -- docs/PLAN_CORRECTION_AUDIT_2026-09.md`).
> **Version** : 2.0 — 2026-09-14, **après merge de la PR #37 dans `main`** (`d6f2dfe`).
> Fait suite à [`PLAN_EXECUTION_PROCHAINES_PHASES.md`](PLAN_EXECUTION_PROCHAINES_PHASES.md),
> [`PROMPT_FIX_AUDIT.md`](PROMPT_FIX_AUDIT.md) et à la [matrice d'autorisation](architecture/authorization-matrix.md).

---

## 0. État à la reprise — ce qui est FAIT (ne pas refaire)

### 0.1 Phases terminées et mergées dans `main` (PR #37, `d6f2dfe`, squash)

| Phase | Contenu | Preuve |
|---|---|---|
| **A1** | Dépendances : `multer` 2.3.0, `nodemailer` 9.1.1, `body-parser` 1.20.8 (override), lockfile régénéré | `npm audit --omit=dev` → **0 vuln** ; CI `security` ✅ |
| **B1** | `android.permission.INTERNET` dans les manifests `main/` des 2 apps mobiles | garde `npm run check:android-manifest` → exit 0 ; vérifié sur `main` |
| **B2** | Garde `scripts/check-android-manifest.mjs` (exit 0/1/2, retire les commentaires XML) | a attrapé le bug réel dans `main` (exit 1) avant correctif |
| **C1** | `@Roles(...READ_ROLES)` sur les 6 GET de `staff.controller.ts` ; `getById` sans `sp.*` (ni `national_id`, `cnas_number`, `base_salary`, `phone`, `notes`, contacts d'urgence) | suite `phase25` |
| **C2** | Garde centralisée `assertRoleAssignable` (`shared/roles/assignable-roles.ts`) appelée par invitations **et** `addRoleAssignment` ; rôle cross-tenant → 400 `ROLE_NOT_FOUND` ; `role_id` inexistant → 400 (avant : 500 FK) | suite `phase25` |
| **C4** | `purpose='access'` signé sur tous les access tokens (login, impersonation) et **exigé** par `JwtAuthGuard` ; secret d'invitation **dérivé** (`HMAC-SHA256(JWT_SECRET, 'creche:invitation-jwt:v1')`) via `InvitationJwtModule` (`INVITATION_JWT_SERVICE`) ; `accept-invitation` vérifie avec ce service | suite `phase25` |
| **C3** | `assertStorageKeyInTenant` : `storage_key` préfixé `{organization_id}/` obligatoire → 400 `STORAGE_KEY_TENANT_MISMATCH` ; voie sync `add_photo` rejetée **par opération** ; `registerFromSync` gardé | suite `phase25` |
| **C5** | `room_id` de l'import validé contre le tenant (1 requête `ANY($1)`), erreurs ligne par ligne FR/AR (dry-run **et** commit), format UUID ; **résolu et confirmé autonome** (FK globale sans check tenant, pas un symptôme de C8) | suite `phase25` |

Outils livrés avec C : `tests/tenant-isolation/phase25-security-audit-c.api.test.mjs` (38 assertions,
enregistrée dans `scripts/run-isolation-suites.sh` → **29 suites**), `npm run check:routes-inventory`
(`scripts/inventory-route-guards.mjs`, parseur TS AST — **172 routes, 44 sans garde**, à revoir en G/H),
`docs/architecture/authorization-matrix.md`.

### 0.2 GitHub : état consolidé

- **PR #37** : MERGÉE (squash `d6f2dfe`) — 9/9 checks verts, `database` 14m52 (52 migrations,
  schema-check, rls-behavior-check 9/9, **29 suites d'isolation**, phase25 incluse).
- **PR #36** : fermée (superseded). Branches distantes `feat/mobile-android-scaffolding` et
  `arena/01a09b26-cr-chedz` : **supprimées**. Seules restent `main` et les branches de session.
- **Issues ouvertes** : #35 (à fermer — voir §0.3), **#38** Phase D, **#39** Phase E, **#40** Phase F,
  **#41** Phase G, **#42** Phase H. Chaque issue porte le gate de sortie comme critère d'acceptation.

### 0.3 Actions HUMAINES en attente (le bot ne peut pas)

| Action | Bloquée par | Détail |
|---|---|---|
| **Fermer l'issue #35** (régression npm audit corrigée par la #37) | le bot ne peut ni commenter ni fermer une issue (403), il peut seulement les créer | à faire au passage |
| Ajouter `security` aux `required_status_checks` de la branch protection `main` | permission `administration` (lecture 403, écriture 404) | patch API dans la v1.1 du plan (historique git) |
| Câbler le garde Android en CI (`flutter.yml`, patch §B3.2 de la v1.x) | permission `workflows` (tout push sur `.github/workflows/*` est refusé) | **à faire maintenant que #37 est mergée** — le garde sinon ne protège qu'en local ; voir aussi `docs/CI-RESTORE.md` |
| Ajouter `schedule` quotidien + `workflow_dispatch` sur le job `security` | permission `workflows` | patch §A3.4 de la v1.x |
| GATE B : `flutter build apk --release` + `aapt dump permissions` (pas de SDK ici) | environnement | étape B4/B5 de l'issue #8, **en release** (jamais debug) |
| Supprimer le doublon de commentaire sur l'issue #8 (IDs `5584413192`, `5584414851`) | 403 sur commentaires d'issue | cosmétique |

### 0.4 Règles d'environnement apprises (à respecter pour ne pas perdre de temps)

1. **Le remote est la source de vérité** ; l'arbre local peut régresser entre sessions.
   Le refspec de fetch des clones est restreint à `main` : `origin/<branche>` n'existe pas
   localement tant qu'on n'a pas fait `git fetch origin refs/heads/<branche>` explicitement.
   Vérifier avec `gh api repos/Allintelligence2024/cr-cheDZ/branches/<branche> --jq '.commit.sha'`.
2. **PostgreSQL embarqué** : `node run_pg.mjs` (port **54329**, `postgres/postgres`, base `creche_test`,
   données `/tmp/pgtest/data`, process long → `start_process`). `DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test`.
3. **Batterie de suites** : `bash scripts/run-isolation-suites.sh` — mais `phase3`, `isolation` et
   `phase4` ne font **pas** `--reset` et supposent une base fraîche. Toujours rejouer depuis
   `node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`
   (c'est ce que fait le job CI `database`).
4. `npm ci` (pas `npm install`) ; `npm audit --omit=dev` doit rester à **0** ; `npm run lint` en
   `--max-warnings=0` ; typecheck/build de tous les workspaces ; `npm run test:unit` (12/12).
5. **Contrainte de session** : chaque session Arena est verrouillée sur SA branche
   (`arena/<session-id>`). Pousser sur une branche de PR ouverte = course contre le merge
   (voir v1.x §B3.3). Corriger sur sa propre branche dès que le contenu existe dans `main`.
6. Migrations **001–052 immuables** (ADR-007) : tout correctif SQL passe par une **nouvelle**
   migration (numérotation prévue en §8).

---

## Règle transversale (non négociable)

Pour **chaque** bug corrigé, le livrable est le couple **(correctif, test qui échouait avant)**.
Aucun item de la liste §1.3 (v1.x §0.3) ne passe en correction **tant qu'il n'est pas reproduit** —
l'audit initial contenait ~3 faux positifs et 3 claims non applicables (documentés en v1.x §0.2).

---

## 1. PHASE D — Restaurer la garantie multi-tenant en production (C8)

> **La phase la plus grave et la plus risquée.** Backup vérifié
> ([`BACKUP-RUNBOOK.md`](BACKUP-RUNBOOK.md)) + plan de rollback écrit **avant** de commencer.
> Issue **#38**. Remarque : C5 n'est plus un prérequis (résolu en Phase C).

### D0. Décision préalable (à trancher explicitement avec le client)

- [ ] La prod contient-elle déjà de vraies données enfants ?
      - **Non** → recréer la base proprement (beaucoup plus simple)
      - **Oui** → correction en place, avec fenêtre de maintenance
- [ ] Qui est propriétaire des tables aujourd'hui ? Si `creche_app` (superuser) l'est,
      le transfert de propriété vers `creche_migrator`/`postgres` est un prérequis.

### D1. Séparer les rôles : superuser ≠ migrateur ≠ applicatif

Le dépôt prévoit déjà cette séparation (`infrastructure/database/roles.sql` : `creche_migrator`
pour le DDL, `creche_app` en `NOBYPASSRLS`) — elle n'est jamais appliquée.

- [ ] **Compose** : ne plus faire de l'utilisateur applicatif le superuser d'init
      (`POSTGRES_USER: postgres` pour l'init seule, `DATABASE_URL` api/worker → `creche_app`).
- [ ] **Câbler `roles.sql`** : service `bootstrap-roles` qui dépend de `postgres: healthy` et que
      `migrate` attend (préférable à `docker-entrypoint-initdb.d`, reproductible).
- [ ] **Corriger `roles.sql`** : le `IF NOT EXISTS` actuel est un piège (C8-bis — le bloc est
      sauté silencieusement si le rôle existe déjà en superuser). Upsert idempotent qui garantit
      **l'état final** : `ELSE ALTER ROLE creche_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;`.
- [ ] Mots de passe distincts `creche_app` / `creche_migrator` (secrets →
      [`OPERATIONS-SECRETS.md`](OPERATIONS-SECRETS.md)).
- [ ] `scripts/migrate.mjs` utilise `creche_migrator` ; api/worker `creche_app`.

### D2. Prouver que la RLS s'applique vraiment en prod

- [ ] **Refus de démarrage** si le rôle applicatif est superuser/bypassrls en `production` :
      au boot de l'API, `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
      → message explicite. Même check dans `migrate.mjs` (le migrateur PEUT avoir plus de droits,
      mais ne doit jamais être le rôle de l'app).
- [ ] **GATE** : les **29 suites** de `tests/tenant-isolation/` tournent **avec les rôles de prod**
      (mêmes rôles, mêmes grants — pas le superuser). `schema-check` et `rls-behavior-check` (9/9
      attendu) avec `creche_app`. Tant que ce gate n'est pas vert, D n'est pas terminé.

### D3. Vérifier les grants

- [ ] `GRANT … ON ALL TABLES IN SCHEMA public` : **rejouer après toute migration ajoutant une
      table** — automatiser en fin de `migrate.mjs`, sinon la 53e migration crée une table
      illisible pour `creche_app`. Vérifier les `GRANT EXECUTE` des fonctions `SECURITY DEFINER`
      (015, 016, 024, 042, 051…).
- [ ] **Test** : après une migration ajoutant une table fictive, l'api la lit sans intervention manuelle.

---

## 2. PHASE E — Fiabilité du worker

> Issue **#39**. Dépend de D (le worker doit tourner avec le bon rôle pour que les tests soient
> représentatifs).

### E1. Jobs orphelins (perte silencieuse de travail)

- [ ] **Reaper** : `jobs_reap_stale(p_timeout interval)` — tout job `processing` dont `started_at`
      est trop ancien repasse en `pending` (ou `failed` si `attempts >= max_attempts`). **Migration 053**.
- [ ] **Arrêt gracieux** : `SIGTERM`/`SIGINT` dans `apps/worker/src/main.ts` (finir le job en cours,
      ne plus réclamer, sortir). Vérifier `stop_grace_period` dans `docker-compose.prod.yml`.
- [ ] Boucle de reaper périodique dans le worker (ou job dédié, voir E2).
- [ ] **Test** : job long + SIGKILL du worker → le job est repris après le timeout. **Doit échouer
      aujourd'hui.**

### E2. Le scheduler manquant — bug systémique

4 handlers enregistrés (`retention_purge`, `video_clips_purge`, `payments_expire`,
`send_monthly_invoices`), **0 producteur**. La purge DPIA 30 j (`video_clips_purge`) promise par
`video.service.ts:23` et `:206` **n'existe pas** → vidéos d'enfants conservées indéfiniment
(enjeu loi 25-11).

- [ ] **ADR** (`docs/adr/`) pour choisir le mécanisme : (1) boucle interne + verrou
      `SELECT … FOR UPDATE SKIP LOCKED` sur `scheduler_ticks` (recommandé, mono-réplica) ;
      (2) cron externe/K8s CronJob ; (3) pg_cron (extension absente de l'image standard).
- [ ] Fréquences à valider avec le métier : `video_clips_purge` quotidien ; `retention_purge`
      quotidien ; `payments_expire` horaire ; `send_monthly_invoices` mensuel (1er, idempotent) ;
      `jobs_reap_stale` toutes les 5 min.
- [ ] **Idempotence vérifiée** pour chacun avant planification (`send_monthly_invoices` déjà
      documenté idempotent et testé `phase11-hardening.api.test.mjs:144`).
- [ ] **GATE** : test qui avance l'horloge (ou injecte des `scheduled_at` passés) et vérifie que
      chaque job **s'exécute réellement**. + alerte si un job planifié n'a pas tourné depuis N périodes.

### E3. Faux statut de notification (HIGH-6)

`main.ts:487` appelle `notif_queue_finish($1, true, 'PUSH_NOT_CONFIGURED_OR_NO_DEVICE')` — la
fonction (042) ignore le motif quand `p_success=true` et met `failure_reason=NULL`. Le commentaire
de `main.ts:314-318` promet l'inverse.

- [ ] **Décider la sémantique** : trois états `sent` / `failed` / `skipped`, ou conserver
      `failure_reason` même quand `p_success=true`. Le commentaire décrit l'option 2 (intention
      d'origine). **Migration 054** (042 est immuable).
- [ ] **Test** : notification sans device configuré → statut **et** `failure_reason` cohérents en base.

### E4. Dates d'export (HIGH-3)

- [ ] `main.ts:267` et `:293` : `String(row.date).slice(0,10)` → `"Sun Sep 13"`. Corriger par
      **parseur pg dédié** (`pg.types.setTypeParser(1082, v => v)` — le `DATE` arrive déjà en
      `YYYY-MM-DD`) ou formatage explicite. ⚠️ `.toISOString().slice(0,10)` (correct ligne 95 pour
      un `timestamptz`) **décale d'un jour** un `DATE` en TZ négatif.
- [ ] **Politique unique** de timezone (UTC+1 vs UTC éparpillé), helper centralisé
      (`packages/` ?) — voir aussi H3.
- [ ] **Test** : export avec un `DATE` au 1er du mois → cellule `YYYY-MM-01`, testé avec `TZ`
      négatif **et** positif. Vérifier `pdf.ts:68` (`Échéance : ${data.dueDate}`) qui consomme la ligne 95.

### E5. Facturation mensuelle ignore `start_date` (HIGH-7)

- [ ] Confirmer : `sendMonthlyInvoices` (`main.ts:116`) itère les contrats actifs sans regarder
      `start_date` (0 occurrence dans `main.ts`).
- [ ] **Règle métier à décider AVEC LE CLIENT** : prorata ? mois entier ? rien le premier mois ?
      (même question pour le payroll — « payroll sans prorata »). Vérifier
      [`docs/regulatory/`](regulatory/) (décret 19-253).
- [ ] Implémenter le prorata si retenu, en cohérence avec les triggers d'intégrité financière (C04)
      et l'immuabilité des factures payées.
- [ ] **Test** : contrat démarrant le 15/09 → facture de septembre au prorata (ou nulle), pas un
      mois plein ; contrat démarrant le 01/10 → rien en septembre.

### E6. Export date-simple bloqué en `pending`

- [ ] Reproduire (probablement même famille de bug que E4) ; ajouter timeout/statut `failed`
      explicite — un export bloqué doit être **visible**, pas silencieux.

---

## 3. PHASE F — Contrat de sync mobile bout-à-bout (C6)

> Issue **#40**. Le plus gros chantier. Dépend de B (fait) et E.

### F0. Diagnostic complet du contrat (avant d'écrire du code)

- [ ] **`device_id` absent du client** : `SyncPushDto.device_id` / `SyncPullDto.device_id` =
      `@IsUUID()` requis ; `device_id` = 0 occurrence dans `apps/staff-mobile/lib` et
      `apps/parent-mobile/lib` → 400 systématique. Confirmer en lisant
      `apps/staff-mobile/lib/core/sync/sync_engine.dart`.
- [ ] **Aucun enregistrement d'appareil** côté client (l'API a `POST /devices`) — sinon
      `sync_cursors(device_id, organization_id)` référence un device inconnu.
- [ ] **Curseur renvoyé en string** : `SyncPullDto.cursor` = `@IsInt() @Min(0)` → vérifier le type
      renvoyé par `pull()` (JSON number vs string casse le parse Dart).
- [ ] **Aucun émetteur d'événements `child`** : vérifier qui écrit dans `sync_changelog` (C02).
      Si rien n'émet pour `child`, le pull renvoie un jeu vide — **pire** qu'une erreur visible.

### F1. Établir le contrat comme artefact de première classe

- [ ] Spécifier le contrat dans `docs/architecture/` : shape exact requêtes/réponses, types JSON
      précis (number vs string), codes d'erreur, sémantique du curseur, ordre des opérations.
- [ ] Générer le client Dart depuis la spec (openapi-generator dart, ou générateur maison minimal
      pour le module sync) ; **au minimum** un schéma JSON partagé `packages/sync-contract/` validé
      des deux côtés.

### F2. Corriger le client Dart

- [ ] `device_id` stable (UUID persisté localement ou issu de `POST /devices`) envoyé dans
      **chaque** push/pull ; enregistrement avant la première sync.
- [ ] Parser le curseur dans le bon type ; stocker/rejouer via Drift (`app_database.dart`).
- [ ] Gérer le 400/401 explicitement (aujourd'hui l'échec de sync est probablement silencieux).

### F3. Corriger le serveur si nécessaire

- [ ] Émetteurs d'événements pour les entités manquantes (`child`…) ; type de retour du curseur
      cohérent avec la spec ; contrainte d'intégrité sur `device_id` (FK vers `devices` ?).

### F4. GATE — test bout-à-bout (le vrai livrable)

- [ ] Intégration avec le **vrai client Dart contre la vraie API** : enregistrement device → push →
      pull depuis un 2e appareil → curseur rejoué sans doublon → conflit conforme à la spec.
- [ ] À défaut de Dart en CI : **test de contrat** (fixtures JSON réelles du client Dart validées
      contre les DTO TypeScript).
- [ ] **GATE** : la sync est démontrée fonctionnelle, pas seulement compilée.

---

## 4. PHASE G — HIGH restants (auth, RLS, intégrité)

> Issue **#41**. **Prérequis : chaque item reproduit avant d'être corrigé** (règle §1.3 de la v1.x).

### G1. Authentification

- [ ] **`trust proxy`** : `app.set('trust proxy', 1)` dans `app.factory.ts`/`main.ts` (1 seul saut,
      nginx devant ; **jamais** `true`). Sans ça, `rate-limit.guard.ts:25` voit l'IP de nginx pour
      tout le monde → le premier rate-limité bloque l'auth de **tous**. Configurer nginx en conséquence.
- [ ] **PIN/OTP parent sans check de statut** : compte suspendu obtient une session. Ajouter le
      contrôle de statut dans le chemin OTP (`auth.service.ts:186-232`) **et** PIN.
- [ ] **Compteurs de lockout non atomiques** : `UPDATE … SET failed_attempts = failed_attempts + 1
      RETURNING` (une requête) — sinon le lockout 5 échecs/15 min est contournable en concurrence.
- [ ] **Énumération de comptes** : uniformiser les réponses (401 générique), vérifier que le
      rate-limit couvre la route.
- [ ] **Tests** : rate-limit avec 2 IP clientes derrière proxy simulé (2 limites séparées) ; login
      compte suspendu → 403 ; 10 échecs concurrents → lockout effectif.

### G2. RLS

- [ ] **`organization_id IS NULL OR …`** sur `feature_flags`/`background_jobs`/`outbox` :
      reproduire (n'importe quel tenant peut écrire/supprimer des lignes globales ?), puis décider :
      tables non tenantées (retirer le `GRANT` en écriture à l'app) **ou** RLS stricte.
- [ ] **029 vs 018** : lire les deux migrations ; la 029 réintroduit-elle le pattern GUC que la 018
      corrigeait ? Correctif éventuel en **055** (001–052 immuables).
- [ ] **Race trigger 023** : pas de `FOR UPDATE` sur `payment` → deux allocations concurrentes
      peuvent dépasser le montant. Reproduire avec 2 transactions parallèles, corriger en **055**.
- [ ] **Tests** : les 3 scénarios dans `tests/tenant-isolation/`, exécutés avec le rôle `creche_app`
      de prod (dépend de D2).

### G3. Intégrité financière et conformité

- [ ] Vérifier `jobs_finish($1, true, …)` systématiquement après le handler (`main.ts:349`) ;
      confirmer que le drain (E3) est la seule voie et que `send_parent_notification` ne marque pas
      « sent » trop tôt.
- [ ] `next_org_sequence` non hashé → numéros de facture devinables. Décider : séquentiel est
      souvent **légalement requis** → si oui, **ADR de décision** ; sinon composant non devinable.
- [ ] DPIA auto-approuvable sans audit : séparation des rôles (approbateur ≠ déclarant).

---

## 5. PHASE H — Staging, dette MEDIUM/LOW

> Issue **#42**. Staging doit marcher **avant** le reste de H (il sert à valider tout le reste).

### H1. Réparer staging

- [ ] `docker-compose.staging.yml:34-40` : le service `migrate` monte `scripts/`,
      `infrastructure/database`, `package.json` — **pas `tests/`** — puis exécute
      `node tests/tenant-isolation/schema-check.mjs` → échec → api/worker jamais lancés.
      Option préférée : **sortir `schema-check.mjs` de `tests/` vers `scripts/`** (outil de
      déploiement, pas un test). Vérifier `prod.yml` et `dev.yml`.
- [ ] **GATE** : `docker compose -f docker-compose.staging.yml up` → api et worker healthy.
- [ ] Job CI qui **démarre réellement** le compose staging (ce bug est invisible tant que personne
      ne lance staging).

### H2. MEDIUM (par grappes homogènes)

- [ ] **Confidentialité** : push sans check `can_view_journal` ; exports privacy incluant les notes
      privées du journal ; accountant exportant des dossiers médicaux → appliquer la **matrice
      d'autorisation** aux modules `journal`, `exports`, `privacy`, `notifications` (un seul chantier).
- [ ] **`anonymize.sql`** : laisse `guardians`/`staff`/`messages`/`sessions` intacts (RGPD/loi 25-11).
- [ ] **`/metrics` public** + totaux cross-tenant + format Prometheus invalide → authentifier (ou
      restreindre au réseau interne) et valider le format avec un parseur Prometheus réel.
- [ ] **OpenAPI** : « prétendu auto-généré, aucun swagger, < 10 % des endpoints » — vérifier ;
      soit générer réellement (prérequis F1), soit arrêter de le prétendre dans la doc.
- [ ] **`STORAGE_BACKEND`** : défaut divergent config prod vs runtime → aligner, échouer au
      démarrage si ambigu.
- [ ] **Invitation token affiché sans garde `NODE_ENV`** → n'afficher qu'en `development`.
- [ ] **Payroll sans prorata** → voir E5 (même règle métier).
- [ ] **Reproductibilité du lockfile** : `pnpm-workspace.yaml` présent alors que la CI fait `npm ci` ;
      `npm install` refuse de re-résoudre même face à une contradiction. Uniformiser sur **un seul**
      gestionnaire ; vérifier qu'un `npm ci` sur clone vierge redonne exactement l'arbre committé.
- [ ] **Overrides `body-parser`** : `@nestjs/platform-express.body-parser` est **inerte**
      (platform-express ne déclare pas body-parser) ; `express.body-parser: 1.20.8` force un
      downgrade majeur (Express 5.2.1 veut `^2.2.1`) — c'est lui qui avait introduit `qs` 6.15.3.
      Décider : supprimer les deux (état naturel : body-parser 2.3.0 + qs 6.16.0) ou documenter le pin.
- [ ] **`staff_documents.storage_key`** (`StaffService.createDocument`) : même défaut que C3
      (pas de préfixe tenant) — appliquer la même garde.
- [ ] **Les 44 routes sans `@Roles`/`@Public`** (inventaire `npm run check:routes-inventory`) :
      revue module par module + justification écrite pour chaque route self-service conservée sans garde.

### H3. LOW

- [ ] Validation téléphone algérien (`+213` / `0X XX XX XX XX`).
- [ ] `nap_start` non traduit ; `{n} enfant(s)` non interpolé ; i18n push français-only → l'arabe
      manquant est un défaut fonctionnel pour le marché cible (priorité haute **dans** LOW).
- [ ] Test parent-mobile = template compteur qui ne compile pas → remplacer par un vrai widget test
      (un test qui ne compile pas est pire qu'aucun test).
- [ ] Timezone UTC+1 vs UTC éparpillé → traiter avec E4.
- [ ] `flutter.zip` 142 MB + SDK hors du dépôt (vérifier `.gitignore`) ; jamais committer un SDK.

---

## 6. Synthèse — ordre d'exécution et gates

| Phase | Livrable principal | GATE de sortie | Dépend de |
|---|---|---|---|
| **A/B/C** | ✅ mergés dans `main` (PR #37, `d6f2dfe`) | — | — |
| **D** | RLS effective en prod | 29 suites vertes **avec les rôles de prod** ; API refuse de booter en superuser | A, C ✅ |
| **E** | Aucun job perdu, aucun faux statut, 4 jobs planifiés | kill -9 du worker → job repris ; chaque job planifié s'exécute réellement | D |
| **F** | Sync démontrée | test bout-à-bout (ou de contrat) push→pull→curseur→conflit | B ✅, E |
| **G** | Auth/RLS/intégrité durcis | rate-limit par IP réelle ; lockout atomique ; races reproduites puis corrigées | D |
| **H** | Staging opérationnel + dette | compose staging démarre ; matrice d'autorisation appliquée | E, G |

---

## 7. Ce qu'il ne faut PAS faire

- ❌ Corriger C8 avant d'avoir câblé `creche_migrator` → casse les migrations en prod.
- ❌ `npm audit fix` sur ce dépôt → downgrade `@nestjs/core` 11.x → 7.5.5.
- ❌ Traiter un finding sans l'avoir **reproduit** (la règle a déjà éliminé 3 faux positifs).
- ❌ Toucher aux migrations 001–052 (ADR-007) — toute correction SQL = nouvelle migration.
- ❌ Pousser un correctif sur une branche de PR ouverte (course contre le merge — v1.x §B3.3).
- ❌ Remettre du `SELECT sp.*` ou une route staff sans `@Roles` (la suite `phase25` échouerait).
- ❌ Accepter un `storage_key` sans préfixe tenant dans un nouveau chemin d'écriture média.

---

## 8. Annexes

### Annexe 1 — Migrations à créer

| Migration | Objet | Phase |
|---|---|---|
| `053_jobs_reap_stale.sql` | reaper de jobs `processing` orphelins | E1 |
| `054_notif_queue_finish_fix.sql` | conserver `failure_reason` / état « non délivré » | E3 |
| `055_rls_and_race_fixes.sql` | pattern GUC (régression 029 vs 018) + `FOR UPDATE` trigger 023 | G2 |
| `056_scheduler.sql` | table/verrou de scheduler si option (1) retenue | E2 |

### Annexe 2 — Issues GitHub

| Issue | Objet | Phase |
|---|---|---|
| #35 | npm audit — **corrigé par la PR #37** ; à FERMER (action humaine, bot 403) | A1 |
| #38 | Phase D — RLS effective en prod | D |
| #39 | Phase E — fiabilité worker | E |
| #40 | Phase F — sync mobile bout-à-bout | F |
| #41 | Phase G — HIGH restants | G |
| #42 | Phase H — staging + dette | H |
| #8 | Flutter build+run — B4/B5 à valider **en release** | B |

### Annexe 3 — Commandes utiles

```bash
# Environnement de test (une fois par session)
node run_pg.mjs   # process long — PostgreSQL 18.4 embarqué, port 54329
export DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test

# Base fraîche AVANT la batterie (phase3/isolation/phase4 supposent une base vierge)
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs

# Batterie complète (29 suites) — gate local équivalent au job CI database
bash scripts/run-isolation-suites.sh

# Suite Phase C seule
node tests/tenant-isolation/phase25-security-audit-c.api.test.mjs

# Gates A/B (doivent rester verts à chaque session)
npm audit --omit=dev                          # → 0 vuln
npm run check:android-manifest                # → exit 0
npm run check:routes-inventory                # inventaire des 172 routes (44 sans garde)
npm run typecheck && npm run lint && npm run test:unit && npm run build
```
