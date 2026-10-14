# ADR-014 — `outbox_events` conservée sans producteur général

**Statut** — Accepté (2026-10-05, remédiation 3.1.7)
**Contexte** — Le rapport d'audit (297 constats) liste `outbox_events` comme
« table promise, indexée, RLS — mais aucun producteur ni consommateur » et
demande : implémenter le pattern transactional outbox, ou supprimer la table.

## Décision

**On conserve la table, sans lui ajouter un producteur/consommateur
généralisé.** Le pattern transactional outbox est déjà implémenté dans ce
monorepo par deux mécanismes spécialisés, chacun transactionnel :

| Besoin | Mécanisme | Transactionnel ? |
|---|---|---|
| Notification parent (push + inbox) | `notification_queue` (migration 011) | **Oui** — `notifyGuardiansOfEvent(client, …)` reçoit le `PoolClient` de la transaction métier et y écrit la ligne ; commit atomique avec l'événement (check-in, journal…). Drainée par le worker (`drainNotificationQueue`). |
| Travail différé (PDF, exports, relances) | `background_jobs` (migration 014) + `scheduler_enqueue_due()` | **Oui** — l'insertion se fait dans la transaction métier (`billing.service.ts`, `exports.service.ts`) ; le worker prend le bail (`ADR-012`). |

Il n'existe **aucun consommateur externe** (webhook sortant, intégration
tierce, event broker) dans le périmètre de l'application. Ajouter un
producteur/consommateur générique sur `outbox_events` dupliquerait
`notification_queue` — même garantie, deux files, deux sources de vérité, et
le risque réel de voir les deux diverger.

## Pourquoi ne pas supprimer la table

`outbox_events` est une table de schéma **publiée** (migration 014), référencée
par l'inventaire RLS et le schéma-check CI. La supprimer coûte une migration
supplémentaire, un re-test complet des suites d'isolation, et retire un point
d'extension explicite pour le jour où un webhook sortant deviendra
nécessaire (adrhésion à la loi 25-11, marketplace, ou integrations). Le coût
de la garder est nul (zéro code, zéro worker) ; le coût de la supprimer est
réel et non réversible sans nouvelle migration.

## Conséquences

- `outbox_events` reste **vide en production** — c'est attendu et surveillé :
  toute ligne écrite indique qu'un nouveau producteur a été ajouté, et doit
  être accompagné de son consommateur.
- La décision est écrite ici pour que le prochain audit ne la re-signale pas
  comme un travail inachevé.
- Si un webhook sortant devient nécessaire : écrire le producteur dans la
  transaction métier, le consommateur dans le worker, et supprimer alors
  `notification_queue` **uniquement si** la sémantique de livraison est
  strictement remplaçable (push + inbox ne le sont pas aujourd'hui).

## Alternatives rejetées

1. **Supprimer la table** — migration + re-test pour un gain nul (zéro code
   ne la référence aujourd'hui).
2. **Implémenter un outbox générique** — duplication de `notification_queue`,
   deux files pour un même besoin, divergence inévitable.
