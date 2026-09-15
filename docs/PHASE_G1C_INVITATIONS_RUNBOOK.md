# G1c / H2 — Invitations, acceptation atomique et exposition du token

2026-09-15 · base G1b `cec88c983a2e0e6018ed83de128d6f0b673be56b` · PR #44.
Installation neuve, données synthétiques uniquement. Aucun merge ni déploiement.

## Préflight et reproduction

Fetch explicite Arena, HEAD local/remote identiques, arbre propre. G1b confirmé :
strict **49/49**, [CI 34934147034](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34934147034)
**9/9**, database **104268359780**, notices G1=26/G1b=24/G2=113/G3=33 et H2/H1/F2/F4.

`phase47-invitations.api.test.mjs` : **10/37 avant → 37/37 après**. HTTP et PostgreSQL
réels sous creche_app NOBYPASSRLS, aucun mock du service de sessions ou d'audit.

Les **27 scénarios rouges**, pas 27 vulnérabilités indépendantes :

- **17 acceptation** : audit sans identifiant de membership ; même invitation
  consommée deux fois ; compte suspendu réactivé ; compte verrouillé modifié avant
  refus ; membership révoqué/absent/déjà rejoint accepté ; rôle/e-mail modifiés depuis
  le token ignorés ; organisation inactive ; session émise dans une autre organisation ;
  UUID signé invalide provoquant 500 ; expiration durant l'attente ignorée ; pannes
  sessions/audit laissant des mutations et rendant le lien inutilisable après restauration.
- **5 création/autorité** : director invite dans B via organization_id du corps ;
  compte suspendu, membership révoqué, rôle abaissé ou pouvoir plateforme retiré
  continuant à créer à partir d'un ancien JWT.
- **5 transport** : token exposé et faux succès sans transport dans test/staging/
  production/environnement absent ; fournisseur development non implémenté échouant
  après les écritures avec erreur 500.

Dix non-régressions : réutilisation séquentielle, compte supprimé, séparation des
familles access/invitation, expiration initiale, directeur B chez lui, plateforme
cross-tenant, educator refusé, super_admin non attribuable et director additionnel.

Une erreur de fixture d'expiration a été corrigée avant la preuve finale :
`expiresIn: undefined` était rejeté par jsonwebtoken. Un vrai token court est signé,
son expiration est lue dans le token, puis dépassée après observation de l'attente.
Ce défaut de fixture n'est pas présenté comme un finding de l'application.

## Acceptation

- JWT d'invitation dédié conservé, durée nominale sept jours, purpose et UUID des
  claims validés avant SQL. L'expiration est revérifiée après les verrous, avant mutation.
- Transaction unique ; contexte tenant issu du token signé, compte verrouillé avant
  membership. Compte **pending**, non supprimé, non suspendu/non verrouillé ; e-mail
  inchangé ; organisation active ; membership actif/non rejoint et rôle conforme au
  token. Les comptes déjà actifs gardent INVITATION_ALREADY_USED.
- Profil, hash de mot de passe, activation, joined_at, session et audit sont committés
  ensemble. Panne d'INSERT session ou audit → rollback de l'ensemble, même lien encore
  utilisable après restauration. Signature de l'access token avant COMMIT.
- Le tenant de la session est **celui de l'invitation**, pas le premier membership du
  compte. Les autres memberships ne sont pas modifiés.
- Audit minimal lié à l'identifiant du membership, rôle courant, acteur et tenant ;
  aucun token ou mot de passe stocké dans ses valeurs. Méthode transactionnelle G3a
  réutilisée, autres appelants best-effort inchangés.

Les helpers historiques SECURITY DEFINER et leurs grants restent présents ;
l'acceptation HTTP utilise maintenant la transaction sous RLS, pas invite_accept.
Aucune migration existante ou nouvelle, aucun changement de grants.

## Création et frontière de tenant

Les décorateurs director/super_admin restent en place. Le service revérifie le
compte actif/non supprimé et le pouvoir plateforme actuel. Un directeur ordinaire
ne peut pas imposer une autre organisation via le DTO ; membership actif et rôle
director actuel (principal **ou additionnel**) requis dans son tenant. Un vrai
administrateur plateforme actif conserve la création cross-tenant.

Ces vérifications précèdent les écritures. Ce lot n'introduit pas une révocation
globale des JWT ni une transaction couvrant toutes les courses de création/réinvitation.

## Transport : limite opérationnelle explicite

**Il n'existe pas de fournisseur d'e-mails d'invitation implémenté dans ce dépôt.**
Le code précédent retournait un token et annonçait « envoyé » avec EMAIL_PROVIDER=none ;
un autre fournisseur jetait une erreur après création du compte/membership.

- `NODE_ENV=development` **et** `EMAIL_PROVIDER=none` : simulation explicite, token
  remis dans invitation_token. Aucune transmission. Ni token ni destinataire dans le log.
- Tout autre environnement (test/staging/production/absent) ou fournisseur :
  **503 INVITATION_DELIVERY_UNAVAILABLE avant les écritures de domaine**, pas de token
  exposé, pas de faux succès d'envoi.
- Le SMTP ANPDP et les alertes sont des chemins distincts, inchangés. Les paramètres
  SMTP de `.env.prod.example` ne mettent pas en service les invitations.
- **Gate de livraison réelle ouvert avant déploiement.** Ne pas activer development
  en production pour contourner ce refus. Implémenter et qualifier un transport réel
  et sa stratégie de reprise avant de promettre une invitation reçue.

Les suites historiques 3/25 utilisent désormais **development** pour leur parcours
positif de remise de token. Ce n'est pas une exception test dans le code de production :
la nouvelle suite démarre réellement l'API dans chaque environnement pour les refus.
Les connexions restent creche_app avec les grants livrés dans toutes ces variantes.

## Validation et commandes

- Deux acceptations HTTP réellement bloquées derrière le même compte (pg_blocking_pids),
  puis un seul succès, un profil cohérent, une session et un audit.
- Jeton expirant pendant l'attente : requête observée bloquée puis refusée sans mutation.
- Snapshots utilisateurs/memberships/sessions/audits conservés pour les refus et pannes.
  Triggers PostgreSQL de panne ciblés aux fixtures, retirés en finally.
- Rejeu des trois services à cec88c9, build et reset/migrate/seed frais → **10/37** ;
  correctif restauré, rebuild, base fraîche → **37/37**. Pas de purge masquant les findings.
- Typecheck/build tous workspaces, lint zéro avertissement ESLint, **27/27 unitaires**,
  audit production **0 vulnérabilité** et budget notices verts. Avertissement Node
  préexistant sur le type de module de la config ESLint, distinct.
- Runner **50 suites**, seuil G1c 37, compteur dans la notice G security passed
  existante (G1/G1b/G1c/G2/G3). Strict complet et CI à confirmer en PR #44.

```sh
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
npm run test:unit
npm audit --omit=dev
# DESTRUCTIF : base *_test synthétique exclusivement.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_TEST> node scripts/test-production-roles.mjs
```

Ciblé après bootstrap et reset/migrate/seed, avec URLs admin/migrateur/application
séparées : `PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase47-invitations.api.test.mjs`.
Ne jamais réinitialiser une base utilisée par une autre batterie.

## Limites et rollback

- Aucun nonce/version d'invitation ajouté : **réémettre le même rôle/e-mail ne révoque
  pas individuellement l'ancien token**. Réinvitation/émission concurrente, workflow
  d'ajout d'un compte déjà actif, site_id/room_ids fournis et anciennes invitations
  restent à examiner. Ne pas déclarer tout le cycle d'invitation clos.
- Revalidation d'autorité à l'entrée de la création, pas de qualification de toutes
  les révocations après ce contrôle ni des autres ordres de verrous/isolation.
  Liste d'invitations et révocation globale JWT/rôles restent hors de ce lot.
- Pas de contrainte SQL empêchant un administrateur de modifier les références,
  ni de fermeture de toutes les capacités des fonctions privilégiées.
- Aucune réparation rétroactive de compte ou audit historique, aucune purge de données
  client. Les anciens tokens déjà exposés ne sont pas individuellement invalidés.
- Rollback installation neuve : suspendre les routes d'invitation/l'API et livrer un
  correctif sûr. Ne pas réactiver l'exposition hors development ou les acceptations
  partielles pour masquer une panne. Conserver journaux et comptes ; pas de rollback
  de schéma requis, aucune migration appliquée à supprimer.
- Appareils, JWT globaux, TOTP/OTP, autres G/H restent ouverts. Paie/numérotation
  inchangées sans décision client. Aucun APK release, fournisseur réel ou déploiement qualifié.
