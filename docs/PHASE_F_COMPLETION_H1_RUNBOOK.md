# Clôture F et démarrage H1 — 2026-09-14

Branche `arena/01a09e7f-cr-chedz`, PR #44. Aucun merge, aucune mise en production.
La clôture fonctionnelle F est distincte de la qualification Android release et
n'autorise pas à sauter G, H2, H3 ou la matrice de confidentialité.

## Périmètre exact

L'inventaire des producteurs actuels contient quatre `aggregate_type` :

| Type | Producteur | Miroir mobile |
|---|---|---|
| `child` | trigger SQL 059 (création, mise à jour, snapshot, suppression) | enfants, version, tombstone |
| `attendance` | AttendanceService | session, DATE Alger, statut, version |
| `daily_log` | JournalService, HTTP/group actions et huit commandes sync | identité, enfant, type, DATE Alger, instant de l'événement |
| `media` | MediaService, HTTP et `add_photo` | identité, enfant facultatif, type photo/document, instant de publication |

**Journal et médias : projections de métadonnées, pas duplication des dossiers.**
Le delta journal publié contient déjà quatre champs ; le client en conserve une
liste explicite. Ni notes privées, ni texte médical, ni clé S3, URL signée ou
consentement supposé ne sont ajoutés au miroir. Les détails et téléchargements
restent soumis aux endpoints existants et à leur autorisation en ligne. Il ne
s'agit pas d'un cache hors ligne des pièces jointes ni de l'ensemble du journal.
Le type HTTP `health_observation` est également pris en charge ; aucun producteur
`correction`/`attendance_event` séparé n'existe dans le code actuel, contrairement
à l'ancien commentaire indicatif de migration 006.

Un type inconnu, une identité incohérente ou une projection malformée continue
à faire échouer **toute la page et son curseur**. Aucune stratégie « ignorer puis
avancer ». Les opérations en attente/conflit et l'historique restent conservés.

## Reproductions et preuves

- `phase34-sync-completion.api.test.mjs` : **1/10 avant → 10/10 après** sur base
  locale fraîche. Sept violations de références acceptées auparavant, plus deux
  dates journal sérialisées en timestamp au lieu de DATE. Les transactions des
  sondes SQL sont toujours annulées, même lorsque le défaut accepte l'écriture.
- **F4 rouge réel : 4/7**, commit `33ab34e`, run `34854690262`, job `104011064272` :
  journal → `contractError`, média → `Unsupported projection: media`, reprise bloquée.
  La preuve précède les correctifs Dart ; les cinq tests enfants/présences antérieurs
  restent acquis (la reprise étendue est désormais un des trois rouges).
  **Après correction : 7/7 + PG sur `d9d2720`**, run `34855762767`,
  job `104014779214`. Le gate global de ce run reste rouge uniquement pour H1.
- Batterie finale locale **37/37**, rôles de production ; typecheck/lint/build,
  **27 unitaires** et audit production **0 vulnérabilité**. Les teardowns phase5/6
  ont été corrigés après un premier **35/37** : suppression des fixtures dans
  l'ordre des FK, sans désactiver les contraintes.
- F4 est étendu à sept tests réels Dio/SyncEngine/Drift sur fichiers : les cinq
  acquis F3c/F4, les huit commandes journal + observation HTTP, photos HTTP/sync
  et document sans enfant, rejeu,
  reprise disque et miroir vide de l'autre tenant. PostgreSQL inspecte
  indépendamment opérations, événements, médias et les quatre types publiés.
- Les tests Flutter ciblés ajoutent page mixte, tous les types journal publiés,
  document sans enfant, métadonnées minimales, erreurs atomiques et migration v2.

## Migration 061 — intégrité, pas autorisation

Contraintes **validées immédiatement**, sans `NOT VALID`, sans cascade destructive :

- device `(organization_id, registered_by)` → membership `(organization_id, user_id)` ;
- opération `(organization_id, device_id, user_id)` → device et son propriétaire ;
- curseur `(organization_id, device_id)` → device du même tenant ;
- origine non nulle du changelog → device du même tenant.

Un device pré-enregistré sans propriétaire peut exister, mais ne peut posséder une
opération, dont les trois colonnes sont NOT NULL. Une origine nulle reste légale
pour HTTP/serveur. Le changement de propriétaire ne peut réattribuer un historique.
Les contrôles API d'activité, révocation et rôle restent nécessaires : une FK ne
remplace pas l'autorisation. La migration échoue transactionnellement si des
références anciennes sont incohérentes : aucun déplacement/effacement automatique.

### Préparation / rollback

Le client a confirmé une **installation neuve**, sans données de production.
Avant un premier lancement : arrêt des écrivains, migrations via `creche_migrator`,
seed, schema-check avec `creche_app`, puis tests fonctionnels et autorisation.
001–060 restent immuables ; 055 reste réservée à G2.

Pour une base existante de test ou de reprise, vérifier les références avant 061 :

```sql
SELECT d.id FROM devices d LEFT JOIN memberships m
  ON (m.organization_id,m.user_id)=(d.organization_id,d.registered_by)
  WHERE d.registered_by IS NOT NULL AND m.id IS NULL;
SELECT s.id FROM sync_operations s LEFT JOIN devices d
  ON (d.organization_id,d.id,d.registered_by)=(s.organization_id,s.device_id,s.user_id)
  WHERE d.id IS NULL;
SELECT s.device_id FROM sync_cursors s LEFT JOIN devices d
  ON (d.organization_id,d.id)=(s.organization_id,s.device_id) WHERE d.id IS NULL;
SELECT s.sync_seq FROM sync_changelog s LEFT JOIN devices d
  ON (d.organization_id,d.id)=(s.organization_id,s.origin_device_id)
  WHERE s.origin_device_id IS NOT NULL AND d.id IS NULL;
```

Si un résultat n'est pas vide : **stop**, diagnostic et décision explicite ; ne pas
supprimer les références pour faire passer le déploiement. Une sauvegarde vérifiée
est requise avant intervention sur des données existantes.

Rollback premier déploiement : arrêter API/worker/mobile, conserver la base et le
journal ; revenir à l'image serveur précédente compatible avec les contraintes,
mais garder le mobile arrêté s'il ne sait pas lire journal/médias. Ne pas retirer
061 pour permettre des écritures incohérentes. Toute modification SQL ultérieure
passe par une migration additive revue. Ne jamais retirer le trigger 060 seul.

Drift v3 ajoute uniquement `local_media`, dans le **même fichier scopé v2** : pas de
nouveau nom qui abandonnerait la file. L'upgrade préserve identité, curseur et
séquence ; la base historique non scopée reste en quarantaine. Pas de downgrade
mobile sur une base v3, ni purge silencieuse de fichiers ou de curseurs.

Les anciennes publications journal avec DATE timestamp ne sont pas réécrites :
comme les versions/date présence historiques et les curseurs perdus avant 060,
leur récupération nécessite une procédure explicite si elles existent. Le gate
qualifie l'installation neuve convenue, pas une réparation d'historiques arbitraires.

## H1 — staging synthétique réel

Le finding « montage tests absent » est **déjà corrigé par `c5cfab4`** dans les
compose staging et production. Le contrat structurel existant le vérifie. Il
serait faux de présenter un nouveau montage ou déplacement de fichier comme sa
réparation. `schema-check.mjs` reste accessible à son chemin compatible ; un
éventuel déplacement dans `scripts/` serait un refactoring séparé.

**Nouveau défaut réellement reproduit** : les runs `34854334290` et `34854690262`
échouent avant démarrage sur `docker pull minio/minio:latest` : `pull access denied`.
Le correctif pointe les trois compose vers la release Quay versionnée et le digest
`sha256:14cea493d9a34af32f524e538b8346cf79f3321eff8e708c1e2960462bd8936e`.
Le même tag/digest et changement de registre sont documentés ici :
[3](https://github.com/opencollective/opencollective-api/pull/12091).
Contrat structurel : **8/11 avant → 11/11 après** ; seul le gate réel qualifie le pull
et le démarrage dans notre environnement. Ce pin restaure une dépendance historique,
**pas une garantie de maintenance/sécurité de MinIO** : revue de stockage/CVE et
stratégie de maintien à traiter avant déploiement, avec H2. Le poste Arena ne peut
pas atteindre Quay ; la preuve de téléchargement est obligatoirement en CI.

**Deux autres défauts runtime reproduits** :
- `d9d2720` télécharge/démarre bien MinIO et exécute migrations/seeds/schema-check,
  mais l'API ne trouve pas `@aws-sdk/s3-request-presigner` après prune. Dépendance
  racine dev au lieu de dépendance API runtime.
- Le test de disposition d'image isolé, après la correction du premier défaut,
  révèle `bcryptjs` manquant : sa version 2.x est installée sous
  `apps/api/node_modules`, non copiée par le Dockerfile.

L'API déclare ses imports AWS, le Dockerfile copie ses modules non hoistés après
prune. Le lock ne change que de métadonnées (2 dépendances déclarées, flag `dev`
supprimé), **versions/résolutions/intégrités toutes inchangées**. Aucun `npm install`
ni `npm audit fix` : refresh de métadonnées via `npm prune --package-lock-only`,
puis vrais `npm ci` (complet et `--omit=dev`) et audit production zéro.
`scripts/check-api-runtime.mjs` reproduit les deux erreurs puis passe localement.
Il est obligatoire dans le runner CI, sans remplacer le vrai démarrage H1.

`scripts/test-staging-stack.mjs`, appelé par le runner CI existant, doit :

1. Construire les Dockerfiles API/worker livrés, sans changer leurs commandes.
2. Démarrer le compose staging réel, projet et volumes éphémères, aucun port publié.
3. Attendre bootstrap des rôles → migration → seed → schema-check.
4. Interroger réellement `/api/v1/health` depuis le conteneur API.
5. Faire traiter un job synthétique `payments_expire` par le vrai worker et vérifier
   son état `done` et une seule tentative dans PostgreSQL.
6. Vérifier `creche_app` NOBYPASSRLS/NOSUPERUSER et l'absence de tenants réels.
7. Détruire uniquement les volumes du projet synthétique, même en cas d'échec.

« Sain » signifie ici réponse HTTP et exécution effective d'un job, pas seulement
un PID actif. Les images n'exposent pas de healthcheck Docker natif. Le runner ne
leur invente pas une étiquette `healthy`. Aucun secret/provider réel n'est hérité,
aucun e-mail/SMS/WhatsApp réel n'est envoyé ; ordonnanceur arrêté dans cette fixture.

Local : `ALLOW_DATABASE_RESET=1 node scripts/test-staging-stack.mjs` avec Docker.
Sans Docker le test sort non-zéro et annonce **NOT EXECUTED**, jamais vert simulé.
En CI il est obligatoire, sans modification de `.github/workflows/*`. Sa défaillance
reste bloquante même si les tests indépendants de synchronisation continuent.

H2/H3 restent ouverts. Le compose **dev** (ancien install réseau et ancien contexte
Docker) reste à reproduire séparément ; ce gate staging ne qualifie pas dev/prod,
le stockage complet, les canaux de notification, ni la matrice d'autorisation G/H2.
