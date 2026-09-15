# ADR-012 — Reprise des jobs par bail renouvelable

- Date : 2026-09-14
- Statut : retenu pour E1, installation neuve (D0 confirmé)
- Issue : #39 ; migration : `053_jobs_reap_stale.sql`

## Contexte et reproduction

Un worker réclame un job puis meurt : la ligne reste `processing` indéfiniment,
puisque le claim ne prend que `pending`. Le vrai processus a été tué par SIGKILL
pendant un `retention_purge` bloqué sur un verrou PostgreSQL ; un deuxième worker
ne reprenait pas le job. SIGTERM interrompait aussi le handler au lieu d'attendre.
Enfin, `jobs_finish()` pouvait marquer `done` un job encore `pending`.

Les quatre tests initiaux de `phase27-worker-lifecycle.test.mjs` ont été écrits et
exécutés avant correction : tous échouaient pour ces comportements (dont absence
de la fonction reaper). Aucun handler factice ni sleep injecté dans le worker.

## Décision

- Un claim atomique produit un UUID `lease_token` et un `heartbeat_at`.
  Le numéro de tentative retourné est celui effectivement incrémenté en base.
- Le worker renouvelle ce bail pendant l'exécution. Le reaper ne considère comme
  orphelin qu'un job sans heartbeat récent ; pour les lignes historiques, repli
  sur `started_at`, puis `created_at`.
- Toutes les terminaisons et tous les heartbeats sont conditionnés à **id + token
  + statut processing**. Le numéro de tentative seul ne convient pas : le support
  peut remettre `attempts` à zéro et réutiliser ce numéro.
- L'ancienne fonction `jobs_finish()` ne touche plus les jobs avec un bail, ni
  les statuts autres que processing. Elle ne contourne donc pas le fencing.
- Reaper au boot puis toutes les 5 minutes, dans une boucle indépendante du
  handler. SQL par batches de 500, `FOR UPDATE SKIP LOCKED`, relance immédiate
  d'un batch plein : plusieurs workers peuvent coopérer sans réclamer deux fois
  la même tentative. Les tentatives épuisées deviennent `failed` et conservent
  `WORKER_LEASE_EXPIRED` ; les autres redeviennent immédiatement éligibles.
- Pool de contrôle réservé (2 connexions), avec délais de connexion/requête/SQL
  bornés ; ne pas mettre le heartbeat derrière une requête métier longue.
  Perte ou échec du renouvellement : sortie en erreur du worker, plutôt que
  poursuivre silencieusement un handler dont le bail n'est plus assuré.
- SIGTERM/SIGINT : plus de nouveaux claims, heartbeat maintenu pendant le travail
  déjà réclamé, puis fermeture des pools et sortie 0. Deadline par défaut 45 s,
  délai Docker 60 s. Au-delà de 45 s, sortie 1 et récupération par le reaper.

## Garantie et limites

La garantie est **au moins une fois**, pas exactement une fois. Le fencing
protège la propriété et la clôture de la ligne `background_jobs`, pas une requête
externe déjà envoyée ni un SQL métier déjà exécuté. Les handlers doivent être
idempotents ; l'outbox et la facturation mensuelle doivent encore être revues en
E2/E5 avant activation automatique. Un heartbeat ne constitue pas un timeout
métier : un handler vivant mais bloqué continue à renouveler son bail (E6 séparé).

Le reaper porte uniquement sur `background_jobs`, pas sur `notification_queue`.
La planification des quatre jobs métier (E2), les statuts de notification (E3),
les dates (E4), le prorata (E5) et les projections d'export (E6) restent distincts.

Les fonctions sont SECURITY DEFINER, propriétaires migrateur BYPASSRLS suivant
ADR-011, EXECUTE applicatif et aucun EXECUTE PUBLIC. Elles suivent le modèle des
jobs globaux existants ; elles ne remplacent pas la revue d'autorisation G2.

Déploiement sans mélange de versions : arrêter tous les anciens workers avant
053, appliquer avec le migrateur, démarrer uniquement les nouveaux workers.
Une mise à jour glissante avec des anciens claims sans bail n'est pas supportée.


## Complément E2–E6 — 2026-09-14

ADR-013 documente la suite livrée : trois producteurs planifiés (mensualité
**automatique OFF**), facturation/PDF atomiques, mois partiels exclus du job
mensuel, motifs de notification préservés et cycle de vie d'export. Le timeout
d'export est distinct du bail ; son fichier est isolé par token avant publication.
Le gate Prometheus/réception opérateur reste à valider hors sandbox. La garantie
at-least-once et la limite concernant notification_queue demeurent inchangées.
