# H2j — Métriques : accès plateforme et exposition Prometheus

2026-09-15 · baseline `872f84fe53e20bcd47fe3587775794553b36e4fb` · PR #44.
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
vrai login administrateur, pas un bypass du garde pour les tests. Runner **53
suites/contrôles**, seuil H2j **26**, compteur dans la notice H2 existante : six
notices attendues au total. Résultats stricts et CI exact-SHA à consigner en PR #44.
Ne pas attribuer la CI H2i à ce lot.

## Collecte d'exploitation : point séparé, encore ouvert

**Changement incompatible pour les scrapers anonymes.** Le target API existant de
`infrastructure/monitoring/prometheus.yml` ne provisionne aucun credential : il
recevra désormais 401. La collecte E2 du SQL exporter/worker est distincte et ne
s'appuie pas sur cette authentification API.

Un scrape manuel autorisé utilise un JWT d'accès récent ; ne pas enregistrer le
token en Git, dans les logs ou une commande partagée. Pour Prometheus,
`authorization.credentials_file` peut lire un bearer depuis un fichier externe,
mais un JWT d'accès expire (15 min nominales). **Aucun provisionnement, montage ou
renouvellement automatique de ce fichier n'est livré ici.** Ne pas stocker un
mot de passe administrateur dans prometheus.yml et ne pas prolonger les JWT pour
contourner cette limite. Un credential de service limité à la lecture de métriques
ou un collecteur interne avec délégation dédiée doit être conçu/qualifié avant
l'exploitation ; ne pas déclarer le target API opérationnel sur cette seule preuve.

## Limites et rollback

- Contrôle d'autorité à l'entrée du scrape, pas un verrou conservé jusqu'à la fin
  de la lecture ; révocation après contrôle et JWT globalement révoqués non qualifiés.
- Pas de remédiation des séries historiques déjà collectées ni de tous les sinks
  de logs ; pas de test de charge/mémoire global, TLS/ingress ou Grafana réel.
- Le helper SECURITY DEFINER et ses grants restent inchangés. Sémantique métier de
  chaque jauge et sécurité des credentials DB ne sont pas réauditées par ce lot.
- Anonymisation, OpenAPI, MFA complète, autres G/H, paie/numérotation restent ouverts.
- Aucun workflow, migration, grant, lockfile ou dépendance npm modifié.

Aucune migration. Avant tout rollback du premier déploiement, bloquer `/metrics`
à l'ingress : restaurer l'ancien code réintroduirait l'accès public et les labels
invalides/chemins privés. Ne pas rendre le endpoint public pour rétablir un scraper.
Conserver les credentials hors dépôt ; vérifier health et worker indépendamment.
Ce rollback est écrit mais non exécuté, aucun environnement client n'a été touché.
