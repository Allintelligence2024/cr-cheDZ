# G1b — Rotation atomique des refresh tokens

2026-09-15 · base G3a `74b24c29008c7832fe7a6b778efe83b83fc09683` · PR #44.
Installation neuve et PostgreSQL synthétique uniquement. Aucun merge ni déploiement.

## Préflight

Fetch explicite de la branche Arena : HEAD local/remote identiques, arbre propre.
G3a qualifié : strict local **48/48**, [CI 34931752882](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34931752882)
**9/9**, database **104261231618**, G1=26/G2=113/G3=33 et H2/H1/F2/F4.
Aucun changement de dépendance, de migration, de grant ou de workflow dans G1b.

## Reproduction avant correction

`phase46-refresh-rotation.api.test.mjs` : **16/24 avant → 24/24 après**.
API réelle, rôle creche_app NOBYPASSRLS et grants livrés. Les huit scénarios rouges :

| Cas | Avant | Après |
|---|---|---|
| Même refresh, deux requêtes simultanées | Deux HTTP200 et deux remplacements | Un HTTP200, un SESSION_REUSE_DETECTED ; un seul remplacement, ensuite révoqué par la détection de réutilisation |
| Réutilisation d'un ancien token devant le renouvellement d'une autre session | La rotation concurrente laisse un nouveau refresh actif après la révocation générale | Les refresh d'un même compte sont sérialisés ; aucun descendant actif ne survit à ce scénario |
| Compte supprimé | HTTP401, mais ancien token marqué rotated | HTTP401 sans rotation partielle |
| Expiration committée pendant l'attente | Renouvellement HTTP200 à partir d'un état périmé | SESSION_EXPIRED, aucune nouvelle session |
| Révocation de session pendant l'attente | HTTP200 malgré device_revoked | DEVICE_REVOKED, aucune nouvelle session |
| Révocation de l'appareil pendant l'attente | HTTP200 à partir de l'ancien état | DEVICE_REVOKED, aucune nouvelle session |
| INSERT du remplacement en panne | HTTP500 et ancien refresh consommé | HTTP500, révocation annulée avec la transaction |
| Réessai après restauration du stockage | Ancien token inutilisable | Ancien token renouvelable |

Les seize autres cas étaient déjà verts : rotation ordinaire, deux sessions
indépendantes, réutilisation séquentielle et isolation d'un autre compte, refus
initiaux (expiration/révocation/suspension/pending), DTO, rôle courant, comptes
plateforme/sans organisation, bootstrap appareil et audit best-effort.

Hypothèse de fixture éliminée avant la baseline finale : `sessions.device_id` n'a
pas la FK supposée ; un UUID inconnu ne provoque donc pas une panne d'INSERT. Le
contrôle d'atomicité utilise un vrai trigger PostgreSQL injectant une panne de
stockage. **Existence/propriété et réassociation des appareils restent à revoir** :
aucun correctif ni qualification de cette frontière n'est attribué à G1b.

## Correctif et politique conservée

La route publique /auth/refresh, son rate-limit, ses DTO et les durées restent
inchangés (access 15 minutes, refresh sept jours, opaque haché SHA-256 en base).

1. Ouvrir une transaction et retrouver le compte à partir du hash du refresh.
2. Verrouiller **le compte avant la session**, dans cet ordre pour tous les refresh.
   Le verrou par compte couvre aussi une réutilisation sur une autre session,
   ce qu'un simple verrou sur le token à renouveler ne suffirait pas à assurer.
3. Relire la session et l'état de l'appareil via le helper existant **après** les
   verrous ; vérifier expiration, révocation et statut du compte.
4. Révoquer l'ancien token, lire les memberships/rôles, insérer le remplacement et
   signer le JWT sur le chemin transactionnel ; retourner les tokens après COMMIT.
   Une erreur avant COMMIT provoque ROLLBACK, sans consommer l'ancien refresh.
5. En cas de réutilisation, révoquer les refresh sessions du compte et **committer
   cette révocation avant de retourner l'erreur**. L'audit historique best-effort
   reste après ce commit et ne peut pas annuler l'effet de sécurité.

SessionsService accepte un client transactionnel explicite pour création/révocation
générale ; ses autres appelants conservent le comportement pool par défaut.
Memberships et rôles sont lus sur le même client pendant la rotation. Les fonctions
SQL de bootstrap existantes et leurs grants ne sont pas modifiés.

**Politique préexistante maintenue :** une réutilisation révoque tous les refresh
sessions du compte, pas seulement le token présenté. Deux appels concurrents avec
le même token peuvent donc produire une réponse HTTP200 dont le refresh est déjà
révoqué par le second appel. Les clients doivent sérialiser leurs renouvellements,
puis se reconnecter après SESSION_REUSE_DETECTED. Deux tokens distincts valides
peuvent en revanche être renouvelés sans faux positif de réutilisation.

**Cela ne révoque pas les JWT d'accès déjà émis.** Leur validité cryptographique
reste de 15 minutes et leurs contrôles métier varient selon les routes ; la
revérification globale JWT/session/rôle reste ouverte. Ne pas annoncer une
invalidation immédiate de tous les accès ou une protection complète des appareils.

## Qualification

- Barrières PostgreSQL sur les sessions ; observation des requêtes HTTP réellement
  bloquées via pg_blocking_pids, y compris la chaîne d'attente du verrou compte.
  Pour la course entre réutilisation et autre refresh, le premier appel est
  effectivement observé en attente avant le lancement du second.
- Totaux de sessions et révocations relus par l'administrateur ; refus/pannes sans
  tokens dans la réponse et sans mutation partielle. Pas de mock du service de
  sessions, pas de remplacement du réseau HTTP par des appels de méthode.
- Triggers de panne ciblés sur les fixtures et supprimés en finally : INSERT de
  session, puis audit de réutilisation. Le second cas confirme le maintien de
  l'effet de sécurité même si l'audit best-effort ne peut être stocké.
- Rejeu final des deux services à la version 74b24c2, build et base fraîche :
  **16/24** ; restauration du correctif, rebuild, nouvelle base fraîche : **24/24**.
- Typecheck/build de tous les workspaces, lint zéro avertissement ESLint,
  **27/27 unitaires**, audit production **0 vulnérabilité** et budget notices verts.
  Avertissement Node préexistant de type de module de la config ESLint distinct.
- Runner **49 suites**, seuil G1b 24 ; compteur agrégé dans G security passed avec
  G1/G2/G3, pas de notice supplémentaire. Qualification finale : strict local **49/49**,
  CI **34934147034**, **9/9** sur `cec88c983a2e0e6018ed83de128d6f0b673be56b`, database
  **104268359780**, G1=26/G1b=24/G2=113/G3=33 et H2/H1/F2/F4 relus en PR #44.

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

Ciblé après bootstrap et reset/migrate/seed frais :
`PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase46-refresh-rotation.api.test.mjs`,
avec URLs admin/migrateur/application séparées. Jamais de reset pendant une autre batterie.

## Limites, données et rollback

- Le verrou sérialise **les refresh** d'un compte. Pas de qualification de toutes
  les courses avec login, changement de mot de passe, logout, attribution de rôles,
  suppression ou révocation d'appareil après la dernière vérification. Isolation
  READ COMMITTED testée ; autres niveaux/ordres de verrous non qualifiés.
- La sélection de membership existante reste inchangée : pas de garantie que le
  tenant d'origine soit conservé après un changement de memberships. Compte actif
  sans organisation et plateforme restent acceptés selon le contrat préexistant.
- Pas de validation nouvelle de propriété/existence du device_id fourni ni de
  fermeture de la réassociation d'appareil. JWT globaux, invitations, TOTP et
  demandes OTP concurrentes restent ouverts. Ne pas clore G auth globalement.
- Pas de purge de sessions anciennes ni de réparation rétroactive de rotations
  antérieures. Les données de production n'ont pas été touchées.
- Un verrou compte peut attendre ; aucune promesse d'absence de deadlock sur tous
  les workflows. Une perte de réponse après COMMIT reste un résultat réseau ambigu,
  pas une garantie exactly-once de bout en bout.
- Rollback installation neuve : suspendre le renouvellement (ou l'API) pendant
  l'incident et livrer une correction sûre ; ne pas réactiver volontairement les
  courses pour contourner une panne. Conserver sessions/journaux. Aucun rollback
  de schéma requis et aucune migration appliquée à supprimer.
- Aucun changement de paie/numérotation sans décision client ; aucun déploiement,
  APK Android release ou fournisseur réel qualifié par ce lot.
