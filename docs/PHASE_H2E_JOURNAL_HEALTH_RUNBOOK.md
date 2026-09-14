# H2e — Journal parent et données de santé

2026-09-14 · PR #44 · données synthétiques · aucun merge ni déploiement.

## Préflight

H2d confirmé sur `6437e5cdc921fd09e77102a96d20cd9c6b6d5df5` :
[CI 34892605700](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34892605700),
**9/9 checks**, database **104138713600**. Notices H2d 44, H2c 156, H2b 50,
H2a 21, F2 51, F4 7 + PostgreSQL et H1 dev/staging vérifiées. Ce résultat ne
qualifie pas le nouveau SHA H2e.

## Reproduction avant correction

`phase39-journal-health-disclosure.api.test.mjs` : **28/36 avant → 36/36 après**,
API compilée H2d, HTTP et PostgreSQL réels sous rôles de production. Les événements
sont publiés par la vraie route HTTP journal ; les tokens sont obtenus par login.
Aucun worker, transport de notification ou fournisseur externe n'est lancé.

### Écarts confirmés

- Un gardien avec `can_view_journal=true`, `can_view_health=false` voyait dans le
  fil parent l'identité, le type et l'horodatage d'événements `temperature` et
  `health_observation`.
- Les DTO journal acceptent aussi des champs annexes sur ces événements. Des
  marqueurs médicaux placés dans `activity_notes`/`incident_description` étaient
  réellement retournés par le fil, même sans permission santé.
- L'export H2a excluait déjà `health_observation` sans permission santé, mais pas
  `temperature`. Métadonnées et champs annexes d'un événement de température
  ressortaient dans le JSON HTTP **et dans le nouvel export persisté**.
- Retirer le droit santé avant la requête suivante ne corrigeait pas ces omissions.
- 101 nouveaux événements médicaux plus récents occupaient toute la page du fil
  limité à 100, au détriment d'un ancien repas autorisé.

Les types sont déjà classés médicaux dans le modèle : le trigger de résumé de la
migration 007 traite `temperature` et `health_observation` comme `has_health_obs`.
Cette migration n'est pas modifiée.

### Faux positifs écartés et positifs conservés

- Le fil parent ne renvoyait déjà **ni `temperature_celsius` ni `health_observation`**
  comme colonnes, même pour un parent autorisé. Le correctif n'ajoute pas ces champs.
  La fuite confirmée porte sur les événements/métadonnées et leurs champs annexes.
- H2a masquait déjà ces deux colonnes médicales dans les événements non médicaux
  mixtes et excluait le type `health_observation` sans droit santé.
- Les événements privés/masqués étaient déjà exclus du fil et des exports, y compris
  pour l'opérateur privacy. Ils le restent.
- Le droit santé seul ne donnait pas accès au journal ; les routes journal du personnel
  et l'endpoint santé parent avaient déjà leurs propres gardes.
- Repas, activités et incidents restent des événements de journal sous leur droit
  existant. Les types médicaux visibles restent accessibles avec journal **et** santé.

## Correctif commun

`shared/authorization/journal-disclosure.ts` fournit
`PARENT_JOURNAL_VISIBILITY_SQL`, utilisé par le fil parent et les nouveaux exports
privacy :

1. `visible_to_parents=true` ;
2. `note_is_private IS NOT TRUE` ;
3. permission santé requise pour **les deux** types `temperature` et
   `health_observation`, y compris leurs métadonnées et champs annexes.

Le fragment SQL est une constante de code ; `$1` est l'enfant, `$2` le booléen de
permission santé calculé côté serveur, jamais un paramètre de permission HTTP.
Les appelants conservent l'autorisation journal et la RLS tenant. La projection
explicite des valeurs médicales reste nécessaire dans l'export : une règle de
visibilité n'est pas une permission de publier toutes les colonnes.

Le fil vérifie d'abord le droit journal H2c, puis lit le droit santé sur un lien
courant via `CURRENT_GUARDIAN_LINK_SQL`. Le filtrage médical est fait **en SQL avant
LIMIT 100**. Un tri secondaire par id stabilise les égalités d'horodatage.

L'export conserve sa politique H2a : non-opérateur selon capacités du gardien,
director/super_admin opérateurs ; santé seule sans journal produit un journal vide.
Les exports autorisés conservent les valeurs médicales visibles, tandis que les
sources et snapshots antérieurs restent intacts. Aucun nouveau privilège DB.

## Matrice de preuve — 36 scénarios

- Fil avec journal seul : aucun événement médical, mais repas/activité/incident présents.
- Fil avec journal+santé : événements médicaux visibles présents, projection préexistante
  conservée ; aucun ajout des valeurs médicales brutes dans le fil.
- Santé seule : fil refusé, endpoint santé et partie santé de l'export conservés.
- Staff : vue de travail avec valeurs médicales et événements internes inchangée ;
  parent refusé sur la vue brute et la prévisualisation du personnel.
- Nouveaux exports HTTP/persistés : température exclue sans santé, valeurs médicales
  conservées pour le gardien habilité et l'opérateur. Égalité HTTP/JSON stocké vérifiée
  à chaque génération utilisée dans le test.
- Révocation santé avant requête : fil et nouvel export recalculés ; restauration
  redonne l'accès autorisé. Révocation journal distincte de celle de santé.
- Pair non lié/autre tenant : accès refusé.
- Pagination : 101 événements médicaux **créés par HTTP**, ancien repas encore accessible
  au parent limité ; parent pleinement autorisé toujours limité à 100 lignes.
- Valeurs sources et ancien snapshot autorisé inchangés en PostgreSQL.

Les huit assertions rouges ne sont pas huit vulnérabilités indépendantes : certaines
vérifient la même omission à une autre frontière, après révocation ou sous pagination.

## Validation

```sh
npm ci
npm run build
# DESTRUCTIF : base dédiée *_test, jamais une base client.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> \
  node scripts/test-production-roles.mjs
```

Ciblé : bootstrap des rôles, puis base fraîche avec
`node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`,
puis `node tests/tenant-isolation/phase39-journal-health-disclosure.api.test.mjs`
avec `DATABASE_URL` administrateur de fixture, `MIGRATION_DATABASE_URL`,
`APP_DATABASE_URL`, `PRODUCTION_ROLE_TESTS=1`. Aucun grant ad hoc des helpers.
La suite ne fait pas de reset interne ; identifiants uniques. Ne pas lancer de reset
concurrent avec une autre suite.

Local ciblé **36/36**, typecheck/build tous workspaces, lint `--max-warnings=0`,
**27/27 unitaires**, audit production **0 vulnérabilité**. Runner existant porté à
**42 suites/contrôles**, exigeant 36 scénarios et `H2e journal health passed`.
Batterie complète locale finale : **42/42 suites vertes**, notices H2a 21, H2b 50,
H2c 156, H2d 44 et H2e 36 vérifiées. CI du SHA publié à confirmer dans la PR #44.
Docker/Flutter ne sont pas disponibles localement ; leurs guards ne remplacent
pas les gates CI réels.

## Rollback et limites

- Code uniquement : migrations 001–061, grants, SDK, lockfiles et workflows inchangés.
- Si un client exige les anciennes lignes, ne pas rétablir la fuite : adapter
  l'affichage aux droits, suspendre le chemin concerné si nécessaire et rejouer
  les gates avant un futur déploiement autorisé. Aucun déploiement ici.
- La preuve concerne des révocations terminées avant l'appel HTTP suivant, pas une
  sérialisation globale des révocations concurrentes pendant une requête.
- Aucune purge de snapshot historique, aucun rappel de données déjà reçues, aucune
  révocation globale des JWT/sessions (G).
- Les autres contrôles des demandes privacy (notamment leur état utilisateur/membership),
  registre/DPIA/violations et la politique d'accès/conservation des anciens snapshots
  restent à revoir. H2e ne les qualifie pas indirectement.
- La règle classe les types médicaux structurés, pas tout texte libre. Une donnée
  médicale saisie dans un texte déclaré non médical nécessite une revue dédiée des
  producteurs/projections. Tout nouveau type d'événement doit être classé et testé.
- Médias, autres projections santé, anonymisation, autres dettes H2/H3, stockage/CVE
  et APK release restent ouverts. Paie et facturation inchangées.
- Aucune clôture de la grappe confidentialité ni aptitude à la production déclarée.


## Confirmation de livraison et suite H2f

H2e publié sur `d177badfb5670b79264148c472d6de5a6c9e44c0` :
[CI 34896950734](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34896950734),
**9/9 checks**, database **104153310242**. Notices H2e 36, H2d 44, H2c 156,
H2b 50, H2a 21, F2 51, F4 7 + PostgreSQL et H1 dev/staging vérifiées.
La suite [H2f](PHASE_H2F_PRIVACY_ACTOR_RUNBOOK.md) protège l'état courant de l'acteur
des demandes de droits. Rôles/JWT globaux, autres routes privacy et projections ouverts.
Aucun merge ou déploiement.
