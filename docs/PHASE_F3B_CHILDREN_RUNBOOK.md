# F3b — producteurs, bootstrap et projection des enfants

Date : 2026-09-14. PR #44, branche Arena. **Sous-lot F3, pas une clôture F3/F4.**
Aucun merge ni déploiement. Pas de SDK Flutter installé ou committé localement.

## Reproductions avant correction

Commit **2300816**, tests seuls, sur le comportement F3a :

- Vraie API/PostgreSQL : **3/10** contrôles passent. Aucun événement `child` après
  création, PATCH, changement de salle, import ou suppression. Les écritures SQL
  directes ne produisent rien non plus. La lecture statique de 501 enfants est vide.
- Flutter réel, CI **34845848493**, check **103981482067** : **23/31** tests passent,
  **8 échouent**. Les tombstones ne sont pas compris ; l'écran conserve l'enfant
  supprimé ; des identités, types d'événement, dates et versions invalides sont
  appliqués au miroir. Les tests vérifient aussi le rollback de toute la page.
- Le contrôle cross-tenant déjà présent passe avant correction : ce n'est pas
  présenté comme une nouvelle fuite reproduite.

La suite API enrichie atteint **13/13** après correction : réaffectation privilégiée,
répétition du vrai script de migration sur fixtures pré-059 en transaction réversible,
et absence de double bootstrap au rejeu du migrateur incluses. La simulation de
mise à niveau ne modifie aucun fichier ni registre de migrations ; son DDL et ses
fixtures sont annulés intégralement. En gate strict, elle utilise `creche_migrator`.

Le helper de vérification trie le BIGINT qualifié, jamais son alias texte (9/10).
Résultats complets et Flutter après correction : voir les checks du dernier HEAD
et le bilan de la PR #44 ; le check historique Flutter seul ne constitue pas la preuve.

## Producteur transactionnel unique

Migration additive **059_sync_children.sql**, anciennes migrations inchangées,
055 toujours réservée à G2. Un trigger **AFTER INSERT/UPDATE/DELETE**, SECURITY
INVOKER, écrit dans `sync_changelog` au sein de la transaction de `children`.

Cela couvre les chemins existants sans dupliquer les producteurs dans les services :
création HTTP, PATCH (nom/statut/salle…), endpoint move-room, import, soft delete,
et écritures SQL autorisées. Un rollback annule aussi le changelog ; un import
`dry_run` n'écrit rien. Un changement de timestamp seul n'émet pas de snapshot
inutile. Une version modifiée reste un changement de projection.

Les fonctions de projection sont pures : elles ne lisent pas d'autres tenants.
Les écritures du trigger restent sous RLS ; aucun SECURITY DEFINER, rôle, grant
spécial ni autorisation parent ajouté. Une réaffectation d'identité/tenant effectuée
par un opérateur privilégié invalide l'ancien scope par tombstone avant de publier
le nouveau ; elle n'ouvre pas cette possibilité dans l'API utilisateur.

## Forme des événements `child`

Enveloppe F1 inchangée (`sync_seq` string int64). `aggregate_id` = `payload.id`.

### `created`, `updated`, `snapshot`

Liste explicite de **13 champs**, avec valeurs nullables conservées :

`id`, `organization_id`, `site_id`, `room_id`, `first_name_fr`, `first_name_ar`,
`last_name_fr`, `last_name_ar`, `date_of_birth`, `photo_url`, `status`,
`is_walking`, `version`.

`date_of_birth` reste une date civile `YYYY-MM-DD`, sans conversion UTC d'une
Date JavaScript. **Pas de notes, notes médicales, responsables, contacts,
identifiants familiaux ni c.* / to_jsonb(c) dans le changelog.** Ce lot n'ajoute
pas de données de santé au miroir offline ; ne pas le présenter comme un dossier
médical disponible hors ligne.

### `deleted`

Tombstone uniquement : `id`, `organization_id`, `version`, `deleted_at`.
Soft delete : version de la ligne supprimée. Suppression physique : version
précédente + 1 (si les FK autorisent cette suppression). Une ligne `departed`
non supprimée reste un upsert ; le statut n'est pas confondu avec `deleted_at`.

## Bootstrap et reprise

La migration publie un snapshot de chaque enfant préexistant non supprimé et un
tombstone pour les lignes déjà supprimées. Elle verrouille **children et
sync_changelog** pendant sa transaction, pour empêcher l'intercalation d'un
écrivain lors de cette publication initiale. Le registre du migrateur empêche
son rejeu : ce n'est ni un full dump à chaque connexion ni un POST /devices bavard.

Un appareil neuf part du curseur 0 et parcourt le journal (pages de 500). Le test
statique 501 enfants vérifie 500 + 1, puis une reprise vide, sans doublon.
Les projections et le curseur sont appliqués dans la même transaction Drift.

**Ce bootstrap ne constitue pas une solution de rétention/compaction du journal.**
Ne pas purger les événements nécessaires à un appareil neuf sans un futur protocole
snapshot/reprise explicite. Il ne comble pas rétroactivement un événement déjà
sauté par un curseur avancé à cause du défaut d'ordre de commit encore ouvert.

## Client Flutter/Drift

Le projecteur accepte `created/updated/snapshot/deleted` et vérifie identité UUID,
concordance de l'agrégat, scope, version positive, date civile réelle et flag booléen.
Un événement inconnu ou mal formé bloque et annule toute la page, curseur inclus.

Un tombstone retire seulement la ligne du miroir enfant. Il est idempotent, même
si l'enfant est absent. **La file d'opérations n'est ni effacée ni réaffectée** :
travail pending hors ligne et historique restent consultables. Les caches associés
(présences/journal), l'ancien fichier v1 et la rétention des données ne sont pas
purgés par ce lot : ce n'est pas une procédure globale d'effacement RGPD/25-11.
Le test du vrai écran vérifie que l'enfant disparaît après réception du tombstone.

La consommation suppose le journal ordonné par le curseur ; ce lot n'introduit pas
un magasin durable de versions de tombstones contre des événements arbitrairement
réordonnés. L'ordre de publication concurrent reste un travail F3 distinct.

## Gate, migration et rollback

`phase32-sync-children.api.test.mjs` rejoint le runner : **35 suites/contrôles**.
Le premier essai de batterie a reproduit un problème de teardown : les suppressions
physiques des enfants créent des tombstones après l'ancien nettoyage du changelog,
puis la suppression des organisations échoue sur FK (RLS, phase4/5/6 notamment).
Les fixtures purgent maintenant leur changelog synthétique **après** les enfants.
Aucun trigger désactivé, aucun grant/RLS assoupli ; la batterie finale est relancée
sur reset/migrate/seed, pas sur les résidus du premier essai interrompu.
Le gate strict effectue bootstrap des rôles, reset/migrate/seed, suites API, et en CI
les gates F1 Dart, F2 Flutter et E2 Docker. Aucun workflow/lockfile modifié.

Installation neuve, aucune donnée de production manipulée. Pour un futur déploiement
autorisé : fenêtre de maintenance, arrêter les écrivains, sauvegarde vérifiée si des
données ont été ajoutées entre-temps, appliquer 059 via le migrateur puis déployer
le client comprenant les tombstones. L'ancien client ne les comprend pas : **pas de
mise à niveau serveur seule avec de vieux clients actifs**. Les verrous peuvent
attendre des transactions longues ; en cas d'échec, le migrateur annule tout.

Rollback : arrêter la sync ; conserver le journal et tous les fichiers locaux.
Ne pas modifier/supprimer 059 ni retirer aveuglément les snapshots : une migration
suivante est nécessaire si le producteur doit évoluer. Revenir au binaire précédent
n'est pas une sync de production sûre et ne doit pas réactiver les anciens bugs.

## Reste ouvert

- F3 : ordre de commit/pagination concurrente (A lente/B rapide), intégrité composite
  SQL à reproduire, projections journal/media et autres types.
- F4 : vrai client Dart contre vraie API, deux appareils, reprise et conflit.
- Release Android : pas d'APK ni de test de permissions release revendiqué ici.

**Ne pas déployer cette synchronisation intermédiaire comme complète.**
