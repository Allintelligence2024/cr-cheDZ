# ADR-011 — Identités PostgreSQL de déploiement et d'exécution

- Date : 2026-09-14
- Statut : accepté pour installation neuve (D0 confirmé avec le client)
- Issue : #38 ; runbook : [Phase D](../PHASE_D_ROLES_RUNBOOK.md)

## Contexte et reproduction

Le Compose utilisait le même `DATABASE_URL` pour migrer et servir. Le rôle
applicatif pouvait être le superuser d'initialisation. Le `IF NOT EXISTS` de
`roles.sql` ne retirait pas les privilèges d'un rôle existant. Les tests historiques
construisaient un autre rôle (`creche_app_test`) avec leurs propres grants : leurs
résultats ne prouvaient pas le déploiement.

Avant correction, les quatre premiers tests `phase26-production-roles.test.mjs`
échouaient : attributs dangereux conservés, provider API acceptant un superuser,
runner acceptant `creche_app`, table future du migrateur inaccessible à l'app.

## Décision

1. Bootstrap transactionnel et rejouable avec `postgres`, avant le migrateur.
   Pas de secret par défaut, secrets administrateur/migrateur/app distincts.
2. `creche_migrator` possède le schéma et les objets métier : **NOSUPERUSER,
   BYPASSRLS**, sans CREATEDB/CREATEROLE/REPLICATION ni rôle parent. Le droit CREATE
   sur la base permet les trois extensions trusted de 001.
3. `creche_app` : NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE,
   NOREPLICATION ; pas de propriété, de rôle parent ou de CREATE sur public/base.
4. Les entrypoints API et worker vérifient le catalogue avant de servir/claim en
   production **et staging**. `session_user` et `current_user` doivent être l'app :
   `SET ROLE` depuis un login administrateur ne constitue pas une séparation.
5. `MIGRATION_DATABASE_URL` séparé et obligatoire en production/staging ; migrate
   **et seed** vérifient le rôle avant tout DDL/écriture. `--reset` est refusé dans
   ces deux environnements. Le fallback administrateur demeure uniquement pour
   le mode de développement historique sans URL de migration dédiée.
6. Grants réappliqués dans la transaction de chaque migration et sur run sans
   migration nouvelle. Default privileges attachés au **créateur migrateur**, non
   au bootstrap postgres. Le registre des migrations n'est accessible qu'en lecture
   à l'app. Aucune modification des migrations historiques 001–052.

### Pourquoi BYPASSRLS pour le migrateur ?

Les fonctions SECURITY DEFINER d'authentification, d'invitations et de jobs
cross-tenant (015, 016, 024, 042, 051…) s'exécutent avec leur propriétaire.
Les tables utilisent FORCE RLS : être propriétaire seul ne les exempte **pas** des
politiques. Retirer BYPASSRLS aussi au propriétaire rendrait le bootstrap auth et
les jobs globaux silencieusement inopérants. Une séparation supplémentaire avec
un propriétaire de fonctions NOLOGIN est possible, mais exigerait une refonte des
migrations et des droits de déploiement. Elle n'est pas introduite ici.

## Conséquences et limites

- Le secret migrateur reste très privilégié sur les données de cette base :
  uniquement dans le service de déploiement, jamais dans API/worker.
- Le bootstrap refuse les anciennes propriétés applicatives et appartenances ;
  aucune reprise en place n'est implicitement autorisée.
- Les grants des fonctions existantes restent ceux du modèle actuel (exécution
  applicative et contrôles d'autorisation côté API). Ce travail ne remplace pas
  la revue RLS/fonctions globales de G2.
- Les tests peuvent préparer/inspecter des fixtures comme administrateur, mais
  migrent comme `creche_migrator` et servent/testent la RLS comme `creche_app`.
  En mode production, aucun helper ne rajoute de grants pour faire passer un test.
- Les images applicatives versionnées fournissent `pg` à bootstrap/migrate : plus
  de `npm install` au démarrage des conteneurs. Construire/publier les nouvelles
  images avant d'utiliser les nouveaux Compose.
