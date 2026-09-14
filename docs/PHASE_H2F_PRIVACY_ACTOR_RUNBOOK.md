# H2f — État courant de l'acteur des demandes privacy

2026-09-14 · PR #44 · base synthétique · aucun merge ni déploiement.

## Préflight

H2e confirmé sur `d177badfb5670b79264148c472d6de5a6c9e44c0` :
[CI 34896950734](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34896950734),
**9/9 checks**, database **104153310242** ; notices H2e 36, H2d 44, H2c 156,
H2b 50, H2a 21, F2 51, F4 7 + PG et H1 dev/staging vérifiées.

La restauration du workspace avait remis HEAD/index sur d6f2dfe tout en conservant
les fichiers H2e. Fetch explicite de la branche Arena, comparaison de tous les blobs
avec d177bad : aucune différence. Réalignement de HEAD/index sans écrasement de fichiers.
La nouvelle base locale est jetable et UTF8 ; rôles bootstrapés, migrations/seeds frais.

## Reproduction

La suite initiale `phase40-privacy-actor-revocation.api.test.mjs` a fait
**66/154 avant → 154/154 après**. Les tokens sont obtenus par login HTTP **avant**
les révocations PG et sont réutilisés pour appeler la vraie API sous rôle applicatif.
Les 88 échecs concernent des lectures/écritures qui restaient possibles après
membership désactivée/retirée, suspension utilisateur ou suppression logique de celui-ci.

La matrice finale ajoute deux positifs : un opérateur actif doit encore pouvoir
traiter le dossier d'un demandeur désactivé. Rejeu sur le service H2e publié puis
sur le correctif restauré : **68/156 avant → 156/156 après**. Batterie complète
fraîche : **43/43 suites vertes**, notices H2a–H2f vérifiées.

- Création de demandes avec ou sans enfant, lecture de liste/détail, nouvel export
  médical et clôture de demande sont exercés par HTTP.
- PostgreSQL constate les changements de nombre de demandes/exports et de statut,
  auteur/date de résolution : une réponse refusée ne doit pas cacher une mutation.
- Le contenu médical d'un export autorisé est effectivement lu et le JSON persisté
  est comparé au résultat HTTP ; aucun fournisseur ni worker n'est simulé ou appelé.
- Les 88 échecs sont des scénarios, pas 88 vulnérabilités distinctes.

## Correctif

`PrivacyService.assertCurrentRequestActor` est appelé dans la connexion/transaction
applicative tenant de **chacune des cinq opérations** de demandes de droits,
avant toute lecture ou écriture métier :

| Opération | Route |
|---|---|
| Création (enfant ou personnelle) | `POST /privacy/requests` |
| Liste | `GET /privacy/requests` |
| Détail | `GET /privacy/requests/:id` |
| Nouvelle génération d'export | `POST /privacy/requests/:id/export` |
| Résolution | `POST /privacy/requests/:id/resolve` |

L'utilisateur **agissant** doit être actif, non supprimé (`deleted_at IS NULL`),
avec une membership présente et active dans le tenant courant. Sinon : 403
`PRIVACY_ACTOR_INACTIVE`, sans données ni création/résolution métier. Ce contrôle
s'applique aussi aux opérateurs ; il ne porte pas sur l'état du demandeur du dossier
qu'ils traitent. Les refus du garde de rôle peuvent intervenir avant ce contrôle.

La création d'une demande enfant et le calcul des capacités d'export réutilisent
également `CURRENT_GUARDIAN_LINK_SQL` de H2c. Lien courant, enfant/gardien non supprimés
et cohérence tenant sont conservés. Les champs et capacités de H2a–H2e ne changent pas.
Aucun accès administrateur PG dans le code livré, aucun nouveau grant ou SECURITY DEFINER.

### Historique personnel et faux positifs

Le contrôle de l'acteur ne transforme pas chaque consultation de demande en nouveau
contrôle du dossier enfant. Un demandeur **actif** conserve la liste/le détail de
ses propres demandes après suppression du gardien (notes qu'il a soumises, statut).
Cela ne lui redonne ni nouveau droit d'export enfant ni droit de nouvelle demande
pour cet enfant. Il peut encore soumettre une demande personnelle sans sujet enfant.

Déjà protégés et conservés : propriétaire/tenant des demandes, accès médical selon
capacités, refus de résolution aux parents/comptables, refus d'un nouvel export
après suppression du gardien. Le comptable qui est lui-même gardien garde ses droits
personnels ; il n'accède pas aux demandes des autres familles.

Un opérateur actif peut lire/exporter/résoudre le dossier d'un demandeur dont la
membership est désactivée : son activité de traitement n'est pas bloquée par
l'inactivité du demandeur. Les sources et anciens exports sont conservés.

## Matrice et commandes

- **4 rôles × 6 états × 6 variantes = 144 scénarios** : parent, comptable gardien,
  directeur, super_admin tenant-scopé ; actif, membership inactive, membership absente,
  utilisateur suspendu, utilisateur supprimé, accès restauré ; création enfant,
  création personnelle, liste, détail, export et résolution.
- **12 scénarios complémentaires** : historique personnel après retrait de gardien,
  capacités réduites, pairs/autre tenant/comptable, demande personnelle sans lien,
  opérateur actif sur dossier de demandeur inactif, préservation des sources/snapshots.
- Le super_admin testé est une fixture avec membership dans le tenant ; ce n'est
  pas une qualification de nouveaux accès support globaux sans contexte tenant.

```sh
npm ci
npm run build
# DESTRUCTIF : base *_test dédiée, jamais une base client.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> \
  node scripts/test-production-roles.mjs
```

Pour le ciblé : bootstrap des rôles, puis
`node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`,
puis `node tests/tenant-isolation/phase40-privacy-actor-revocation.api.test.mjs` avec
`DATABASE_URL` administrateur de fixture, `MIGRATION_DATABASE_URL`, `APP_DATABASE_URL`
et `PRODUCTION_ROLE_TESTS=1`. Aucun grant ad hoc des helpers. Pas de reset interne,
identifiants uniques ; ne pas réinitialiser la base pendant une autre suite.

Typecheck/build tous workspaces, lint `--max-warnings=0`, **27/27 unitaires** et audit
production **0 vulnérabilité** verts. Runner existant porté à **43 suites/contrôles**,
gate exigeant 156 scénarios et `H2f privacy actor passed`. Résultat local complet
**43/43**. CI du SHA `5814ed0f9b33fcd5a0e8957c31ce6f91bdf114ac` confirmée :
[34903495839](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34903495839),
**9/9 checks**, database **104174698221**, notices H2f 156, H2e 36, H2d 44, H2c 156,
H2b 50, H2a 21, F2 51, F4 7 + PG et H1 dev/staging vérifiées. PR #44 non mergée.
Docker/Flutter réels restent des gates CI ; leurs guards locaux ne les remplacent pas.

## Limites et rollback

- **Pas de révocation globale des JWT ni de revalidation des changements de rôle.**
  Le rôle/roles embarqué reste régi par les politiques et gardes existants ; retrait
  d'un rôle, changements multi-rôles, autres endpoints et sessions restent en G.
  Ne pas interpréter « acteur courant » comme une qualification complète des rôles.
- Le contrôle vaut pour les cinq opérations de demandes, pas pour registre/DPIA,
  violations, console support, notifications ou toutes les routes du portail.
- Preuve de révocation terminée avant l'appel HTTP suivant ; aucune garantie de
  sérialisation globale des révocations en cours de requête. Le JWT n'est pas annulé
  par ce helper et peut redevenir utilisable ici après réactivation de l'acteur.
- Aucune purge/reclassification de snapshots anciens ou de notes historiques. Les
  demandes d'accès hors portail et les décisions de conservation restent à traiter
  par les processus autorisés, pas par réactivation implicite d'un compte.
- En cas d'incident, suspendre le chemin concerné, conserver les preuves, corriger
  puis rejouer les gates ; ne pas contourner le refus en réactivant les comptes ni
  enlever le contrôle pour faire passer un client.
- Code seulement : migrations 001–061, grants, SDK, lockfiles et workflows inchangés.
  Autres projections santé/médias/privacy, anonymisation, G/H3, stockage/CVE et APK
  release restent ouverts. Paie/facturation inchangées. Aucune aptitude production.
