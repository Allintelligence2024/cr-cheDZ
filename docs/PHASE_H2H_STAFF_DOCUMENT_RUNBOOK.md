# H2h — Préfixe tenant des documents du personnel

2026-09-15 · PR #44 · fixtures synthétiques · aucun merge ni déploiement.

## Préflight et reproduction

H2g confirmé sur `361092c800cc98f99a5b346f5f421a805e9d20db` :
[CI 34909569724](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34909569724),
**9/9 checks**, database **104193817961** ; annotation agrégée H2a=21, H2b=50,
H2c=156, H2d=44, H2e=36, H2f=156, H2g=58 et notices H1 dev/staging, F2 51, F4 7 + PG.

Finding du plan : `StaffService.createDocument` vérifie le profil sous RLS, mais
pas l'appartenance de la clé au tenant. `POST /staff/:id/documents` autorise alors
une référence vers un autre tenant, une clé sans préfixe, l'UUID seul ou un préfixe
ressemblant (`<tenant>-other/...`). La création et son audit sont réellement persistés.

La suite `phase42-staff-document-scope.api.test.mjs` utilise logins et créations
profil/document HTTP, inspection PostgreSQL administrateur des fixtures, API sous
`creche_app`. Matrice finale sur les deux services H2g inchangés : **16/32 avant**.
Après restauration du correctif, reconstruction et base fraîche : **32/32 après**.
Les deux passages réinitialisent/migrent/seedent la base dédiée avant le test.

Les **16 scénarios rouges ne sont pas 16 vulnérabilités** :
- 8 constatent une création indue (4 formes de clés × director/super_admin tenant),
  avec deltas documents/audits capturés dans les diagnostics.
- 8 concernent une erreur 500 au lieu d'un refus explicite 400 : URL absolue, slash
  initial, séparateur encodé et espace initial étaient **déjà bloqués** par la
  contrainte `staff_documents_storage_key_safe` (049), sans persistance.

Exploration : un nom Unicode avait été supposé valide, mais 049 impose un alphabet
ASCII sûr. Ce n'était pas un défaut de préfixe ; le positif a été remplacé par une
clé ASCII autorisée. Aucune relaxation de 049 ni prétention de support Unicode ajoutée.

## Correctif

- `assertStorageKeyInTenant` déplacé sans changement de règle vers
  `shared/authorization/storage-key.ts`, partagé par staff et médias HTTP/sync.
  Réexport depuis `media.service.ts` conservé pour compatibilité.
- Dans `createDocument`, **après** la recherche du profil sous RLS, **avant** INSERT
  et audit : préfixe littéral obligatoire `<tenant courant>/`, sinon **400
  STORAGE_KEY_TENANT_MISMATCH**, messages FR/AR existants.
- Profil inexistant/hors tenant : toujours 404 ; rôle non habilité : toujours 403.
  Pas de modification des contrôleurs, des rôles autorisés ou de l'autorisation RH.
- Ni réécriture, décodage, normalisation ou déplacement de clé. Les clés autorisées
  sont persistées à l'identique et l'audit garde l'acteur ; refus sans création de
  document ni d'audit métier de création. Les contraintes SQL restent en place.
- La fixture de document autorisé de `phase3` utilise désormais le préfixe de son
  organisation ; ses assertions de création/expiration restent inchangées.

## Couverture et gates

**32 scénarios** : 2 rôles écrivains × 11 clés = 22 ; 3 rôles refusés ; 3 cas
profil/acteur hors périmètre ou profil inexistant ; création propre du tenant B ;
lecture comptable minimisée ; liste étrangère vide ; conservation d'une clé historique.
Les snapshots de documents et audits sont comparés sur les écritures refusées.
Le super_admin testé possède une membership tenant ; le support global n'est pas qualifié.

```sh
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
npm run test:unit
npm audit --omit=dev
# DESTRUCTIF : base *_test synthétique dédiée uniquement.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> \
  node scripts/test-production-roles.mjs
```

Ciblé : bootstrap des rôles puis `node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`,
puis `node tests/tenant-isolation/phase42-staff-document-scope.api.test.mjs` avec
DATABASE_URL administrateur de fixture, APP_DATABASE_URL et MIGRATION_DATABASE_URL
distinctes, `PRODUCTION_ROLE_TESTS=1`. Pas de reset interne à la suite et aucune
réinitialisation pendant une autre batterie.

Typecheck/build tous workspaces, lint zéro avertissement, **27/27 unitaires**, audit
production **0 vulnérabilité**, ciblé frais **32/32** et garde du budget des notices verts.
Runner porté à **45 suites/contrôles** ; seuil obligatoire 32 et zéro échec ; annotation
unique H2 enrichie de `H2h=32` sans nouvelle notice (toujours cinq dans l'étape CI).
Confirmation finale H2h : **45/45** local et **9/9** checks sur
`6e328301b1cbbedcd39981ea440329e42e201fe3`, [CI 34911630478](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34911630478),
database **104200182829**. H2h=32, H2a–H2g, F2 51, F4 7 + PG, H1 dev/staging
relus. Six notices effectives avec un retry registre H1 2/3 sur la même image
(cinq nominales hors retry), aucune troncature. PR #44 non mergée.
Docker/Flutter réels restent des gates CI.

## Limites et rollback

- Preuve de **référence persistée hors périmètre**, pas de lecture d'octets du tenant
  voisin. Aucun appel stockage, URL signée ou téléchargement dans ce lot ; les listes
  staff ne révélaient déjà pas `storage_key`, et aucun endpoint de téléchargement staff
  n'est ajouté. Ne pas présenter le finding comme une exfiltration d'objet démontrée.
- Un préfixe ne prouve ni l'existence d'un objet, ni son rattachement à une personne,
  ni la légitimité de son contenu. Aucune nouvelle validation MIME ou politique document.
- Écritures API courantes seulement ; pas de contrainte SQL supplémentaire ni purge
  des anciennes références. Inventaire/remédiation d'historique à traiter séparément.
  Les nouveaux producteurs devront appliquer la même politique ; ne pas injecter
  une clé arbitraire par SQL pour contourner un refus.
- Les autres défauts de syntaxe de clé relevant de 049 ne sont pas tous convertis en
  erreurs métier par ce contrôle de préfixe. Pas de refonte générale de validation.
- En cas d'incident futur : suspendre l'ajout de documents concerné, conserver les
  preuves, vérifier la vraie référence d'upload puis rejouer les gates. Ne pas préfixer
  aveuglément une ancienne clé ni retirer la garde pour faire accepter une référence.
- Migrations 001–061, grants, workflows, SDK et lockfile inchangés. Aucun déploiement.
  Rôles/JWT globaux (G), autres projections/privacy, stockage/CVE, H3 et APK release
  restent ouverts ; paie/facturation inchangées, aucune aptitude production déclarée.
