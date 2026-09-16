# Runbook G4 — révocabilité globale des principaux (époque de token)

Migration 062 (`062_principal_token_epoch.sql`) · lot livré en PR #45 (suite)
après les lots H2k/H2l · **CI consignée : 9/9 sur `6f96367`** (run ci
`35072902044`, job `database` `104718362609`, notice G relue par REST
`G4=17`) — le rouge antérieur du job datait du gate H2k (quatre corrections
du gate lui-même, voir §Suivi du plan), jamais de G4. Audit 2026-09, ligne G4 : « la révocation de rôles,
d'appartenance ou d'état de compte ne devient effective qu'à l'expiration du
JWT d'accès (15 min) ou par re-contrôles épars d'endpoints ».

## Contrat livré

Chaque utilisateur porte un compteur `users.token_epoch` (bigint, défaut 0).
Les access tokens portent le claim `epoch` lu **au moment de la signature**
(login, refresh/rotation, acceptation d'invitation, impersonation support).
Les deux gardes d'entrée (`JwtAuthGuard` global, `MetricsAccessGuard` pour la
voie admin de `/api/v1/metrics`) relisent l'époque courante **à chaque requête**
(via `auth_principal_epoch(uuid)`, SECURITY DEFINER, même autorité que
`auth_get_memberships` de la 015) et refusent 401 sur :

- époque dépassée ( révocation ) ;
- époque non lisible : compte supprimé, ou requête en échec ( **fail-closed** ).

Un token **sans claim epoch** vaut époque 0 (compatibilité de déploiement
progressif : les instances anciennes coexistent tant que le principal n'a
jamais été révoqué).

## Points d'incrément (déclencheurs DB, non pas des call-sites applicatifs)

Le choix du déclencheur est délibéré : **les opérations d'exploitation qui
écrivent en SQL direct** (décrêts, corrections, imports) sont soumises aux
mêmes règles que les endpoints, sans dépendre du souvenir de l'appelant.

| Écriture | Effet |
|---|---|
| `UPDATE users` touchant réellement `status`, `is_super_admin`, `password_hash` ou `deleted_at` (WHEN … IS DISTINCT FROM) | +1 époque du concerné |
| INSERT/DELETE sur `memberships`, UPDATE modifiant réellement `user_id`, `role_id`, `site_id`, `room_ids` ou `is_active` | +1 du/des concerné(s) |
| INSERT/DELETE sur `role_assignments`, UPDATE modifiant réellement `user_id` ou `role_id` | +1 du concerné |

Un UPDATE sans changement de valeur **ne bump pas** (pas de déconnexion
accidentelle sur no-op idempotent) ; la RESTAURATION d'un état (reactivation,
re-grant) bump aussi — elle force la reconnexion, symétriquement.

La colonne `token_epoch` n'est en liste de personne d'autre : l'incrémentation
ne peut pas être court-circuitée par une écriture applicative.

## Limites ASSUMÉES et documentées (ne pas les vendre comme closes)

1. **Fenêtre garde→commit** : l'époque est relue au début de la requête ; une
   révocation survenue PENDANT l'exécution d'une requête longue n'annule pas
   ses écritures déjà parties. Il n'y a pas de lock du principal par mutation.
2. **TOTP seul ne déconnecte pas** : enable/verify/disable de facteur ne bump
   pas l'époque (le setup MFA en cours de session resterait inutilisable).
   La limite G1d « re-authentification après activation » demeure ; la
   suppression de sessions est déjà couverte par la révocation refresh.
3. **Périmètre = users/memberships/role_assignments**. Les changements de
   STATUT D'ORGANISATION (suspend/lock) ne bumpent pas — ils restent traités
   par les re-contrôles d'endpoints existants. Si l'audit exige la fédération,
   ajouter un trigger `organizations` → fan-out (coûteux) est le chemin prévu.
4. **Ordre de déploiement** : migration 062 AVANT redémarrage API/worker.
   Dans la topologie livrée, c'est structurel : `docker-compose.prod.yml`
   (et staging) exécute le service `migrate` dont `api` dépend via
   `depends_on`. Un déploiement manuel hors compose doit respecter le même
   ordre — sans colonne, le garde est fail-closed (401 partout) : refus
   d'ouvrir une faille, pas un bug, mais arrêt de service quand même.
5. Les tokens de refresh ne portent pas d'époque : leur révocation passe par
   `sessions` (déjà atomique, G1b) ; `refresh` relit le compte et réémet une
   époque COURANTE — vérifié par la suite phase53.

## Preuves

Suite dédiée `tests/tenant-isolation/phase53-principal-revocation.api.test.mjs`
(**17 checks**, HTTP réel + PostgreSQL réel) : claim epoch signé et aligné,
révocation de membership ⇒ 401 sur TOUTES les routes (vs 200 avant fix),
rétablissement ⇒ reconnexion forcée, change-password ⇒ ancien access mort +
refresh révoqué, grant/retrait de rôle via l'API du directeur ⇒ cible
déconnectée et acteur épargné, suspension/suppression douce ⇒ 401 global,
déchéance de super-adminité ⇒ 401 au garde de `/metrics` (plus de 403 différé),
refresh normal conserve l'époque, token manuel sans claim = époque 0 compatible
puis frappé, `purpose=device` inchangé, rejeu idempotent de la migration.

Captures : **RED 4/17 → GREEN 17/17 (G4)** sur la baseline `47bac1a`. Suites préexistantes recalées sur le contrat élargi (le
refus devint ANTÉRIEUR et GLOBAL — le refus SANS mutation reste vérifié) :
phase15 (+1 assert rétro), phase37, phase40, phase45, phase47, phase48,
phase50, phase51. Seuil gate : 56 suites.

## Rétrograde (rollback)

```sql
DROP TRIGGER IF EXISTS trg_g4_users_epoch ON users;
DROP TRIGGER IF EXISTS trg_g4_memberships_epoch ON memberships;
DROP TRIGGER IF EXISTS trg_g4_role_assignments_epoch ON role_assignments;
DROP FUNCTION IF EXISTS trg_g4_users_epoch_fn();
DROP FUNCTION IF EXISTS trg_g4_memberships_epoch_fn();
DROP FUNCTION IF EXISTS trg_g4_role_assignments_epoch_fn();
DROP FUNCTION IF EXISTS g4_bump_principal_epoch(uuid);
DROP FUNCTION IF EXISTS auth_principal_epoch(uuid);
ALTER TABLE users DROP COLUMN IF EXISTS token_epoch;
```
Les tokens émis avec le claim `epoch` restent utilisables par le garde
antérieur (le champ est ignoré) ; aucune donnée effacée, aucun verrouillage.
Le code applicatif (garde + signature) se rétrograde par simple redéploiement
de l'image précédente — le claim en trop est inerte pour lui.
