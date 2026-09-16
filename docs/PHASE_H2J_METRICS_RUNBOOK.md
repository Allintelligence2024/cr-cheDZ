# H2j — Métriques : accès plateforme et exposition Prometheus · H2k — collecte d'exploitation

H2j : 2026-09-15, baseline `872f84fe53e20bcd47fe3587775794553b36e4fb`, PR #44 (mergée).
H2k : 2026-09-15, baseline `47bac1a69fccabfac697bc0bef391d74ce8a51a1` (main post-merge), PR #45.
Données synthétiques, installation neuve ; aucun merge ni déploiement.

## Reproduction et portée

**6/26 avant → 26/26 après**, suite `phase50-metrics.api.test.mjs`. Les trois
fichiers metrics.controller/metrics.service/metrics.middleware ont été rejoués
contre la baseline, puis restaurés : rebuild et **reset/migrate/seed avant chaque
batterie**. API HTTP réelle, PostgreSQL réel et `creche_app` NOBYPASSRLS ; aucun
mock de l'authentification ni du fournisseur SQL de métriques.

Les 20 scénarios rouges, et non 20 vulnérabilités indépendantes :

- 14 refus manquants : anonyme GET/HEAD, bearer invalide, quatre rôles tenant,
  JWT expiré/autre purpose, administrateur déchu/suspendu/pending/supprimé/verrouillé.
- Absence de `Cache-Control: no-store`.
- Exposition HTTP rejetée par le parseur officiel (labels d'histogramme invalides).
- Chemins inconnus conservés tels quels : PII possibles et cardinalité contrôlée
  par le client ; méthode HTTP inhabituelle non regroupée.
- Échappement des labels incorrect ; histogrammes incomplets (buckets à zéro absents).

Six non-régressions : témoin positif/négatif du parseur, accès administrateur actif,
route dynamique exprimée par son template, totaux globaux sous rôle applicatif,
indisponibilité des jauges exprimée par NaN et health public. Les totaux sont
comparés au helper et à un COUNT administrateur avec des jobs dans **deux tenants**.

## Contrat livré

`GET /api/v1/metrics` exige désormais un **JWT d'accès administrateur plateforme**.
Le garde de rôle ne suffit pas : le service relit le compte actif, non supprimé,
non verrouillé et `is_super_admin=true` avant d'interroger les agrégats globaux.
Sans authentification valide : **401** ; rôle tenant ou compte désormais inéligible :
**403**, sans métriques dans la réponse. HEAD applique les mêmes gardes.

Réponse autorisée : `text/plain; version=0.0.4; charset=utf-8`, `Cache-Control: no-store`.
Les compteurs globaux sont conservés pour la plateforme, pas rendus tenantés par
artifice. Une panne de la fonction de jauges laisse NaN (jamais un faux zéro).
Une panne de lecture de l'autorité bloque le scrape, elle n'autorise pas un repli public.

Labels : clés internes JSON sans découpage sur espaces ; échappement des guillemets,
backslashes et nouvelles lignes. Tous les buckets, y compris zéro, sont émis dans
l'ordre numérique, puis +Inf ; count/sum cohérents avec les observations. Middleware :
route Express enregistrée, sinon `unmatched`, jamais req.path ; méthodes usuelles
conservées, autres regroupées sous `OTHER`. Vingt chemins canaris ne créent qu'une
série GET/unmatched/404 et ne sont pas présents dans l'exposition.

## Parseur indépendant

Le gate télécharge uniquement la wheel pure-Python **prometheus-client 0.22.1**
du client officiel Prometheus, SHA256 :

`cca895342e308174341b2cbf99a56bef291fbc0ef7b9e5412a0f26d653ba7094`

`prometheus-parser.mjs` vérifie le hash avant import, y compris dans le cache.
Python 3 (>=3.9 pour ce client) requis ; aucune installation pip, aucun ajout aux
dépendances de production. Wheel dans `.cache/` ignoré, jamais committée. Échec de
téléchargement/hash/import/parse = gate rouge, pas de skip silencieux. La suite
vérifie que ce parseur accepte un témoin valide et refuse l'ancienne syntaxe.
Ce n'est **pas promtool ni une ingestion Prometheus en production** ; les invariants
numériques des histogrammes sont vérifiés en plus par la suite.

## Rejouer et gates

```sh
npm ci
npm run build --workspace @creche/api --workspace @creche/worker
# Cluster jetable *_test et variables de rôles stricts préalablement configurés.
node scripts/bootstrap-roles.mjs
node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs
PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase50-metrics.api.test.mjs
ALLOW_DATABASE_RESET=1 node scripts/test-production-roles.mjs
```

Aucun reset en parallèle de la batterie stricte. Phase11 utilise maintenant un
vrai login administrateur, pas un bypass du garde pour les tests. Runner **55
suites/contrôles** (phase51/H2k, puis phase52/H2l ajoutée depuis), seuil H2j **26**, compteur dans
la notice H2 existante. **Preuves closes** : strict local 53/53 et CI vérifiées
sur le SHA exact de la PR #44 (run `34974936706`, check `database`
`104400172633`), puis **CI post-merge 9/9 sur `47bac1a`** (run `34980118615`,
docker `34980118624`, flutter `34980118653`) et six notices relues sur le SHA.
Ne pas attribuer la CI H2i à ce lot.

## Collecte d'exploitation — H2k, livré

**Problème reproduit** : après H2j, le scraper anonyme de
`infrastructure/monitoring/prometheus.yml` recevait **401** ; aucun
provisionnement, montage ou renouvellement de credential n'existait. Baseline
H2k : suite `phase51-metrics-collector.api.test.mjs` **9/24 avant** correction
(les 15 rouges : chemin collecteur inexistant, config de collecte non livrée,
outil de provisionnement absent) ; la voie admin H2j et le refus anonyme étaient
déjà verts et restent intacts — un credential de plus, jamais un repli public.

**Conception (privilège limité)** :

- L'API ne connaît que des **digests SHA-256**
  (`METRICS_COLLECTOR_TOKEN_HASHES`, liste séparée par virgules) ; le token brut
  (32 octets, base64url) ne vit que dans le fichier monté en lecture seule, lu
  par `authorization.credentials_file` côté Prometheus. Aucun mot de passe
  administrateur dans la config de collecte, aucun JWT d'accès prolongé, aucun
  enregistrement de bearer en Git ou en logs.
- Le collecteur **n'est pas un principal API** : aucune route métier, pas de
  tenant, pas de session, pas de refresh. La comparution du digest se fait en
  temps constant. Liste vide → chemin désactivé ; liste malformée → échec
  d'ouverture du chemin **et** refus de démarrage en production (garde partagée
  `@creche/prod-config`), jamais un partiel silencieux.
- **Rotation** : nouveau couple → les deux digests coexistent (fenêtre de grâce)
  → le fichier Prometheus est remplacé → l'ancien digest sort de la liste →
  l'ancien collecteur reçoit 401 sans corps. **Révocation** : retrait du digest
  (redéploiement/rechargement de la config) ; qualifié par ingestion réelle.
- Provisionnement hors dépôt :
  `node scripts/provision-metrics-collector.mjs --out-file <chemin-absolu-hors-dépôt>`
  (écrit le fichier en 0600, imprime le digest à coller ; refuse d'écrire dans le
  dépôt, refuse un secret < 32 caractères ; `--hash-file` audite un fichier
  existant, permissions incluses).

**Preuves H2k** : suite HTTP/PG réelle **9/24 → 24/24** (acceptation, HEAD,
galbe du digest vs réponse admin, refus inconnu/absent/malformé/schéma
incorrect, périmètre « scrape only » sur routes métier et refresh, rôle tenant
403 conservé, JWT expiré 401, relecture admin sous verrou, NaN jamais 0,
aucun secret dans la sortie, rotation+grâce+révocation, garde prod partagée,
outil de provisioning, structure des fichiers livrés, E2 exporter inchangé).
**Ingestion par un vrai serveur Prometheus** (le parseur officiel ne prouvait
que le format) : `scripts/test-metrics-collector-stack.mjs` démarre
`prom/prometheus:v2.53.0` (l'image épinglée en prod) sur la **config livrée** et
exige : target `api` UP avec `credentials_file`, série `creche_jobs_pending`
requêtable = COUNT SQL réel, target DOWN `401` sur token non provisionné puis
après rotation/révocation, voie admin intacte, aucun token dans la config montée
ni dans les logs du serveur. Gate obligatoire en CI (bloc `RUN_MONITORING_STACK`
du gate strict, comme E2) ; localement sans Docker ni `PROMETHEUS_BIN`
(version ≥ 2.53 vérifiée), il s'annonce NON EXÉCUTÉ — jamais un skip silencieux.

**Rejouer** :

```sh
npm run build --workspace @creche/prod-config --workspace @creche/api
PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase51-metrics-collector.api.test.mjs
# ingestion réelle (CI ou PROMETHEUS_BIN) :
ALLOW_DATABASE_RESET=1 PRODUCTION_ROLE_TESTS=1 RUN_MONITORING_STACK=1 \
  node scripts/test-metrics-collector-stack.mjs
```

**Montage d'exploitation (prod)** : `METRICS_COLLECTOR_TOKEN_FILE` (compose)
pointe le fichier hôte vers `/run/secrets/metrics-collector-token:ro` du service
`prometheus`, même convention que le secret Alertmanager (0400, uid 65534) ;
`METRICS_COLLECTOR_TOKEN_HASHES` alimente l'API. Staging ne livre pas de
Prometheus : la variable y est un simple passe-plat optionnel, sans montage.

## Limites et rollback

- Contrôle d'autorité à l'entrée du scrape, pas un verrou conservé jusqu'à la fin
  de la lecture ; révocation après contrôle et JWT globalement révoqués non qualifiés.
- Pas de remédiation des séries historiques déjà collectées ni de tous les sinks
  de logs ; pas de test de charge/mémoire global, TLS/ingress ou Grafana réel.
- Le helper SECURITY DEFINER et ses grants restent inchangés. Sémantique métier de
  chaque jauge et sécurité des credentials DB ne sont pas réauditées par ce lot.
- Anonymisation, OpenAPI, MFA complète, autres G/H, paie/numérotation restent ouverts.
- Le credential de collecte est à durée non limitée par conception (secret
  d'infrastructure) : ni expiration intégrée ni historique de scrape dans la
  réponse ; la discipline repose sur la rotation documentée. La révocation est
  appliquée à la relecture de la config (redéploiement), pas instantanément en
  base ; aucune liste de révocation en PostgreSQL n'est livrée par H2k.
- Rollback H2k : vider `METRICS_COLLECTOR_TOKEN_HASHES` et redéployer l'API → le
  chemin collecteur se ferme (401), la voie H2j admin reste ; retirer le
  `authorization:` du job `api` rend le scrape 401 sans ouvrir la route. Aucun
  rollback ne doit rétablir un accès anonyme, et aucun secret n'est à purger du
  dépôt (jamais écrit dedans) — supprimer seulement le fichier hors dépôt.
- Aucun workflow, migration, grant, lockfile ou dépendance npm modifié.

Aucune migration. Avant tout rollback du premier déploiement, bloquer `/metrics`
à l'ingress : restaurer l'ancien code réintroduirait l'accès public et les labels
invalides/chemins privés. Ne pas rendre le endpoint public pour rétablir un scraper.
Conserver les credentials hors dépôt ; vérifier health et worker indépendamment.
Ce rollback est écrit mais non exécuté, aucun environnement client n'a été touché.
