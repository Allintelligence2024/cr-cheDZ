# G1 — Frontières de connexion, concurrence et IP derrière proxy

2026-09-15 · base H2h `6e328301b1cbbedcd39981ea440329e42e201fe3` · PR #44.
Aucun merge ni déploiement. G2/G3 et le reste de H restent distincts.

## Reproduction avant correction

`phase43-auth-hardening.api.test.mjs` appelle la vraie API sous `creche_app` et
inspecte PostgreSQL. Rejeu final sur les sources AuthService/app.factory/nginx H2h,
puis restauration et reconstruction : **10/26 avant → 26/26 après**, base fraîche
reset/migrate/seed avant chaque passage. Les 16 rouges sont des scénarios, pas
16 vulnérabilités distinctes.

- PIN et OTP valides délivrent une session à un utilisateur suspendu ; mot de passe
  suspendu était déjà refusé. PIN/OTP contournent aussi un verrouillage du compte.
- Les échecs PIN n'alimentent pas le compteur ; après expiration d'un verrou, un
  nouvel échec mot de passe reverrouille immédiatement avec l'ancien compteur.
- Dix mauvais mots de passe simultanés peuvent laisser **failed_attempts=1** et
  aucun verrou. Barrière PG : `LOCK TABLE users IN SHARE MODE`, dix UPDATE en attente
  constatés par `pg_stat_activity`, puis libération. Aucun mock des requêtes AuthService.
  La lecture des statistiques est rafraîchie par `pg_stat_clear_snapshot` dans la boucle.
- Vérifications simultanées du même OTP : plusieurs sessions créées. Les mauvais
  codes épuisés et le rejeu séquentiel étaient déjà refusés : positifs conservés.
- Une fonction SQL `RETURNS users` sans résultat produit une ligne composite nulle :
  le chemin OTP d'un parent supprimé pouvait finir en 500 au lieu de 401.
- Mot de passe faux : statuts 403/423 révèlent suspension/verrouillage, alors qu'un
  inconnu reçoit 401. La correction ne promet pas une latence réseau constante.
- `BCRYPT_ROUNDS=4` est une chaîne d'environnement : avant correction, bcrypt
  l'interprète comme un sel et l'OTP échoue en 500. Conversion numérique vérifiée.
- Deux IP derrière un même proxy consomment le même quota Express. Un proxy HTTP
  réel de test écrase XFF depuis la socket ; clients liés à 127.0.0.2/.3/.4. Le
  deuxième client est bloqué avant correction ; les en-têtes usurpés ne doivent pas
  contourner la limite du premier. Configuration nginx vérifiée structurellement.

## Correctifs

- Mot de passe comparé avant statut/verrouillage ; erreur 401 générique sans secret
  valide. Comparaison bcrypt aussi pour l'inconnu (hash factice non secret, coût 12).
- PIN/OTP vérifient le compte courant avant création de session : non supprimé,
  statut active ou pending (onboarding existant conservé), pas de verrou courant.
  La ligne est relue dans `issueTokenPair`, également utilisée après activation
  d'invitation ; aucun nouveau rôle attribué. Les anciens JWT ne sont pas révoqués.
- Incrément et établissement du verrou en **un UPDATE** sérialisé par ligne ; arrêt
  des incréments pendant le verrou, nouvelle fenêtre après expiration. Réussite PIN/
  OTP remet à zéro comme le mot de passe. PIN utilise le même compteur de compte.
- Consommation OTP conditionnelle `used_at IS NULL AND attempts<5 AND expires_at>NOW()`
  avec `RETURNING` : seul le gagnant continue. Les échecs ne modifient plus un code
  consommé. Un code correct peut être consommé avant refus d'un compte suspendu/
  verrouillé : refus de session ne signifie pas absence de mutation de sécurité.
- Conversion numérique du coût bcrypt dans les chemins de hachage AuthService.
- Express fait confiance à **un seul saut**, jamais `true`. Nginx écrase XFF avec
  `$remote_addr` pour API/auth/sync (et les autres proxys déjà configurés).

## Déploiement : condition impérative

L'API doit rester **privée derrière un seul ingress nginx**, sans accès client direct.
Le compose production ne publie pas son port API. Un accès direct qui permet de
choisir XFF peut usurper l'IP avec `trust proxy=1` : le nombre de sauts n'est pas une
liste d'adresses de confiance. Les ports de développement/staging doivent être
restreints ; une topologie CDN/load balancer supplémentaire nécessite une autre
configuration explicitement qualifiée, pas l'activation de `trust proxy=true`.

Le test utilise un vrai proxy Node contrôlé, **pas un démarrage nginx de production**.
TLS, topologie publique, template nginx complet et rate-limit nginx restent à qualifier
avant déploiement ; aucune autorisation de déploiement n'est donnée par ce lot.
Le compteur IP applicatif reste en mémoire, par instance ; pas de limite distribuée Redis.

## Gates et commandes

```sh
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
npm run test:unit
npm audit --omit=dev
# DESTRUCTIF : base *_test dédiée uniquement.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_TEST> node scripts/test-production-roles.mjs
```

Ciblé après bootstrap et reset/migrate/seed avec URLs admin/migrateur/application
séparées : `PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase43-auth-hardening.api.test.mjs`.
Aucun reset interne et aucun reset pendant une autre batterie.

Ciblé frais **26/26**, typecheck/build, lint zéro avertissement, **27/27 unitaires** et
audit production **0 vulnérabilité** verts. Runner **46 suites/contrôles**, seuil 26 et
notice `G1 auth hardening passed` obligatoire. Les preuves H2 restent agrégées et le
garde de budget des notices est vert. Batterie complète/CI à confirmer dans PR #44.

## Non couvert et rollback

Pas de sérialisation globale entre suspension et toutes les opérations en cours, ni
des connexions correctes concurrentes avec des tentatives erronées ; pas de revalidation
JWT/roles globale, race refresh/invitation, refonte TOTP, identité du gardien ou de
membership. Les statuts pending restent autorisés à la connexion selon le contrat
antérieur, sans nouvelle promesse sur le refresh pending. Les fournisseurs OTP ne
sont pas appelés en test ; aucune qualification Twilio/Meta réelle.

Les requêtes d'OTP concurrentes, la limitation distribuée, la rétention des OTP et
l'ensemble des paramètres d'exploitation restent à revoir. Le coût bcrypt factice
ne garantit pas une indistinguabilité temporelle entre tous les anciens coûts de hash.

En cas d'incident : suspendre le chemin d'authentification affecté, conserver les
traces, corriger/rejouer les gates ; ne pas désactiver le lockout ou accepter un OTP
déjà consommé. Ne pas exposer le port API pour contourner un défaut de proxy.
Migrations 001–061, grants, workflows, SDK et lockfile inchangés.
