# ADR-015 — Moteur PostgreSQL : version 18 uniforme

**Statut** : Accepté
**Date** : 2026-10-14

> Numérotation : le handoff Phase G (§3.4) réservait « ADR-015 » pour
> `next_org_sequence_numbering`. Cette décision moteur étant déjà tranchée par les faits
> (dépôt uniformément en 18) et nécessaire pour clore la ligne « choix 16 vs 18 » du plan §D,
> elle est consignée ici sous `ADR-015-moteur`. La numérotation de facture (`next_org_sequence`)
> prendra le prochain numéro libre (ADR-016) après décision client.

## Contexte

Le plan §D laissait ouverte la ligne « choix moteur 16 vs 18 ». Le dépôt, à la date de cette
décision, est **déjà uniformément en PostgreSQL 18** :

- CI (`.github/workflows/ci.yml`) : service `postgres:18`.
- Local : PostgreSQL 18.4 embarqué (`embedded-postgres@18.4.0-beta.17`, `run_pg.mjs`).
- Déploiement : `docker-compose.dev.yml`, `docker-compose.staging.yml`,
  `docker-compose.prod.yml` → tous `postgres:18-alpine`.

Seul un **commentaire** dans `ci.yml` (job backup-drill) citait encore « postgres:16 » — incohérent
avec les images réellement utilisées. Ce commentaire est corrigé pour refléter la réalité.

## Décision

- **PostgreSQL 18** est le moteur unique, en CI, en local et en déploiement (dev/staging/prod).
- Aucune prise en charge de 16/17. Le client `pg_dump`/`psql` doit être **≥ 18** (un `pg_dump`
  plus ancien refuse un serveur plus récent).
- La validation locale (18.4 embarqué) et la CI (`postgres:18`) partagent la même version majeure :
  pas d'écart de comportement entre banc d'essai et intégration.

## Conséquences

- Le drill de restauration (job `backup-drill`) s'appuie sur `postgres:18` + client 18 : cohérent.
- Une future montée de version majeure PostgreSQL = nouvel ADR + revue des migrations
  (ADR-007 : migrations immuables, mais une montée de moteur peut nécessiter de nouvelles
  migrations de compatibilité).
- Le commentaire `ci.yml` ne doit plus jamais diverger des images `docker-compose` : toute
  montée se propage aux quatre fichiers dans le même changement.
