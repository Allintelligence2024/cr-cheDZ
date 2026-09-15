# Phase E — fiabilité du worker : livraison et exploitation

## Complément E2 — routage multicanal et validation PR

Le client demande désormais local + e-mail + SMS + WhatsApp. Alertmanager et
le relais sont livrés, avec 4/4 tests de transport/reprise et un test Docker de
la chaîne complète ajouté à la CI existante (sans modification de workflow).
Voir [runbook alertes E2](PHASE_E2_ALERTING_RUNBOOK.md). **Gate E2 validé en CI**,
[PR #44](https://github.com/Allintelligence2024/cr-cheDZ/pull/44), commit `955b9cd` :
9/9 checks verts, y compris le test des vrais moteurs et la chaîne complète.
Aucune réception sur coordonnées réelles n'est revendiquée : activation opérateur
encore nécessaire. Les réserves plus bas décrivent la livraison précédente.
F0 est commencé : voir [diagnostic sync](PHASE_F_SYNC_DIAGNOSTIC.md).

## État de la livraison précédente — 2026-09-14

**E1–E6 implémentés localement**, après reproduction des défauts. Installation
neuve confirmée par le client : aucune opération de production, aucun push ni
déploiement. Les rôles séparés D restent obligatoires.

**Réserve de sortie E2** : les requêtes SQL de fraîcheur et le câblage de
supervision sont testés, mais le vrai moteur `promtool` n'est pas disponible ici
(téléchargements bloqués). Les fixtures d'alerte sont livrées, pas déclarées
exécutées. La réception opérateur/Alertmanager reste aussi à câbler et tester.
Le gate d'exploitation E2/#39 ne peut donc pas être déclaré entièrement clos.
Les réserves Docker, PostgreSQL 16/18 et câblage CI D restent ouvertes.

Décisions : [ADR-012 — baux](adr/ADR-012-worker-job-leases.md) et
[ADR-013 — scheduler](adr/ADR-013-worker-scheduler.md).

## Décisions client, sans activation implicite

| Sujet | Décision appliquée |
|---|---|
| Purges vidéo/rétention | Tous les jours à **02 h Africa/Algiers** |
| Expiration des paiements | Chaque heure pleine ; seuil SATIM >72 h inchangé |
| Facturation automatique | **Désactivée**, protégée par contrainte SQL |
| Job mensuel invoqué manuellement | Contrat actif couvrant le mois intégral ; aucun mois partiel facturé |
| Échéance | Dernier jour du mois par défaut ; échéance explicite manuelle conservée |
| Notifications | Statuts existants ; motif `PUSH_NOT_CONFIGURED_OR_NO_DEVICE` conservé |

`sent` signifie **queue traitée**, pas accusé de livraison push. Ces décisions
ne règlent pas le prorata de paie H et n'autorisent aucun changement rétroactif
sur les factures existantes/payées. Le maintien d'une échéance manuelle explicite
est un choix de compatibilité documenté, pas une validation client supplémentaire.

L'E5 de ce plan porte sur `send_monthly_invoices`, pas sur une refonte du point
HTTP de création unitaire de facture (`BillingService.generateInvoice`), qui
conserve son échéance explicite. Ne pas interpréter le défaut du job comme une
modification de tous les formulaires de facturation.

## Changements livrés

- **E1 / 053** : bail UUID, heartbeat, reaper de jobs orphelins, arrêt gracieux.
- **E2 / 056** : ticks persistés, coordination `FOR UPDATE SKIP LOCKED`, rattrapage
  coalescé, trois producteurs. Les purges vidéo/paiements drainent tous les lots
  de 500. Table interne FORCE RLS ; ni écriture de configuration applicative ni
  activation mensuelle par variable d'environnement.
- **E3 / 054** : le succès de traitement ne supprime plus le motif de non-envoi.
- **E4** : DATE PostgreSQL OID1082 → chaîne ISO, helper calendrier partagé,
  conversion des heures de présence à Alger, indépendantes des TZ Node et SQL.
  Vrais PDF et Excel testés sous `America/Los_Angeles` et `Asia/Tokyo`.
- **E5** : `start_date <= premier jour` et `end_date >= dernier jour` (ou NULL).
  Facture + lignes + enqueue PDF dans **une seule transaction**. La ligne de
  garde n'inclut plus les montants repas/transport déjà portés par leurs lignes.
  Calcul en centimes et remise arrondie au centime ; unicité et C04 conservés.
- **E6 / 057** : date simple = plage `[jour,jour]`, validation du calendrier et
  des plages inversées avant enqueue. Échec terminal projeté vers l'export,
  timeout d'exécution, attente bornée, reprise support, publication protégée
  par le bail et une clé de stockage distincte par tentative.

**56 migrations** au total : 001–054, 056, 057. **055 reste réservée à G2**.
001–052 n'ont pas été modifiées ; 053 livrée à l'étape précédente est conservée.

## Configuration du worker

| Variable | Défaut | Rôle |
|---|---:|---|
| `WORKER_JOB_TIMEOUT_MS` | 900000 | Expiration sans heartbeat (15 min) |
| `WORKER_HEARTBEAT_MS` | 30000 | Renouvellement pendant le handler |
| `WORKER_REAPER_INTERVAL_MS` | 300000 | Reaper au boot puis toutes les 5 min |
| `WORKER_POLL_MS` | 2000 | Attente sans job/après erreur de boucle |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | 45000 | Deadline après SIGTERM/SIGINT |
| `WORKER_SCHEDULER_ENABLED` | true | Production des trois jobs uniquement |
| `WORKER_SCHEDULER_POLL_MS` | 60000 | Tick métier et réconciliation des exports |
| `WORKER_EXPORT_TIMEOUT_MS` | 120000 | Durée maximale d'un handler export |
| `WORKER_EXPORT_MAX_AGE_MS` | 1800000 | Âge maximal pending pour la maintenance |

Durées entières positives bornées à la limite des timers Node ;
`heartbeat × 3 < timeout du bail`. Le bail n'est **pas** la durée maximale d'un
handler : un travail vivant le renouvelle. L'export a une deadline distincte.
Conserver le timeout d'export inférieur à sa fenêtre d'attente.

L'API réconcilie aussi, lors de la liste des exports, les attentes de plus de
**30 min pour son tenant seulement**, même sans worker vivant. Cette valeur API
est fixe ; changer seulement la variable du worker ne change pas ce garde-fou.
La maintenance travaille par lots bornés de 500 ; prévoir le poll, les batches
et une indisponibilité DB dans les délais opérationnels, pas un SLA temps réel.

`WORKER_SCHEDULER_ENABLED=false` arrête la **production** périodique, pas le reaper,
la réconciliation des exports ni l'exécution des jobs déjà en file. Les alertes
restent volontairement actives pendant une pause prolongée.

Compose prod/staging : arrêt applicatif **45 s**, `stop_grace_period: 60s`.
Jusqu'à 7 connexions PostgreSQL par worker : 5 métier + 2 de contrôle, avec délais
SQL/réseau bornés à deux périodes de heartbeat. Reprise habituelle d'un orphelin :
15–20 min après son dernier heartbeat si un worker et la DB sont disponibles.

## Supervision indépendante des workers

```sql
-- Exécutable avec le rôle applicatif, sans contexte tenant ni PII.
SELECT * FROM scheduler_health();
```

Trois lignes sont attendues. `overdue=true` signifie aucun **succès** depuis deux
périodes : 2 h pour les paiements, 48 h pour les purges. Avant le premier succès,
le délai part de la création du tick. Enqueue/heartbeat ne rafraîchissent pas le
succès. Un redémarrage ne remet pas les compteurs à zéro.

Fichiers câblés dans Compose prod :

- `infrastructure/monitoring/postgres-queries.yml` → postgres-exporter v0.15.0 ;
  métrique `creche_worker_scheduler_overdue{job_type=...}`.
- `infrastructure/monitoring/alerts.yml` → Prometheus via `rule_files` et volume.
- `WorkerScheduledJobOverdue` après 5 min de confirmation ;
  `WorkerSchedulerMonitoringUnavailable` si métriques absentes/incomplètes ;
  `DatabaseMetricsUnavailable` si exporter absent/arrêté (2 min).

Le moniteur n'a pas besoin d'un worker vivant. Le worker journalise aussi
`SCHEDULER_OVERDUE` et transmet à Sentry si configuré, mais ce n'est pas le seul
mécanisme d'alerte. Ne jamais éditer `last_success_at` pour masquer un incident.

**Avant clôture E2 / avant production :**

```bash
# Avec promtool 2.53.0 disponible (PROMTOOL=/chemin/promtool si nécessaire) :
npm run check:worker-monitoring
```

Cette commande retourne **2** si l'outil manque, jamais un faux vert. Les fixtures
couvrent retard sans métrique worker, résolution, exporter mort, requête absente
et trois traitements sains. Ensuite démarrer les images cibles, vérifier les
métriques exposées, arrêter tous les workers sur des données jetables, simuler
un retard puis vérifier le firing et sa **réception par l'opérateur**. Aucun
Alertmanager/destinataire n'est configuré dans cette livraison ; le routage doit
être ajouté à l'environnement d'exploitation. Le Compose staging n'embarque pas
la stack de monitoring : la raccorder explicitement pour ce gate. Vérifier aussi son alignement de stockage
API/worker (`STORAGE_BACKEND`, `S3_BUCKET`) et des secrets : ce Compose n'a pas été
validé par un démarrage réel dans cette phase.

## Installation / mise à jour — opérateur, non exécutée ici

1. Vérifier les gates D et la version cible PostgreSQL. Si des données réelles
   existent désormais : sauvegarde restaurée hors production et maintenance
   suivant BACKUP-RUNBOOK.md, avant toute intervention.
2. Stopper tous les anciens workers. Ne pas mélanger anciens claims et protocole
   053. Suspendre les demandes d'export pendant la migration/code si nécessaire.
3. Appliquer les migrations et seeds avec `MIGRATION_DATABASE_URL` migrateur ;
   schema-check avec `DATABASE_URL` applicatif. D réapplique les grants, sans
   privilège d'ownership/BYPASSRLS ajouté à l'application.
4. Déployer ensemble API/worker compatibles 057. Vérifier rôle `creche_app`,
   garde-fous de production, `scheduler_health()` et absence de job mensuel auto.
5. Déployer exporter/règles, valider le gate d'alerte ci-dessus et un canari
   idempotent. La première installation vise le prochain tick futur ; un retard
   persistant est rattrapé sans tempête de jobs.

### Retour arrière sûr

Arrêter les nouveaux workers ; conserver 053/054/056/057 et les données, puis
livrer une correction additive. Ne pas lancer une vieille image sur des baux
actifs, supprimer `schema_migrations`, modifier un checksum appliqué ou supprimer
un volume. Suspendre les nouvelles demandes d'export si l'API doit être retirée.
`WORKER_SCHEDULER_ENABLED=false` permet de suspendre les nouveaux ticks, **pas**
d'annuler les jobs déjà produits. Faire examiner ces jobs avant toute reprise.

Le reaper peut être déclenché par l'opérateur autorisé :

```sql
SELECT jobs_reap_stale(INTERVAL '15 minutes');
```

Ne pas raccourcir ce délai sur des jobs vivants. Recommencer un résultat de 500
jusqu'à un lot incomplet pour un rattrapage manuel ; le worker le fait déjà.

## Diagnostic et limites

- `WORKER_LEASE_EXPIRED` : reprise ou tentatives épuisées ; examiner le job.
- `JOB_LEASE_LOST` : ancienne tentative arrêtée ; vérifier réseau/DB/CPU.
- `WORKER_SHUTDOWN_TIMEOUT` : sortie 1, récupération ultérieure par le reaper.
- `EXPORT_TIMEOUT` : export terminal failed ; worker sort 1 pour tuer le handler
  dépassé. Le superviseur doit redémarrer le processus.
- `EXPORT_QUEUE_TIMEOUT` : attente dépassée ; échec visible à la prochaine
  réconciliation. Une reprise via `support_retry_job` réouvre la fenêtre.
- `VIDEO_PURGE_PARTIAL` : une suppression stockage a échoué ; la ligne reste
  disponible pour retry. Ne pas considérer les fichiers comme supprimés.
- `PUSH_NOT_CONFIGURED_OR_NO_DEVICE` avec `sent` : queue traitée sans push livré.

Garantie **at-least-once**, pas exactly-once externe. Pour les exports, le token
est vérifié sous verrou avant publication, et chaque tentative a sa propre clé
`{tenant}/exports/{export_id}/{lease_token}.xlsx`. Un PUT tardif ne peut remplacer
un autre bail. Un crash peut laisser un objet non référencé : prévoir un nettoyage
lifecycle/inventaire séparé, sans effacer des objets encore référencés. La purge
vidéo ne purge pas ces objets Excel. La reprise des notifications processing
après crash n'est pas ajoutée par E3 : le reaper 053 porte sur background_jobs.

## Reproductions et preuves

`phase27` utilise un vrai verrou SQL et de vrais SIGKILL/SIGTERM/SIGINT :
**0/4 avant → 4/4 après**, puis **14/14** cas de baux, concurrence et arrêt.

`phase28` utilise l'API, les vrais handlers, de vrais fichiers PDF/XLSX et
PostgreSQL. Les reproductions avant correction sont conservées dans les logs :

| Cas | Résultat avant |
|---|---|
| Notification sans device | `sent`, motif NULL |
| Excel DATE, TZ négatif/positif | `Tue Sep 01` au lieu de `2026-09-01` |
| PDF en TZ positif | Échéance décalée au jour précédent |
| Export date simple | SQL invalide `2026-09-01-01` |
| Export : échec stockage | Job failed, rapport pending |
| Contrats partiels/futurs | Quatre factures au lieu de la seule couverture complète |
| Total des lignes | 16400 au lieu de 13200 (repas/transport doublés) |
| Échec enqueue PDF | Facture conservée malgré l'échec du job |
| Producteurs périodiques | Aucun des trois effets exécuté |
| 501 vidéos/paiements | Une ligne expirée reste après le premier batch |
| Reprise d'export S3 | Les deux tentatives écrivent la même clé |

Suite étendue : **23/23** avec les rôles de production et **23/23** en mode
historique `creche_app_test`. Elle couvre aussi
le rejeu sans facture double/payée modifiée, l'échéance par défaut, la validation
calendaire, le timeout avec vrai blocage SQL, la réconciliation API sans worker,
le tenant B préservé, la reprise support et le PUT retardé sur un endpoint S3 de
test. Ce dernier n'est pas une validation d'un service S3/MinIO réel.

Sur une **base/cluster jetable dédiés** (les rôles sont globaux) :

```bash
npm ci
npm run build --workspace @creche/api
npm run build --workspace @creche/worker
# PostgreSQL embarqué : node run_pg.mjs, process long séparé.
ALLOW_DATABASE_RESET=1 \
DATABASE_URL=postgres://postgres:postgres@localhost:54329/creche_test \
npm run test:production-roles
```

Le runner exécute 8 tests structurels Compose, 3 de câblage monitoring, 14 tests D,
puis reset/migrate/seed et **31 suites/contrôles** (29 historiques + E1 + E2–E6).
App/worker/RLS : `creche_app` ; DDL/seeds : `creche_migrator` ; fixtures : admin.
Les helpers stricts n'ajoutent aucun grant. Le schéma contient 56 migrations.

Le premier passage complet a donné 30/31 : seul un test ajouté appelait par
erreur `jobs_next_leased()` au lieu de `jobs_claim_leased()`. Appel corrigé ;
23/23 rejoués dans les deux modes. Ce n'était pas une régression de l'application.
Preuve du passage initial : `/tmp/phase-e-gate-first-30of31.log`.

### Bilan de validation local

- Ciblés : E1 **14/14**, E2–E6 **23/23**, Compose **8/8**, monitoring structurel **3/3**.
- Typecheck, lint `--max-warnings=0`, unitaires **27/27** : verts.
- `npm audit --omit=dev` : **0 vulnérabilité** ; lockfile inchangé.
- Gate complet D+E : **31/31 suites/contrôles verts, exit 0**, avec rôles et
  grants de production. Précontrôles 8 Compose + 3 monitoring + 14 D verts.
  E1 14/14 et E2–E6 23/23 confirmés dans cette batterie finale.
- Build de tous les workspaces : **réussi**.
- Promtool : **non exécuté**, commande de gate exit 2 (outil absent).
- Garde Android : exit 0, 4 avertissements ; aucun APK release construit ici.
  Inventaire inchangé : 172 routes, 44 sans garde déclarée à revoir en G/H.
- Migrations 001–052, workflows et lockfile inchangés. Aucun push/déploiement.

Preuves temporaires de cette session : `/tmp/e28-red.log`,
`/tmp/e28-batch-red.log`, `/tmp/e28-extra-red.log`, `/tmp/e28-pdf-red.log`,
`/tmp/e28-final-targeted.log`, `/tmp/e28-legacy-final.log`, `/tmp/e27-rest-regression.log`,
`/tmp/phase-e-complete-gate.log`, logs détaillés `/tmp/creche-roles-gate-Ckk5WX`,
`/tmp/phase-e-complete-build.log`, `/tmp/phase-e-complete-unit.log`,
`/tmp/phase-e-complete-audit.log`, `/tmp/e2-promtool-gate.log`.
Ces logs /tmp ne sont pas des artefacts Git durables : les tests et commandes
ci-dessus sont la preuve reproductible à conserver en CI.
