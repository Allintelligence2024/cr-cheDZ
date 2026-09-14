# H2d — Projections financières du portail parent

2026-09-14 · PR #44 · fixtures synthétiques · aucun merge ni déploiement.

## Préflight et constat

H2c est confirmé sur `5a6ece2b96d4aec20fdb6ea75bb138d1266623d7` :
[CI 34888169634](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34888169634),
**9/9 checks**, database **104123879371** ; notices H2c 156, H2b 50, H2a 21,
F2 51, F4 7 + PG et H1 dev/staging vérifiées. Ce résultat ne qualifie pas H2d.

La revue a constaté `i.*` et `p.*` dans les détails parent. Le défaut ne se limite
pas aux étoiles : la liste des reçus projetait explicitement `p.notes` et la liste
des factures renvoyait la clé `pdf_url` de stockage.

Reproduction sur l'API H2c compilée, HTTP et PostgreSQL réels sous rôles stricts :
**32/44 avant → 44/44 après** dans
`phase38-parent-financial-projection.api.test.mjs`.

### Ce qui est réellement démontré

- Un comptable enregistre un paiement espèces via HTTP avec une note de gestion :
  celle-ci ressortait dans la liste et le détail parent.
- Un comptable initialise un paiement en ligne via HTTP. Le vrai adaptateur appelle
  un serveur HTTP loopback qui vérifie sa signature HMAC et renvoie un JSON synthétique
  avec URL de redirection, identifiant de transaction et diagnostics imbriqués.
  Le JSON brut, réellement persisté par l'API, ressortait dans le détail parent.
- Les notes de facture et les colonnes techniques (créateur, organisation, etc.)
  étaient publiées avec `i.*`/`p.*` ; les références brutes de stockage également.
- Les 12 assertions rouges comprennent les contrats de clés publiques et le nouveau
  booléen PDF : **ce ne sont pas 12 vulnérabilités indépendantes**.
- Les UUID/chemins techniques ne sont pas déclarés secrets par nature ; leur présence
  ne prouve pas un contournement S3 ni un téléchargement non autorisé. Le défaut est
  l'absence de minimisation et, notamment, la divulgation de contenu interne arbitraire.
- Aucune donnée réelle de carte, aucun secret fournisseur réel, aucun paiement réel.
  La simulation ne qualifie pas SATIM/CIB/Edahabia en production.

### Faux positifs et positifs conservés

Les routes comptables refusent déjà le rôle parent ; la liste des reçus exclut déjà
les paiements pending ; l'export de droits H2a ne publie déjà ni notes financières ni
réponse passerelle brute. Ces contrôles sont testés, pas revendiqués comme réparés.
Le détail parent d'un paiement pending reste lisible sous autorisation avec son
statut pending : **aucun changement de cycle métier ni faux reçu confirmé**.

## Correctif et contrat public

`apps/api/src/modules/parents/financial-projection.ts` centralise deux projections
SQL fixes (alias `i`/`p`/`c`), partagées entre listes et détails. Aucune colonne ajoutée
ultérieurement aux tables ne devient publique automatiquement. Les contrôles H2c de
lien courant/capacités et la RLS restent obligatoires ; une projection ne les remplace pas.

### Factures — `GET /parent/invoices` et `GET /parent/invoices/:id`

Champs publics :

`id`, `child_id`, `invoice_number`, `period_year`, `period_month`, `subtotal`,
`discount_amount`, `total_amount`, `paid_amount`, `balance`, `status`, `due_date`,
`sent_at`, `created_at`, `updated_at`, `pdf_ready`, `child_first_name`, `child_last_name`.

Le détail ajoute `lines`, avec uniquement `id`, `description_fr`, `description_ar`,
`quantity`, `unit_price`, `total_price`, `line_type`.

`pdf_ready` signifie **référence PDF persistée non nulle et non vide**, pas un contrôle
d'existence sur le stockage. La clé `pdf_url` n'est plus dans le JSON parent. Le client
utilise `GET /parent/invoices/:id/pdf`, qui conserve son contrôle d'autorisation et son
comportement buffer local/redirection signée. Ni nouvelle URL publique ni proxy sans garde.

### Reçus — `GET /parent/receipts` et `GET /parent/receipts/:id`

Champs publics :

`id`, `child_id`, `reference_number`, `receipt_number`, `amount`, `currency`, `method`,
`status`, `received_at`, `confirmed_at`, `created_at`, `child_first_name`, `child_last_name`.

Les notes non marquées publiques, réponses brutes passerelle, références fournisseur,
créateur, organisation, rattachements techniques et clés/URLs de stockage ne sortent plus
par ces quatre réponses. Les références métier `invoice_number`, `reference_number` et
`receipt_number` restent disponibles. Aucun effacement ni masquage en base.

### Compatibilité

C'est une **réduction intentionnelle du contrat JSON parent**. Aucun écran factures/reçus
consommant ces champs n'a été identifié dans `apps/parent-mobile/lib` livré. Tout autre
client doit utiliser les champs publics, `pdf_ready` et la route PDF protégée ; il ne doit
plus utiliser une clé de stockage brute ni une note comptable comme contenu familial.
Les dates, montants, statuts, descriptions FR/AR et références métier sont conservés.
Leur format et les règles de calcul ne sont pas refondus dans ce lot.

Les routes `/billing/*` de la direction/comptabilité sont inchangées et gardées par rôles.
Elles conservent les notes, allocations et éléments de diagnostic nécessaires au travail
interne. Cette conservation ne constitue pas une revue complète de leurs propres champs.

## Preuves et gates

Les 44 scénarios vérifient :

- l'ensemble exact des clés des quatre réponses (et des lignes de facture) ;
- l'absence des champs internes et marqueurs synthétiques ;
- les totaux/solde, références, dates, noms d'enfant et descriptions FR/AR ;
- la réponse passerelle HTTP réellement persistée, son exclusion du portail et sa
  conservation pour le comptable ;
- les trois états de référence PDF (non vide, null, vide), et l'accès PDF local autorisé ;
- les contrôles déjà effectifs : pair non lié, autre tenant, capacité factures retirée,
  gardien supprimé, routes staff et export de droits H2a ;
- le maintien en base du grand livre et des éléments internes après les lectures.

Le PDF est une fixture de contrôle d'accès, pas un test de rendu. Le fournisseur de
paiement est local et synthétique ; aucun worker n'est lancé par cette suite. Pas de
reset interne : identifiants uniques, base fraîche préparée par le gate, répertoire PDF
et serveur loopback nettoyés en fin de test. Ne pas lancer de reset concurrent.

```sh
npm ci
npm run build
# DESTRUCTIF : base *_test dédiée, jamais une base client.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> \
  node scripts/test-production-roles.mjs
```

Pour le ciblé, bootstrap des rôles puis base fraîche via
`node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`,
puis `node tests/tenant-isolation/phase38-parent-financial-projection.api.test.mjs` avec
`DATABASE_URL` administrateur de fixture, `MIGRATION_DATABASE_URL`, `APP_DATABASE_URL`
et `PRODUCTION_ROLE_TESTS=1`. Aucun grant ad hoc des helpers dans ce mode.

Local ciblé : **44/44**, typecheck/build tous workspaces, lint `--max-warnings=0`,
**27/27 unitaires**, audit production **0 vulnérabilité**. Le runner contient désormais
**41 suites/contrôles** ; le gate exige 44 scénarios et `H2d financial projection passed`.
Batterie complète locale finale : **41/41 suites vertes**, avec H2a 21, H2b 50,
H2c 156 et H2d 44. La signature HMAC testée porte sur la requête d’initialisation,
pas sur la réponse du fournisseur. CI du SHA publié à confirmer dans la PR #44.
Docker/Flutter réels restent des gates CI, non remplacés par les guards locaux.

## Rollback et frontières

- Code seulement ; aucun workflow, SDK, lockfile, grant ou migration modifié.
  Migrations 001–061 intactes, pas de purge de snapshots ni de dossiers financiers.
- Si un client casse, adapter son contrat public ou suspendre la route concernée ;
  ne pas restaurer `SELECT *`/les diagnostics passerelle pour contourner l'incident.
  Conserver les preuves puis rejouer les gates avant tout futur déploiement autorisé.
- Les notes conservées en base ne sont pas reclassées juridiquement ; une éventuelle
  note explicitement destinée à la famille nécessiterait un contrat dédié, pas la
  republication de toutes les notes de gestion.
- Copies historiques déjà reçues, exports antérieurs, URLs déjà signées et révocation
  globale des JWT (G) ne sont pas corrigés par une projection de réponse.
- Santé/journal/médias, autres routes privacy (registre/DPIA/violations), anonymisation,
  autres dettes H2/H3, maintien/CVE stockage et Android release restent ouverts.
  Pas de décision paie ou de changement de facturation dans ce lot.
- Aucun merge, déploiement ni aptitude à la production déclaré.
