# ADR-013 — Scheduler PostgreSQL et calendrier métier du worker

- Date : 2026-09-14
- Statut : retenu ; fréquences et facturation validées par le client
- Issue : #39 ; migrations : 054, 056, 057 (055 réservée à G2)
- Prérequis : ADR-011 (rôles de production), ADR-012 (baux)

## Reproduction

Les quatre handlers existaient sans producteur périodique. Avec des données
synthétiques expirées, aucun job de purge/expiration n'était exécuté. Les tests
ont également montré qu'un handler de purge vidéo ou de paiements s'arrêtait au
premier lot de 500. Les régressions sont dans `phase28-worker-reliability.test.mjs`.

## Choix du client

| Traitement | Fréquence validée |
|---|---|
| `video_clips_purge` | Chaque jour à 02 h, Africa/Algiers |
| `retention_purge` | Chaque jour à 02 h, Africa/Algiers |
| `payments_expire` | À chaque heure pleine, Africa/Algiers |
| `send_monthly_invoices` | **Automatisation désactivée** ; invocation manuelle seulement |
| Reaper des baux | Toutes les 5 minutes, inchangé depuis E1 |

Un mois partiel n'est pas facturé. Un contrat actif doit couvrir le premier et
le dernier jour du mois inclus. L'échéance par défaut est la fin du mois ; une
échéance explicite d'un job manuel reste un override opérateur (choix de
compatibilité documenté, pas une question supplémentaire posée au client). Pas de changement
rétroactif des factures existantes/payées. **Aucune règle de paie n'est décidée ici.**

## Décision technique

Une boucle interne appelle `scheduler_enqueue_due()` au boot puis chaque minute.
`scheduler_ticks` persiste le prochain instant, le dernier enqueue et le dernier
succès. Les instants sont des `timestamptz` ; le calcul civil est explicitement
fait dans `Africa/Algiers`, indépendamment du TZ des processus et sessions SQL.

- Verrou de ligne `FOR UPDATE SKIP LOCKED` : plusieurs workers peuvent coopérer.
  L'insertion du job et l'avancement du tick sont dans la même transaction SQL.
- Les retards sont **coalescés** en une exécution, pas rejoués heure par heure.
  Aucun deuxième job planifié du même type tant qu'un précédent reste pending
  ou processing. Un job en échec terminal permet un nouveau job au tick suivant.
- La première installation programme le prochain instant futur. Un redémarrage
  ne réinitialise pas le calendrier ; un tick passé est traité au prochain poll.
- `organization_id=NULL` pour les trois traitements globaux, via les fonctions
  SECURITY DEFINER existantes. La facturation manuelle exige toujours un tenant.
- Table interne avec FORCE RLS, aucune politique d'écriture applicative. La
  mensualité est désactivée **et protégée par CHECK** : modifier une variable
  d'environnement ne peut pas l'activer. Une future activation nécessite une
  nouvelle décision client, du code producteur par tenant et une migration.
- Les purges vidéo et paiements drainent les lots de 500 jusqu'à épuisement.
  Une erreur de stockage garde la ligne vidéo et fait échouer le job, plutôt
  que d'annoncer une purge réussie alors que le fichier subsiste.

### Alternatives écartées

Un cron externe ajouterait un déploiement, des credentials et un protocole de
coordination. `pg_cron` demanderait une extension absente de l'image standard.
Le scheduler interne réutilise la file et la coordination PostgreSQL ; il ne
supprime toutefois pas le besoin d'une supervision indépendante des workers.

## Supervision indépendante

Le succès est enregistré par un trigger uniquement quand un job portant le
marqueur `payload.scheduler=true` devient `done`. Enqueue ou heartbeat ne sont
**pas** des succès. `scheduler_health()` retourne trois types fixes, sans PII :
retard si aucun succès depuis deux périodes (2 h ou 48 h). Avant le premier
succès, le point de départ est la création du tick.

`postgres-exporter` interroge cette fonction sans dépendre d'un worker vivant.
Prometheus charge les règles de retard (5 min de confirmation), métrique absente
ou incomplète et exporter indisponible (2 min). Le worker journalise aussi
`SCHEDULER_OVERDUE` et transmet à Sentry si configuré, mais ce n'est **pas** le
mécanisme qui protège contre la mort de tous les workers.

Les fixtures `promtool` et leur commande sont livrées. Leur évaluation et le
routage vers un destinataire opérateur restent à valider dans un environnement
avec Prometheus/Alertmanager : aucun moteur Prometheus ni canal de réception
n'a été exécuté/configuré ici. Ne pas confondre un test SQL de fraîcheur, un test
structurel de Compose et un test d'alerte de bout en bout.

## Calendrier et exports (E4–E6)

Le worker configure l'OID PostgreSQL 1082 en chaîne ISO ; un `DATE` ne transite
jamais par un `Date` JavaScript. `@creche/prod-config` (`src/calendar.ts`) centralise la
validation réelle du calendrier, les bornes de mois et le fuseau métier. Les
heures de présence sont converties explicitement à Alger dans la requête SQL.
Les instants techniques restent des timestamps, normalement présentés en UTC.
Cette politique ne prétend pas avoir refactoré tous les modules de H3.

Les factures, leurs lignes et les jobs PDF sont créés dans la même transaction.
La ligne de garde ne contient que la garde ; repas/transport ont leurs propres
lignes. Calculs en centimes, arrondi de la remise au centime, invariants SQL C04
et unicité contrat/période conservés.

Un export possède une limite d'exécution (2 min) distincte de son bail renouvelé.
Après dépassement, le job est rendu terminal par token, sa projection est failed
et le worker sort : une Promise.race seule laisserait le handler continuer.
L'attente des exports pending est réconciliée à 30 min par la maintenance et
par la liste API, dans ce dernier cas pour le tenant courant uniquement. Une
reprise explicite par le support réinitialise cette fenêtre.

La publication vérifie/verrouille le bail avant la ligne d'export. Le chemin
`{tenant}/exports/{export_id}/{lease_token}.xlsx` est propre à chaque tentative :
un PUT tardif ne peut écraser l'objet d'un nouveau bail. Un crash peut laisser
un objet non référencé ; prévoir une politique de nettoyage/lifecycle séparée,
sans effacer les clés encore référencées. Pas de garantie exactly-once externe.
