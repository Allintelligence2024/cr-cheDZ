# H2i — Sélection du stockage et refus précoce de configuration ambiguë

2026-09-15 · baseline `4c36ad6aa545c0a5adb627661262ba37ac023592` · PR #44.
Installation neuve, données synthétiques. Aucun merge ni déploiement.

## Preuve avant/après

`phase49-storage-selection.test.mjs` : **14/48 avant → 48/48 après**.
Rejeu des cinq fichiers runtime modifiés sur la baseline, rebuild API + worker,
**reset → migrations → seeds avant chaque batterie**, puis restauration du correctif
et même protocole. Le nouveau sélecteur, non importé par la baseline, n'y intervient pas.
Aucun mock du sélecteur, du ConfigService Nest ou des services de lecture/écriture.

Les **34 scénarios rouges ne sont pas 34 vulnérabilités indépendantes** :

| Groupe | Rouges | Constat reproduit |
|---|---:|---|
| Backend production absent/vide/faute/casse/espaces | 5 | La garde accepte une configuration que le runtime interprète différemment |
| Identifiants S3 absents/vides/blancs | 6 | Le backend s3 sélectionné passe la garde puis utilise des défauts ou des identifiants inutilisables |
| Répertoire local vide/blanc/relatif/alias du défaut | 4 | Validation ne correspondant pas au chemin utilisé |
| Services PDF, exports et vidéo ; backend absent/vide/inconnu | 9 | Repli silencieux sur S3 ou absence de contrôle de la sélection |
| Entry points API + worker, cinq configurations invalides | 10 | Refus absent ou trop tardif : tentative DB, voire API démarrée en développement |

Quatorze non-régressions : configurations s3/local explicites (2), identifiants de
développement déjà refusés (2), défaut s3 hors production (3), vidéo locale toujours
interdite en production (1), vrais boots API/worker avec les deux backends (4),
écriture/lecture locale et transport S3 en loopback (2).

### Nature des preuves

- Garde réelle partagée, vrais `ConfigService`, `PdfStorageService`, `ExportsService`
  et sélecteur de `VideoService` ; certains tests de service sont directs, **pas HTTP**.
- Vrais processus `apps/api/dist/main.js` et `apps/worker/dist/main.js`.
  Sur configuration invalide : exit 1 avec variable fautive nommée, aucune connexion
  à la sonde TCP PostgreSQL, aucune annonce de service/worker démarré. Pas de secret
  configuré dans le diagnostic. La sonde permet de distinguer refus de configuration
  et simple échec ultérieur de connexion DB.
- Sur configuration valide : marqueurs de démarrage observés contre PostgreSQL 18,
  rôle `creche_app` NOBYPASSRLS et grants de production, puis arrêt des processus.
  Ce smoke test ne qualifie pas à lui seul tous les handlers ni le drain ; les gates
  E/H1 existants restent nécessaires. Scheduler désactivé dans ces seuls processus
  de smoke test, aucune fréquence ou politique métier modifiée.
- Fichier réellement écrit par le worker et relu par l'API avec la même clé sous
  un UUID de tenant. Backend s3 : vrais PUT/GET SDK vers un serveur HTTP loopback,
  octets comparés. **Ce serveur est un double de fournisseur** : ni autorisation
  SigV4 côté serveur ni MinIO/S3 externe, durabilité ou permissions bucket qualifiées.

## Contrat corrigé

`@creche/prod-config.resolveStorageBackend` devient le sélecteur commun :

| Environnement du processus | Absent | `local` / `s3` | Vide, faute, casse ou espaces ajoutés |
|---|---|---|---|
| `production` | Refus | Accepté sous réserve des autres contrôles | Refus |
| `development`, `test`, `staging` | `s3` (défaut runtime conservé) | Accepté | Refus |

La validation de production, les lecteurs PDF/exports, la sélection vidéo et
l'écriture du worker utilisent la même règle. L'API capture le choix à la construction
des services. Les principaux entry points appellent la garde **avant accès DB** ;
hors production, le contrôle du sélecteur reste actif, pas celui des secrets de prod.

Lorsque **s3 est sélectionné en production**, `S3_ACCESS_KEY` et `S3_SECRET_KEY`
doivent être présents, non blancs et différents des défauts connus. Aucune valeur
réelle de credential n'est insérée dans le diagnostic. Ce contrôle n'est pas une
validation de ces credentials par le fournisseur.

Lorsque **local est sélectionné en production**, `STORAGE_LOCAL_DIR` doit être
explicite, absolu, non vide, sans espaces de bord, et son chemin normalisé ne doit
pas être `/tmp/creche-pdf`. L'existence, les droits, les liens symboliques, le partage
du volume API/worker et sa persistance restent des contrôles d'exploitation séparés.
Le local reste possible pour PDF/exports ; **les clips vidéo locaux restent refusés
en production (422 STORAGE_POLICY)**, sans élargissement de leur politique.

Les compositions livrées fournissent déjà `STORAGE_BACKEND` aux deux processus,
avec défaut explicite `s3` dans le manifeste. Il ne s'agit pas d'une variable absente
dans le processus. Fournir la même configuration et, en local, le même volume aux
lecteurs/écrivains ; ce patch ne compare pas deux déploiements configurés différemment.

## Rejouer et gates

Base jetable `_test`, rôles bootstrap configurés, aucune autre batterie concurrente :

```sh
npm ci
npm run build --workspace @creche/api --workspace @creche/worker
node scripts/bootstrap-roles.mjs
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase49-storage-selection.test.mjs
ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
```

Le runner contient désormais **52 suites/contrôles**, seuil H2i obligatoire **48**.
Compteur ajouté à l'agrégat H2, **aucune notice supplémentaire**. Résultats stricts
et CI exact-SHA à consigner en PR #44 après exécution, avec relecture des six notices.
Ne pas attribuer le 9/9 G1d de la baseline à ce lot.

Pour le rouge, sauvegarder puis substituer les blobs baseline de :
`packages/prod-config/src/index.ts`, services API PDF/exports/vidéo et
`apps/worker/src/pdf.ts`. Rebuild et base fraîche, exécuter la suite finale ; restaurer
les fichiers en finally, rebuild et base fraîche avant le vert. Ne jamais faire
ces substitutions ou un reset pendant la batterie stricte.

## Limites et autres points

- **Pas une unification de tous les médias sur le backend local.** Le service
  média/signature est toujours S3, même lorsque les PDF/exports sont locaux.
  Le contrôle de credentials ajouté ici porte sur le backend s3 sélectionné ; la
  configuration S3 de ce service média en mode local reste à qualifier séparément.
- Pas de migration automatique des fichiers/anciennes références, de vérification
  globale des objets, de chiffrement ni de qualification de fournisseur réel.
  La purge conserve le backend historique porté par chaque clip, pas le nouveau
  choix global ; aucune donnée historique n'est réécrite.
- `createApp()` et les imports directs de services ne remplacent pas le bootstrap
  de production pour tous les contrôles de secrets. Le sélecteur y est contrôlé,
  mais la garde globale de secrets reste appelée par les entry points livrés.
- `/metrics` public/format Prometheus reste **ouvert**, tout comme anonymize,
  OpenAPI, autres G/H, MFA complète et décisions paie/numérotation. Reconnaissance
  du code des métriques effectuée, aucun correctif ni qualification annoncée ici.
- Workflows, migrations (notamment 001–052), grants, dépendances et lockfile inchangés.
  Pas d'APK release, de merge ou de déploiement.

## Exploitation et rollback du premier déploiement (non exécuté)

Écrire explicitement le choix dans l'environnement, fournir les credentials S3 ou
le répertoire local approprié, puis redémarrer API et worker ensemble. Une erreur
nomme la variable : corriger sa valeur, ne pas contourner en changeant NODE_ENV.

Aucune migration de données requise. En cas de rollback, arrêter les producteurs
avant de restaurer l'image précédente ; conserver **la même configuration explicite**
des deux processus et le même volume/bucket, puis vérifier santé et un fichier de
contrôle. Ne pas supprimer/déplacer les fichiers ou réécrire les références SQL.
Revenir au code antérieur réintroduit les replis silencieux : la configuration
explicite est une précaution opératoire, pas une correction équivalente au patch.
