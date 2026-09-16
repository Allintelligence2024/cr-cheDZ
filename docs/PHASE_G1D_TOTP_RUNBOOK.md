# G1d — Gestion du facteur TOTP, état du compte et concurrence

2026-09-15 · baseline `00a483150a7fcf238dab4ab9e421b36ec0e10c75` · PR #44.
Installation neuve, données synthétiques uniquement. Aucun merge ni déploiement.

## Preuves avant/après

`phase48-totp-management.api.test.mjs` : **7/44 avant → 44/44 après**.
La suite finale a été rejouée avec les trois fichiers auth.service/auth.controller/
shared/errors de la baseline, puis avec leur correctif restauré. Build API et
**reset → migrations → seeds avant chacune des deux batteries**. HTTP réel,
PostgreSQL 18, application `creche_app` NOBYPASSRLS et grants de production inchangés.
Deux cas sont des vecteurs cryptographiques publics, les 42 autres utilisent l'API/PG.

Les **37 scénarios rouges ne sont pas 37 vulnérabilités indépendantes** :

| Groupe | Scénarios rouges | Observation avant correction |
|---|---:|---|
| Configuration active/pending, audit minimal | 2 | Secret créé sans événement d'audit |
| Réessai de configuration | 1 | Réécriture inutile/version incrémentée |
| Secret d'un facteur déjà activé | 1 | Retour 200 contenant secret et URI otpauth |
| Compte suspendu/supprimé/verrouillé, trois routes | 9 | 200 et modification malgré l'état courant |
| Même matrice avec changement committé pendant une attente PG | 9 | État périmé utilisé après attente |
| Échecs concurrents | 1 | Aucune incrémentation ni sérialisation du compteur |
| Annulation puis confirmation concurrentes | 1 | Facteur réactivé avec secret NULL |
| Expiration du verrou pendant attente | 1 | Échec non comptabilisé dans une nouvelle fenêtre |
| Configuration et confirmation concurrentes | 2 | Secrets retournés divergents ; audits dupliqués |
| Échecs verify/disable/login par mot de passe | 3 | Pas de verrouillage au seuil configuré |
| Panne d'audit des trois opérations | 3 | Succès malgré l'absence d'audit, mutation non annulée |
| Récupération après verrou expiré, preuve valide | 1 | Anciens compteur/verrou conservés |
| Limitation HTTP des trois routes | 3 | Sixième appel accepté au lieu de 429 |

Sept non-régressions : deux séries RFC, confirmation/désactivation pour active et
pending, connexion par mot de passe avec TOTP valide, absence de facteur et refus
sans JWT. RFC 4226 SHA1 et RFC 6238 SHA1 tronqué aux **six chiffres** configurés
passaient déjà ; aucun changement de l'algorithme, de la période 30 s ou fenêtre ±1.

Revue du premier correctif : **43/44**, verrou expirant pendant l'attente encore
incorrect. `NOW()` était figé au début de transaction. Reproduction avant remplacement
par `statement_timestamp()` dans le compteur : **44/44** ensuite. Le rejeu intégral
final sur la baseline donne bien **7/44**, pas le premier résultat intermédiaire.

## Contrat corrigé

- Les trois routes restent **self-service**, identifiant issu du JWT, sans paramètre
  permettant de choisir un autre compte. Elles n'exigent pas un rôle de tenant : le
  facteur appartient au compte. États active/pending conservés pour l'onboarding.
- Transaction et `users FOR UPDATE`, puis relecture du secret et contrôle actuel du
  compte : supprimé/absent **401 INVALID_CREDENTIALS**, suspendu **403
  ACCOUNT_SUSPENDED**, verrou actif **423 ACCOUNT_LOCKED**.
- `POST /auth/2fa/enable` est une préparation, pas une activation immédiate.
  Secret aléatoire seulement si absent ; même secret pour deux préparations
  concurrentes et pour le réessai pending. Facteur déjà activé : **409
  TOTP_ALREADY_ENABLED**, aucune mutation, aucun secret/URI dans la réponse.
- Confirmation et désactivation demandent une preuve TOTP vérifiée après le verrou.
  Une annulation de préparation reste possible avec le code valide ; une confirmation
  en attente derrière cette annulation échoue **401 TOTP_INVALID** sans réactivation.
  Deux confirmations du même état ne dupliquent pas l'audit.
- Mutation et audit minimal utilisent **le même client/commit**. Panne d'audit :
  **500 + rollback**. Audit compte (`organization_id` NULL comme précédemment),
  acteur et ressource identifiés, seulement `{totp_setup:true}` ou
  `{totp_enabled:boolean}` ; ni secret ni URI, ni e-mail ajouté à cet événement.
- Échecs verify/disable et TOTP de connexion par mot de passe utilisent le compteur
  existant, partagé avec mot de passe/PIN. Seuil et durée existants
  `MAX_LOGIN_ATTEMPTS`/`ACCOUNT_LOCK_MINUTES` (tests **5/15 min**). Les échecs de
  gestion sont **committés avant le 401**, pas annulés avec l'erreur. Sept demandes
  concurrentes donnent cinq 401, deux 423, compteur 5 ; un code valide ne contourne
  pas un verrou actif. Aucun secret configuré : refus sans changement du compteur.
- Après expiration, première preuve invalide = nouvelle fenêtre à 1 ; preuve valide
  = compteur/verrou effacés. Le timestamp est celui de l'UPDATE, après l'attente.
- Limite supplémentaire **5 appels/minute/IP/route** via le mécanisme HTTP existant.
  Test avec le vrai garde activé, sixième appel **429 RATE_LIMITED**. C'est une limite
  en mémoire par instance, pas un quota distribué. Le compteur compte est dans PG.

Les chevauchements sont observés par `pg_blocking_pids`/`pg_stat_activity`, pas
supposés à partir d'un sleep. L'ordre annulation→confirmation est établi avant de
libérer le verrou. L'expiration est observée avec l'horloge PG. Audit en panne via
un trigger temporaire de test réel, retiré en finally ; aucun mock de l'audit/TOTP.

## Rejouer

Cluster de test isolé uniquement, base suffixée `_test`, rôles stricts configurés :

```sh
npm ci
npm run build --workspace @creche/api
npm run build --workspace @creche/worker
node scripts/bootstrap-roles.mjs
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase48-totp-management.api.test.mjs
# Batterie intégrale : son orchestrateur effectue le reset préalable.
ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
```

Ne jamais lancer un reset ou un rejeu baseline pendant la batterie stricte.
Pour reproduire le rouge : sauvegarder les trois fichiers corrigés, y substituer
les blobs du SHA baseline indiqué, rebuild/reset/migrate/seed et exécuter **la suite
finale**, puis restaurer les fichiers en finally, rebuild et même remise à neuf.
Les migrations 001–052, grants, dépendances et workflows restent inchangés.

## Gates et livraison

Runner porté à **51 suites/contrôles** ; seuil obligatoire G1d **44**, inclus dans
l'agrégat G existant sans ajouter de notice. Résultat strict et CI exact-SHA à
consigner en PR #44 après exécution ; ne pas attribuer la CI G1c à ce lot.
La qualification Docker/Flutter H1/F2/F4 reste celle des gates CI réels, pas celle
du PostgreSQL local. Pas d'APK release ni qualification production par ces tests.

## Limites maintenues ouvertes

> **Mise à jour post-lots (2026-09)** : ce qui suit décrit le périmètre DU lot
> G1d à sa livraison. Depuis, **G4** a fermé le point JWT/rôles/membership
> (révocabilité globale des principaux, [runbook G4](PHASE_G4_PRINCIPAL_REVOCATION_RUNBOOK.md))
> et **G5** a fermé chiffrement au repos du secret, anti-rejeu persistant des
> codes et exigence MFA sur tous les canaux PIN/OTP parent
> ([runbook G5](PHASE_G5_MFA_RUNBOOK.md)). Restent effectivement ouverts :
> récupération/step-up (décision client pour les codes de secours), invalidation
> proactive de secrets copiés avant G5 (ré-enrôlement recommandé), et la
> qualification d'applications authenticator tierces.

**G1d ne ferme ni toute l'authentification ni toute la MFA.**

- Secret toujours en clair dans la colonne PG : chiffrement au repos avec gestion
  des clés, rotation/récupération et anciens secrets potentiellement divulgués non
  traités. Ce lot empêche une nouvelle divulgation via la préparation d'un facteur
  activé ; il n'invalide pas un secret qui aurait déjà été copié.
- Pas de preuve récente du premier facteur imposée à la préparation, ni de nouveau
  protocole de step-up/récupération. Secret pending encore retourné au porteur du JWT.
- Pas de compteur TOTP anti-rejeu persistant : un code valable dans la fenêtre peut
  être réutilisé. Les deux confirmations idempotentes ne signifient pas « code à
  usage unique ». Pas de qualification d'application authenticator ou dérive réelle.
- Exigence MFA de tous les canaux PIN/OTP parent à traiter séparément ; ils ne sont
  pas convertis ici en challenge MFA à deux étapes. Pas de promesse MFA universelle.
- JWT/rôles/membership/sessions non globalement revalidés ; expiration du JWT pendant
  attente non revérifiée par ces méthodes. Un logout ne révoque pas ici les JWT émis.
- Connexion mot de passe : échecs TOTP désormais comptés, mais l'ensemble lookup,
  vérification et création de session n'est pas rendu transactionnel par G1d.
  Autres courses login/password/logout/rotation et authentification multicanal ouvertes.
- Quotas distribués, topologie proxy/ingress en production, anonymisation, métriques,
  OpenAPI, stockage et autres projections G/H restent à qualifier. Prorata paie et
  numérotation de facture restent soumis à décision client, inchangés.

## Rollback (premier déploiement, non exécuté)

Aucune migration de données. Retirer d'abord le trafic des routes de gestion 2FA si
un retour au code antérieur est nécessaire ; ce retour réintroduit la divulgation
du facteur activé et les courses reproduites, ce n'est pas un rollback de sécurité.
Restaurer l'image/version précédente selon le runbook de premier déploiement et
vérifier santé et sessions. Ne pas réexposer enable sur un facteur activé, ne pas
vider massivement totp_secret/totp_enabled ni les compteurs. Les audits minimaux
existants sont conservés ; aucune ancienne donnée client n'a été modifiée ici.
