# PLAN DE REPRISE — Audit 2026-09, phases D→H (v3.0)

> **Document de pilotage pour la prochaine session agent.**
> Remplace la v1.x du même fichier (historique : voir `git log -- docs/PLAN_CORRECTION_AUDIT_2026-09.md`).
> **Version** : 3.0 — 2026-09-14. Reprend la v2.0 mergée par la PR #43 (`d2bd1f9`)
> et ajoute le suivi local D/E1–E6 sur `arena/01a09e7f-cr-chedz` (pas encore mergé).
> Fait suite à [`PLAN_EXECUTION_PROCHAINES_PHASES.md`](PLAN_EXECUTION_PROCHAINES_PHASES.md),
> [`PROMPT_FIX_AUDIT.md`](PROMPT_FIX_AUDIT.md) et à la [matrice d'autorisation](architecture/authorization-matrix.md).

---

## Suivi de cette session — D, E1–E6, puis F1/F3

- **D0 confirmé avec le client** : aucune production déployée, installation neuve ;
  propriétaires et sauvegarde de production non applicables. Rollback écrit avant
  correction. Aucune opération en production.
- **D implémentée et validée localement** : 29/29 suites historiques avec les rôles
  et grants de production, 14 tests PostgreSQL D, 8 tests structurels Compose.
  Voir [runbook D](PHASE_D_ROLES_RUNBOOK.md) et ADR-011.
- **E1 corrigé après reproduction** : migration 053, baux/heartbeat/reaper et arrêt
  gracieux. 0/4 tests initiaux avant → 4/4 après ; **14/14** tests E1 et
  **30/30** suites/contrôles D+E1 avec rôles de production (exit 0).
  Voir [runbook E](PHASE_E_WORKER_RUNBOOK.md) et ADR-012.
- **E2–E6 implémentés localement**, décisions client obtenues : 3 jobs planifiés,
  facturation automatique **OFF**, mois partiels non facturés, échéance fin de
  mois par défaut, statut notification conservé avec motif. Migrations 054/056/057.
  **23/23** tests E2–E6 verts en rôles stricts et historiques ; **31/31** suites
  au gate final D+E, exit 0 (premier passage 30/31 : faute de nom SQL dans un
  test corrigée). Build/typecheck/lint verts, 27 unitaires, audit prod 0 vuln.
- **Suite E2** : routage Prometheus → Alertmanager → relais local/e-mail/SMS/WhatsApp
  livré selon le choix client ; 0/2 routage avant → 2/2 après, 4/4 tests de relais.
  Gate des vrais moteurs Docker et de la chaîne complète raccordé à la CI existante,
  **validé en CI sur `955b9cd` (PR #44, 9/9 checks)**. Réception sur coordonnées réelles non configurée.
  Voir `PHASE_E2_ALERTING_RUNBOOK.md`.
- **F1 livré comme artefact** : schéma partagé, générateur TS/Dart, 49/49 cas
  schéma/DTO locaux ; gate Dart obligatoire en CI (voir `architecture/sync-contract.md`).
  **F3 curseurs corrigés** : 5/23 avant → 23/23 après, suite enrichie **26/26**.
  Intégration **F2 maintenant livrée** (voir runbook F2), gate Flutter réel requis ;
  gate F4 réel étendu aux quatre types produits (résultat CI du dernier HEAD), pas de qualification Android release. G/H restent ouverts, notamment la règle de paie : ne pas déduire celle-ci
  du choix « mois partiels non facturés » des contrats de garde.
- **Réserves D** : Docker non démarré ici, écart Compose PostgreSQL 16 / tests 18.4,
  gate CI strict désormais raccordé via le runner existant (validé en PR #44 sur 955b9cd). Ne pas confondre preuve locale et déploiement.

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

### D0. Décision préalable (tranchée avec le client : aucune production déployée)

- [x] Client : **pas de production déployée**, installation neuve. Aucune
      suppression de volume existant autorisée par cette décision.
- [x] Propriétaires/sauvegarde de production non applicables. Le bootstrap refuse
      une propriété applicative historique ; ce cas exige une intervention dédiée.

### D1. Séparer les rôles : superuser ≠ migrateur ≠ applicatif

Avant correction, le dépôt prévoyait déjà cette séparation (`infrastructure/database/roles.sql` : `creche_migrator`
pour le DDL, `creche_app` en `NOBYPASSRLS`) — elle n'était jamais appliquée.

- [x] **Compose** : ne plus faire de l'utilisateur applicatif le superuser d'init
      (`POSTGRES_USER: postgres` pour l'init seule, `DATABASE_URL` api/worker → `creche_app`).
- [x] **Câbler `roles.sql`** : service `bootstrap-roles` qui dépend de `postgres: healthy` et que
      `migrate` attend (préférable à `docker-entrypoint-initdb.d`, reproductible).
- [x] **Corriger `roles.sql`** : le `IF NOT EXISTS` actuel est un piège (C8-bis — le bloc est
      sauté silencieusement si le rôle existe déjà en superuser). Upsert idempotent qui garantit
      **l'état final** : `ELSE ALTER ROLE creche_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;`.
- [x] Mots de passe distincts `creche_app` / `creche_migrator` (secrets →
      [`OPERATIONS-SECRETS.md`](OPERATIONS-SECRETS.md)).
- [x] `scripts/migrate.mjs` utilise `creche_migrator` ; api/worker `creche_app`.

### D2. Prouver la RLS avec les rôles de production

- [x] **Refus de démarrage** si le rôle applicatif est superuser/bypassrls en `production` :
      au boot de l'API, `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`
      → message explicite. Même check dans `migrate.mjs` (le migrateur PEUT avoir plus de droits,
      mais ne doit jamais être le rôle de l'app).
- [x] **GATE LOCAL** : les **29 suites** de `tests/tenant-isolation/` tournent **avec les rôles de prod**
      (mêmes rôles, mêmes grants — pas le superuser). `schema-check` et `rls-behavior-check` (9/9
      attendu) avec `creche_app`. Tant que ce gate n'est pas vert, D n'est pas terminé.

### D3. Vérifier les grants

- [x] `GRANT … ON ALL TABLES IN SCHEMA public` : **rejouer après toute migration ajoutant une
      table** — automatiser en fin de `migrate.mjs`, sinon la 53e migration crée une table
      illisible pour `creche_app`. Vérifier les `GRANT EXECUTE` des fonctions `SECURITY DEFINER`
      (015, 016, 024, 042, 051…).
- [x] **Test** : après une migration ajoutant une table fictive, l'api la lit sans intervention manuelle.

**D livré** : bootstrap transactionnel rejouable → migrateur NOSUPERUSER BYPASSRLS
(fonctions SECURITY DEFINER sur FORCE RLS) → application NOBYPASSRLS. API **et
worker** vérifient current_user/session_user, attributs, propriété, appartenance et
CREATE. Seeds utilisent aussi le migrateur ; registre des migrations en lecture
seule pour l'app. Grants dans chaque transaction de migration et sur run sans DDL.

- [ ] Vérification Docker réelle et choix/validation du moteur cible (16 vs 18).
- [ ] Câblage CI du nouveau gate (action humaine `workflows`).

---

## 2. PHASE E — Fiabilité du worker

> Issue **#39**. Dépend de D (le worker doit tourner avec le bon rôle pour que les tests soient
> représentatifs).

### E1. Jobs orphelins (perte silencieuse de travail)

- [x] **Reaper** : `jobs_reap_stale(p_timeout interval)` — tout job `processing` dont le heartbeat
      (ou `started_at` historique) est trop ancien repasse en `pending` (ou `failed` si `attempts >= max_attempts`). **Migration 053**.
- [x] **Arrêt gracieux** : `SIGTERM`/`SIGINT` dans `apps/worker/src/job-runtime.ts` (finir le job en cours,
      ne plus réclamer, sortir). Vérifier `stop_grace_period` dans `docker-compose.prod.yml`.
- [x] Boucle de reaper périodique dans le worker (ou job dédié, voir E2).
- [x] **Test** : job long + SIGKILL du worker → le job est repris après le timeout. **Rouge avant, vert après.**

**Compléments livrés** : bail UUID par tentative, heartbeat indépendant du
handler, fencing des terminaisons tardives (même après reset du compteur par le
support), reaper concurrent par batches de 500/SKIP LOCKED, deadline 45 s et
stop_grace_period 60 s. At-least-once uniquement ; pas de mélange d'anciens et
nouveaux workers au déploiement. Détails et résultats : [runbook E](PHASE_E_WORKER_RUNBOOK.md).

### E2. Le scheduler manquant — reproduit et implémenté, gate supervision restant

Avant correction : quatre handlers, aucun producteur ; les données vidéo,
paiements et rétention expirées n'étaient pas traitées automatiquement.

- [x] ADR-013 : boucle interne + ticks persistés + `FOR UPDATE SKIP LOCKED`.
      Migration **056**, table FORCE RLS interne, aucun EXECUTE PUBLIC.
- [x] Fréquences **validées par le client** : purges quotidiennes **02 h Alger**,
      paiements chaque heure pleine, reaper 5 min. **Mensuelle automatique OFF**,
      protégée par CHECK : pas d'activation implicite ni d'enqueue sans tenant.
- [x] Retard coalescé et pas de doublon avec deux producteurs concurrents ; lots
      vidéo/paiements de 500 drainés jusqu'à épuisement (501e ligne reproduite).
- [x] Test : ticks passés injectés, trois handlers réellement exécutés, fichiers
      et lignes expirées supprimés, paiement failed, aucune mensualité produite.
- [x] Santé PostgreSQL lisible sans worker ; retard après **2 périodes** depuis
      le dernier succès (2 h/48 h), exporter et règles Prometheus câblés.
- [x] **GATE supervision technique validé en CI** : promtool 2.53.0, vrais
      exporter/Prometheus/Alertmanager, aucune présence de worker, réception locale,
      SMTP de test et requêtes SMS/WhatsApp simulées, résolutions et perte exporter.
      PR #44, commit `955b9cd`, run `34826565565`, 9/9 checks verts.
- [ ] **Activation d'exploitation** : coordonnées/credentials SMTP/Twilio, modèle
      WhatsApp approuvé et essai sur destinations réelles. Aucune livraison réelle
      revendiquée ; pas de déploiement. Voir `PHASE_E2_ALERTING_RUNBOOK.md`.


### E3. Notification non livrée — corrigé selon la décision client

- [x] Statuts existants conservés, `failure_reason` conservé même si succès de
      traitement. **Migration 054** (042/043 intactes).
- [x] Notification sans device : `sent` + `PUSH_NOT_CONFIGURED_OR_NO_DEVICE`.
      Avant : motif NULL. **sent = queue traitée, pas preuve de push livré.**

### E4. Calendrier DATE / heures — corrigé dans le périmètre worker

- [x] OID1082 pg dédié → chaîne ISO ; plus de `String(Date).slice(0,10)` ni de
      conversion en instant pour une échéance. Déplacement au jour précédent
      effectivement reproduit en **TZ positif** dans le PDF (correction du libellé
      initial de l'audit qui mentionnait le TZ négatif).
- [x] Helper calendrier partagé (`packages/prod-config/src/calendar.ts`) : dates
      réelles, année bissextile, pas d'année zéro PostgreSQL, bornes de mois ;
      horaires de présence explicitement en `Africa/Algiers`.
- [x] Vrais PDF/XLSX : DATE au premier du mois, échéance exacte, tests TZ positif
      **et** négatif ; sessions SQL à fuseaux différents pour les heures.
- [ ] Harmonisation des autres modules H3 : **pas revendiquée comme faite**.

### E5. Facturation mensuelle — corrigé, automatique toujours désactivée

- [x] Reproduction : contrats commençant le 15/09 ou le 01/10 facturés en septembre.
- [x] Décision client : **pas de facture pour un mois partiellement couvert** ;
      contrat actif du premier au dernier jour inclus. Aucun prorata de paie décidé.
- [x] Échéance par défaut en fin de mois ; payload manuel explicite conservé par
      compatibilité (interprétation documentée, pas validation client additionnelle).
- [x] Après preuve rouge : facture/lignes/enqueue PDF dans la même transaction ;
      repas/transport non doublés dans la ligne de garde. Centimes et C04 conservés.
- [x] Tests de contrats partiels/futurs, échéance, total des lignes, échec enqueue
      annulant la facture, rejeu sans doublon et facture payée intacte.

### E6. Export date-simple et échecs silencieux — corrigé

- [x] Reproduit : `2026-09-01` devient `2026-09-01-01`, le job échoue mais le
      rapport reste pending. Date simple corrigée en `[jour,jour]`, périodes
      invalides/inversées refusées avant enqueue.
- [x] **057** : projection des échecs terminaux (finish, reaper, timeout), reprise
      support et réconciliation d'attente. Deadline handler **2 min** ; pending
      **30 min** (maintenance + API tenant, lots bornés de 500).
- [x] Publication sous bail verrouillé, chemin `{tenant}/exports/{id}/{lease}.xlsx`.
      PUT tardif : ni publication après perte de bail ni écrasement d'une nouvelle
      tentative. Un crash peut laisser un objet orphelin : lifecycle séparé requis.
- [x] Tests API → worker → fichiers, stockage défaillant, vrai blocage SQL,
      timeout visible, attente sans worker/tenant B intact, reprise et S3 simulé.

Voir le [runbook E](PHASE_E_WORKER_RUNBOOK.md) pour les commandes, limites, preuves
et rollback. **Implémentation locale ≠ déploiement ni gate supervision complet.**

---

## 3. PHASE F — Contrat de sync mobile bout-à-bout (C6)

> Issue **#40**. Le plus gros chantier. Dépend de B (fait) et E.

### F0. Diagnostic du contrat — reproduit

- [x] Staff sans device_id : push et pull HTTP **400** sur la vraie API.
- [x] Aucun enregistrement côté client staff ; `/devices` renvoie `{device_id}`.
- [x] Curseurs : push number, pull non vide string, pull vide number ; BIGINT pg.
- [x] Création enfant HTTP 201, mais **aucun événement child** au pull.
- [x] Nuance : pas de moteur de sync parent ; endpoints staff seulement, ne pas
      déduire un 400 de sync parent d'une simple absence de chaîne dans son code.

Diagnostic : `tests/diagnostics/sync-f0.mjs`, résultat synthétique versionné,
[analyse F0](PHASE_F_SYNC_DIAGNOSTIC.md). Requêtes reconstruites depuis le Dart,
**pas de client Dart exécuté**. Idempotence API vérifiée une fois les appareils
correctement enregistrés. Curseur local non scopé et autres risques à reproduire.

### F1. Établir le contrat comme artefact de première classe

Artefact versionné livré : [contrat v1](architecture/sync-contract.md).

- [x] Enveloppes exactes, erreurs, types et limites : `packages/sync-contract/`.
      Curseur string int64 partout ; payloads métier/projections restent F3.
- [x] Générateur maison minimal : client réseau Dart et validateur API utilisés
      par le gate ; `--check` interdit les dérives. **Le moteur Flutter est maintenant branché en F2.**
- **Gate F1 deux côtés** : `scripts/check-sync-contract.mjs` doit réussir en CI :
  vrai Dart → six requêtes sérialisées → schéma AJV + vrais DTO TypeScript,
  corpus commun de 49 cas. Local sans SDK : `--node-only` explicitement partiel.
  Résultat de la dernière exécution : consulter PR #44 ; aucun skip Dart autorisé
  sur GitHub. Ce transport enregistreur n'est **pas** le gate F4.

### F2. Client Dart/Drift — implémenté, gate Flutter strict

Voir [runbook F2](PHASE_F2_CLIENT_RUNBOOK.md) pour les preuves avant correction,
le rollback et les limites de projection. Le résultat du gate réel est celui de
la dernière CI de la PR #44, pas celui du simple check historique `flutter-check`.

- [x] Client réseau généré branché via SyncClient ; enregistrement avant toute
      sync, fingerprint et device persistés ; retry serveur idempotent par scope.
- [x] Namespace `(tenant, utilisateur)` dans fichiers Drift distincts ; ancien
      fichier global préservé mais jamais réaffecté automatiquement.
- [x] Curseur texte et application de page dans une transaction Drift ; séquence
      locale persistée atomiquement avec la file ; aucune adoption du curseur push.
- [x] 400/401/403 visibles, retries automatiques bloqués ; pending conservés.
- [x] Garde single-flight avant connectivité, listeners/timers annulés ; client
      API à token fixe par session, réponses tardives ignorées à la clôture.
- [x] Pré-requis serveur : propriétaire du device exigé en push/pull et révocation
      self-service ; 7/7 tests API après reproductions 1/6 puis 6/7.
- **Gate F2** : vrai Flutter + Drift natif, tests de reprise/isolation/rollback/ACK,
  puis analyse ; Flutter 3.47.1 et `pub get --enforce-lockfile`. Aucun SDK local
  ni APK release revendiqué. Les tests de transport initiaux ont échoué **0/2**
  sur le vrai Flutter avant correction ; voir les runs archivés dans le runbook.
- **Ne pas déployer encore** : G/H2/H3 et Android release restent distincts.
  Journal/media sont désormais des projections de métadonnées explicites (pas de
  cache des dossiers/pièces jointes) ; validation du dernier HEAD obligatoire.

### F3. Corriger le serveur si nécessaire

- [x] Curseur cohérent string int64 : DTO sans Number, SQL sans cast int32,
      pull vide/non vide et push ; erreurs 400 avant SQL. Suite `phase29` **26/26**.
- [x] **F3b enfants** : producteur SQL transactionnel, projection minimale de 13 champs,
      bootstrap initial et tombstones ; migration 059. API : 3/10 avant → 13/13 enrichis.
      Flutter : 23/31 avant correction (8 vrais rouges), gate strict du dernier HEAD requis.
      Voir [runbook F3b](PHASE_F3B_CHILDREN_RUNBOOK.md), limites et rollback.
      La batterie contient désormais 35 suites/contrôles.
- [x] **F3c publication** : 2/8 avant → 8/8 après ; migration 060, allocation après
      verrou transactionnel par tenant (default BIGSERIAL retiré), journal append-only
      pour les écrivains applicatifs. Suite enrichie 10/10 avec les projections présence.
      [Runbook F3c/F4](PHASE_F3C_F4_RUNBOOK.md) ; batterie portée à 36 suites/contrôles.
- [x] Scope utilisateur du device vérifié côté API en F2 ; FK simples depuis 006.
- [x] Intégrité composite SQL : migration **061**, device/membership, opération/device/
      propriétaire, curseur/tenant, origine/tenant. Reproduction `phase34` **1/10 → 10/10**
      avec les deux défauts DATE journal. Contraintes validées, aucun effacement/cascade.
- [x] Projections `daily_log` et `media` : métadonnées explicites, tous les types
      actuellement produits, Drift v3 dans le même fichier scopé, migration v2 testée.
      DATE journal corrigée côté publication/retour création ; anciennes publications
      non réparées automatiquement. [Runbook clôture F/H1](PHASE_F_COMPLETION_H1_RUNBOOK.md).
- [x] **F3a conflits/résultats** : 0/15 avant correction → 18/18 ciblés après ;
      contrôle de version avant mutation, résultat persisté/rejoué, ACK après COMMIT,
      retry concurrent sérialisé et rollback sur INTERNAL_ERROR. Migration additive 058.
      Voir [runbook F3a](PHASE_F3A_OUTCOMES_RUNBOOK.md) ; batterie désormais 34 suites,
      résultat complet/CI à consulter sur le dernier HEAD de la PR #44.
      **F3 implémenté** pour les quatre types actuellement produits ; toute projection
      inconnue/malformée reste bloquante atomiquement. Aucun contenu privé ajouté.

### F4. GATE — test bout-à-bout (le vrai livrable)

- [x] Gate réel implémenté et obligatoire en CI : **Flutter/SyncEngine/Drift/Dio → API**,
      deux appareils, push/pull, rejeu, conflit, reprise disque et changement de tenant.
      Pas de FakeApi ni de fixtures réseau reconstituées en Node. Inspection PG indépendante.
- **Preuve avant correction** : 3/5 tests réels passent ; date de présence timestamp
      au lieu de DATE, version miroir 0 au lieu de 1. Projections corrigées ; résultat
      final des cinq tests/annotations `F4 Flutter API passed` à consulter dans la PR #44.
- Le fallback de contrat F1 est conservé mais n'est **plus substitué** au parcours réel.
- [x] Gate étendu aux **quatre projections produites** : sept tests réels, neuf types
      journal, photos HTTP/sync et document sans enfant, reprise et isolation. Baseline
      `33ab34e` : **4/7**, journal/media/reprise rouges avant correctif. Inspection PG
      indépendante : 11 opérations, 9 événements journal, 3 médias, pas de doublons.
      Batterie portée à **37 suites/contrôles** ; résultat de clôture du **dernier HEAD**
      dans les checks PR #44 (`F4 Flutter API passed` requis, pas le seul job Flutter).
      **7/7 + PG acquis sur d9d2720**, run `34855762767` ; 37/37 local. Le gate
      global de ce run reste rouge pour les nouveaux défauts d'image H1 ci-dessous.
- [ ] **Qualification de déploiement / Android APK release** : distincte de F fonctionnelle.
      Journal/media sont des métadonnées, pas un téléchargement offline des dossiers.
      G/H et revue confidentialité/stockage restent nécessaires avant déploiement.

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

- [ ] Vérifier la chaîne de terminaison après le handler (depuis E1 :
      `jobs_finish_leased` dans `job-runtime.ts`, conditionné au bail) ;
      confirmer que le drain (E3) est la seule voie et que `send_parent_notification` ne marque pas
      « sent » trop tôt.
- [ ] `next_org_sequence` non hashé → numéros de facture devinables. Décider : séquentiel est
      souvent **légalement requis** → si oui, **ADR de décision** ; sinon composant non devinable.
- [ ] DPIA auto-approuvable sans audit : séparation des rôles (approbateur ≠ déclarant).

---

## 5. PHASE H — Staging, dette MEDIUM/LOW

> Issue **#42**. Staging doit marcher **avant** le reste de H (il sert à valider tout le reste).

### H1. Réparer staging et dev

- [x] Finding « tests non monté » : déjà corrigé par **c5cfab4** (D), dans staging
      et production. Ne pas annoncer une nouvelle réparation fictive. Le chemin
      `tests/tenant-isolation/schema-check.mjs` reste compatible avec les appels livrés.
- [x] Nouveau défaut **reproduit en vrai** : pull `minio/minio:latest` refusé, runs
      `34854334290` / `34854690262`. Image Quay versionnée + digest dans staging/prod/dev.
      Contrat structurel : **8/11 → 11/11** ; le téléchargement reste vérifié en CI.
- [x] Défauts runtime reproduits après restauration de MinIO : presigner AWS
      absent après prune, puis bcryptjs non hoisté absent de l'image. Dépendances
      API runtime déclarées, modules du workspace copiés ; garde `npm ci --omit=dev`
      isolé rouge → vert. Lock : métadonnées uniquement, aucune version/intégrité changée.
- [x] **GATE réel implémenté et obligatoire** dans le runner CI existant, aucun workflow
      modifié : build images livrées → vrai compose staging → bootstrap/migrate/seed/
      schema-check → HTTP health API + job worker réellement terminé → destruction
      des volumes synthétiques. Un échec H1 garde le gate global rouge. Résultat du
      dernier HEAD : notice `H1 staging passed` dans PR #44, pas un healthcheck simulé.
- [x] Défauts dev reproduits : contextes hors monorepo, Dockerfile web absent,
      npm install, montages masquants, identité migrateur refusée (`MIGRATION_ROLE_UNSAFE`),
      proxy Vite HTTP 500 et Host Arena 403. Correctifs : npm ci racine, bootstrap
      rôles séparés DEV_*, sources RO, proxy serveur vers `api:3000`, allowlist ciblée.
      **9/9** nouveaux tests verts ; démarrage réel local Nest/Vite/ts-node et job worker
      vérifiés, migration/seed/schema-check verts sur PostgreSQL jetable.
- [x] **Qualification Docker dev confirmée en CI sur `0870317`** : gate `--dev` ajouté au runner
      existant, sans workflow. Exige images livrées, bootstrap, migration/seed/schema-check,
      vrai HTTP API, proxy/HTML web et job worker ; aucun override des commandes/montages.
      CI **34868421539**, check **104057998864**, succès **21m50s**, **9/9 checks** :
      notices `H1 dev passed`, `H1 staging passed`, F2 et F4 vérifiées. Docker absent
      localement : cette preuve provient de la CI, pas des seuls tests locaux.
      [Runbook dev](PHASE_H1_DEV_RUNBOOK.md) : lancement neuf, secrets locaux, rebuild,
      worker sans watch, anciens volumes conservés. G/H2/H3 restent ouverts.
- [ ] Revue de maintien/sécurité du stockage requise avant déploiement ; le pin MinIO
      n'est pas une qualification CVE ni un choix définitif de fournisseur.
- Voir [runbook F/H1](PHASE_F_COMPLETION_H1_RUNBOOK.md). G reste ouvert ; ce chantier
      synthétique n'autorise aucun déploiement réel, ni à sauter H2/H3.

### H2. MEDIUM (par grappes homogènes)

- [ ] **Confidentialité — grappe commune en cours**, pas clôturée :
  - [x] **H2a** : publication journal/push/WhatsApp/inbox et exports de droits corrigés
        après reproduction réelle HTTP + PostgreSQL : **5/21 → 21/21** scénarios.
        Opérateurs privacy limités à director/super_admin ; autres utilisateurs scopés
        à leurs demandes et liens actuels. Notes privées/masquées exclues, projection
        enfant explicite, droits journal/santé/factures recalculés à chaque export.
        Le finding Excel médical est précisé : déjà refusé par `/exports`, fuite réelle
        via `/privacy/requests/:id/export`. Exports financiers du comptable conservés.
        [Matrice](architecture/authorization-matrix.md) et [runbook H2](PHASE_H2_CONFIDENTIALITY_RUNBOOK.md).
  - [x] **H2b notifications** : prédicat partagé producteur/worker/inbox, droits
        revalidés après claim et avant fournisseur, inbox filtrée avant LIMIT et
        mark-read protégé. Anciennes queues WhatsApp sans références refusées avec
        motif conservé, sans purge/retry automatique. **13/50 → 50/50** scénarios
        réels API/PG/worker avec transports HTTP locaux, dont révocation après claim.
        [Runbook H2b](PHASE_H2B_NOTIFICATION_RUNBOOK.md). Pas de qualification des
        fournisseurs réels ni de rappel garanti des messages déjà en vol/livrés.
  - [x] **H2c portail parent — accès enfant courants** : 13 routes protégées par
        un prédicat commun de lien gardien/enfant, utilisateur et membership actuels.
        Droits journal/santé/factures distincts, consentements liés conservés.
        **107/156 → 156/156** scénarios HTTP/PG, dont écritures refusées sans mutation.
        Les refus déjà effectifs sont des non-régressions, pas de nouveaux findings.
        [Runbook H2c](PHASE_H2C_PARENT_ACCESS_RUNBOOK.md) ; résultat complet et CI
        du SHA publié à vérifier en PR #44. Ni rappel d'URL signée ni révocation JWT globale.
  - [x] **H2d projections financières parent** : listes/détails factures et reçus
        à champs explicites, sans notes internes ni réponse brute passerelle ;
        `pdf_ready` remplace la clé PDF dans le JSON, route PDF protégée conservée.
        **32/44 → 44/44** HTTP/PG, dont vrai adaptateur de paiement avec initialisation
        HTTP signée vers un fournisseur loopback. Accès comptable et données internes en base conservés.
        [Runbook H2d](PHASE_H2D_FINANCIAL_PROJECTION_RUNBOOK.md) ; pas de qualification
        SATIM réelle ni purge d'historique. Gates complets/CI à vérifier en PR #44.
  - [x] **H2e journal/santé** : règle de visibilité partagée fil parent/nouveaux
        exports de droits ; `temperature` et `health_observation` nécessitent santé
        en plus du journal, avec filtrage avant LIMIT. Valeurs/événements autorisés
        conservés, sources et snapshots antérieurs intacts. **28/36 → 36/36** HTTP/PG,
        dont publication HTTP de 101 événements pour le test de pagination.
        [Runbook H2e](PHASE_H2E_JOURNAL_HEALTH_RUNBOOK.md) ; gates complets/CI du SHA
        publié à vérifier en PR #44. Pas de classification de tout texte libre ni de révocation JWT globale.
  - [x] **H2f acteur des demandes privacy** : utilisateur agissant actif/non supprimé
        et membership présente/active avant création, liste, détail, export et résolution.
        Contrôle aussi pour les opérateurs, sans bloquer le traitement d'un demandeur
        inactif par un opérateur actif. Historique personnel d'un demandeur actif conservé.
        Reproduction finale **68/156 → 156/156**, **43/43 suites strictes** locales.
        [Runbook H2f](PHASE_H2F_PRIVACY_ACTOR_RUNBOOK.md) ; CI **34903495839**,
        **9/9 checks** sur `5814ed0`, database **104174698221** confirmé. Pas de revalidation des rôles ni révocation JWT globale (G).
  - [x] **H2g consentements photo parent** : helper commun publication/nouvelle URL,
        primaire inclus et participants dédupliqués, déclaration/flag vérifiés,
        enfants du tenant non supprimés et derniers consentements accordés/non révoqués.
        **35/58 → 58/58** HTTP/PG ; photos autorisées, retrait de visibilité et accès
        interne staff conservés. Métadonnées historiques incohérentes refusées sans purge.
        [Runbook H2g](PHASE_H2G_PHOTO_CONSENT_RUNBOOK.md) ; **44/44 suites strictes**
        locales, rejeu final frais confirmé ; CI du SHA publié à confirmer. Ni analyse des octets, ni rappel des URLs déjà signées,
        ni qualification du stockage réel ou de nouvelles politiques document/MIME.
  - [ ] **Suite confidentialité** : autres projections santé/journal/médias et contrôles de gardien,
        snapshots privacy historiques et routes registre/DPIA/violations. Révocation
        globale des tokens et autres routes toujours à traiter en G. Pas de purge
        masquante ; la grappe et l'aptitude à la production ne sont pas clôturées.
- [ ] **`anonymize.sql`** : laisse `guardians`/`staff`/`messages`/`sessions` intacts (RGPD/loi 25-11).
- [ ] **`/metrics` public** + totaux cross-tenant + format Prometheus invalide → authentifier (ou
      restreindre au réseau interne) et valider le format avec un parseur Prometheus réel.
- [ ] **OpenAPI** : « prétendu auto-généré, aucun swagger, < 10 % des endpoints » — vérifier ;
      soit générer réellement (prérequis F1), soit arrêter de le prétendre dans la doc.
- [ ] **`STORAGE_BACKEND`** : défaut divergent config prod vs runtime → aligner, échouer au
      démarrage si ambigu.
- [ ] **Invitation token affiché sans garde `NODE_ENV`** → n'afficher qu'en `development`.
- [ ] **Payroll sans prorata** : décision client encore nécessaire ; la règle E5 des contrats de garde ne se transpose pas implicitement à la paie.
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
- [ ] Timezone UTC+1 vs UTC éparpillé : E4 fixe worker/exports/factures ; auditer et harmoniser les autres modules séparément.
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
| `053_jobs_reap_stale.sql` | **créée** : reaper, baux et heartbeat de jobs orphelins | E1 |
| `054_notif_queue_finish_fix.sql` | **créée** : conserver le motif, contrat de statut inchangé | E3 |
| `055_rls_and_race_fixes.sql` | pattern GUC (régression 029 vs 018) + `FOR UPDATE` trigger 023 | G2 |
| `056_scheduler.sql` | **créée** : ticks, coordination, 3 producteurs et santé | E2 |
| `057_export_lifecycle.sql` | **créée** : échecs, délais et reprise des exports | E6 |

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

# Batterie complète (44 suites/contrôles après H2g) — rôles stricts : voir runbook H2g
bash scripts/run-isolation-suites.sh

# Suite Phase C seule
node tests/tenant-isolation/phase25-security-audit-c.api.test.mjs

# Gates A/B (doivent rester verts à chaque session)
npm audit --omit=dev                          # → 0 vuln
npm run check:android-manifest                # → exit 0
npm run check:routes-inventory                # inventaire des 172 routes (44 sans garde)
npm run typecheck && npm run lint && npm run test:unit && npm run build
```
