# H2g — Consentements des photos du portail parent

2026-09-14 · PR #44 · données synthétiques · aucun merge ni déploiement.

## Préflight et reproduction

H2f confirmé sur `5814ed0f9b33fcd5a0e8957c31ce6f91bdf114ac` :
[CI 34903495839](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34903495839),
**9/9 checks**, database **104174698221**, notices H2a–H2f, F2/F4 et H1 dev/staging.

La nouvelle suite `phase41-photo-consent-scope.api.test.mjs` reproduit sur cette
API inchangée **35/58 réussites et 23 échecs**. Les 23 échecs sont des scénarios,
pas 23 vulnérabilités distinctes. Logins, enregistrement média, publication et
consentement/retrait sont de vrais appels HTTP ; les vérifications d'état utilisent
PostgreSQL. L'API utilise `creche_app`, sans privilèges administrateur.

| Constat avant correction | Reproduction / qualification |
|---|---|
| Enfant de rattachement omis de `children_in_photo` | Média enregistré par HTTP pour A avec liste `[B]` ; consentement B accordé, A refusé : publication et nouvelle URL parent indûment autorisées |
| Révocation de A après publication du même média | Nouveau consentement refusé par HTTP ; l'ancien média visible reste accessible avant correction |
| Déclaration absente/vide ou flag incohérent | Producteur HTTP calcule le flag ; SQL explicite simule les anciens médias visibles et les métadonnées historiques incohérentes. Le client ne peut pas fournir `all_consents_checked` dans le DTO |
| Co-enfant supprimé après enregistrement | Suppression logique SQL terminée avant appel HTTP ; ancien consentement encore accepté |
| Doublons `[A,A]` avec consentement valide | Faux négatif de lecture parent : publication fonctionne déjà, mais URL refusée à tort ; ce n'est pas une fuite |

Contrôles déjà efficaces conservés : refus du co-enfant sans consentement,
isolation pair/autre tenant, capacité journal H2c, séparation de la route staff.
Les photos individuelles/groupes autorisés, y compris primaire omis mais réellement
consentant, doivent continuer à fonctionner. Le retrait de visibilité reste possible.

## Correctif et frontières

`shared/authorization/photo-consent.ts` fournit `photoConsentsAllowed`, exécuté
sur la connexion tenant/RLS aux deux frontières :

1. `MediaService.setVisibility`, uniquement pour `visible=true` ; refus **422
   CONSENT_REQUIRED** avant mutation de visibilité. Le retrait `false` reste libre
   de ce contrôle de consentement, sous les rôles existants.
2. `ParentsService.photoUrl`, après les contrôles H2c et la vérification média/enfant,
   visibilité et non-suppression ; refus **422 CONSENT_REVOKED**, sans signature ni
   journal d'accès média. `photos()` exclut ces entrées du fil par ce code existant.

La déclaration doit être non nulle/non vide et `all_consents_checked` strictement
vrai ; ses éléments nuls sont refusés. Le périmètre vérifié est l'ensemble
**dédupliqué de `child_id ∪ children_in_photo`** (primaire inclus lorsqu'il existe).
Chaque enfant doit être du tenant courant, non supprimé, avec le dernier consentement
`photo_individual` accordé et non révoqué. Le flag seul n'est donc pas une preuve.

La règle historique « dernier consentement par enfant » est conservée. Les deux
frontières partagent désormais la même requête ; aucun grant, SECURITY DEFINER,
nouvelle migration ni bypass RLS. Producteurs HTTP/sync, stockage et routes staff
inchangés. La correction ne réécrit pas les déclarations, consentements ou médias.

## Matrice, commandes et preuves

- **12 cas × 4 contrôles = 48** : publication et état PG ; URL directe et compteur
  de journal d'accès ; fil et compteur ; retrait de visibilité et métadonnées.
- **10 contrôles complémentaires** : révocation/restauration du primaire, exclusion
  du fil, pair/autre tenant, capacité journal, téléchargement staff interdit au parent
  mais conservé au directeur, republication refusée et absence de purge.
- Les scénarios de lecture historique forcent explicitement la visibilité après le
  test de publication : ils ne prétendent pas que le nouveau service l'a autorisée.
- Le SDK produit une vraie signature locale avec identifiants synthétiques et endpoint
  loopback port 9. **Aucun objet téléchargé, aucune image réelle ni fournisseur S3
  qualifié.** Le test prouve la délivrance/refus de nouvelles URLs et la journalisation.

```sh
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
npm run test:unit
npm audit --omit=dev
# DESTRUCTIF : base *_test dédiée seulement.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> \
  node scripts/test-production-roles.mjs
```

Pour le ciblé : bootstrap des rôles puis
`node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`,
puis `node tests/tenant-isolation/phase41-photo-consent-scope.api.test.mjs` avec URLs
administrateur de fixture, migrateur et application distinctes et `PRODUCTION_ROLE_TESTS=1`.
Pas de reset interne à la suite ; ne pas réinitialiser la base pendant une autre suite.
Le rejeu avant/après remplace temporairement les deux services par leurs blobs H2f,
sans changement de branche, puis restaure le correctif et reconstruit l'API ; base
fraîche avant chaque ciblé.

Le runner contient **44 suites/contrôles** et exige au moins **58 scénarios** H2g
et zéro échec. La notice agrégée `H2 confidentiality passed` expose `H2g=58` avec
les résultats H2a–H2f ; les détails par lot restent dans stdout. Résultats ciblés verts : **58/58**.
Typecheck/build tous workspaces, lint zéro avertissement, **27/27 unitaires** et audit
production **0 vulnérabilité** verts. Batterie stricte fraîche : **44/44** ; notices
H2a 21, H2b 50, H2c 156, H2d 44, H2e 36, H2f 156 et H2g 58 vérifiées. Rejeu final
sur les deux services H2f puis correctif restauré, avec reconstruction et base fraîche
à chaque passage : **35/58 avant → 58/58 après**.
CI du SHA publié à vérifier en PR #44 ; Docker/Flutter réels restent des gates CI,
non remplacés par les seuls contrôles structurels locaux.

## Plafond d'annotations CI reproduit

Le premier SHA `433ac3e65c952371e3a0bb399b40e999c8487ef1` a **9/9 checks verts**
([run 34907534465](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34907534465)),
mais la notice H2g n'apparaît pas : 4 notices H1/F2/F4 + 7 H2 dépassent le plafond
GitHub de **10 notices par étape**. Source : [2](https://github.com/actions/toolkit/blob/main/docs/problem-matchers.md#limitations).
Le check database 104187566158 expose exactement les dix premières notices ; les logs
Azure sont inaccessibles ici (EOF/TLS), donc pas de qualification H2g par cette notice.

`ci-notice-budget.test.mjs` reproduit le dépassement **11 > 10**, puis vérifie le budget
et la présence des sept compteurs réels dans une seule notice agrégée H2. Les sept
seuils et refus de résultat incomplet restent inchangés. Le runner passe à **5 notices**
dans cette étape : H1 dev/staging, F2, F4 et H2 agrégée. Aucun workflow modifié.
Le garde est intégré avant la batterie stricte ; nouvelle CI du SHA publié à confirmer.

## Limites et rollback

- Pas de reconnaissance des personnes dans les octets : la déclaration peut omettre
  des personnes réellement présentes. Le rattachement primaire, lui, ne contourne
  plus le contrôle. Pas de nouvelle politique MIME/type/document ni projection de
  champs médias ; ces sujets restent ouverts dans H2.
- Le contrôle concerne la prochaine publication/génération d'URL ; il **ne rappelle
  pas les URLs déjà signées** et ne purge pas les objets ou caches clients. Pas de
  garantie de sérialisation avec une révocation concurrente pendant une requête.
- Pas d'arbitrage juridique entre gardiens, de départage des consentements aux mêmes
  timestamps ou de nouvelle règle après suppression de l'auteur d'un consentement.
- L'accès interne staff demeure régi par ses rôles antérieurs, pas par le consentement
  parent. Revalidation globale des rôles/JWT en G ; autres routes privacy/snapshots,
  maintien/CVE stockage et APK release restent ouverts. Aucune aptitude production.
- En cas de refus sur un ancien média incohérent : le retirer de la visibilité parent,
  conserver les preuves et faire vérifier la déclaration par le personnel autorisé.
  Ne pas forcer le flag, inventer des participants/consentements ou supprimer la preuve
  pour contourner le contrôle. Corriger puis rejouer les gates avant republication.
- Code seulement, migrations 001–061 et workflows inchangés. En cas d'incident de
  déploiement futur, suspendre le chemin photo parent avant rollback applicatif ;
  ne pas réouvrir le contournement pour rétablir le service. Aucun déploiement effectué.
