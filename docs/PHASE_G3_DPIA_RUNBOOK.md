# G3a — Approbation DPIA et audit transactionnel

2026-09-15 · base G2 `babbbba37f9883f082a0794a4eb5fd3ad2b10fc7` · PR #44.
Installation neuve, aucune donnée de production. Aucun merge ni déploiement.

## Préflight et preuve avant correction

G2 confirmé : [CI 34927109368](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34927109368),
**9/9** sur babbbba, database **104247378113**, G1=26/G2=113 et H2/H1/F2/F4.
Batterie locale G2 **47/47** consignée dans la PR. Après restauration du sandbox,
HEAD/index étaient revenus sur d6f2dfe ; fetch explicite de la branche Arena,
comparaison de tous les blobs avec babbbba (zéro écart), réalignement sans écrasement.
`npm ci`, base synthétique PostgreSQL 18.4 UTF8, bootstrap des rôles livrés.

`phase45-dpia-approval.api.test.mjs` : **11/33 avant → 33/33 après**.
API réelle, connexions `creche_app` NOBYPASSRLS, contrôles de persistence par une
connexion administrateur distincte. Les 22 scénarios rouges se répartissent ainsi :

- trois auto-approbations acceptées (director, super_admin tenant, auteur après
  approbation par un autre compte) ;
- cinq contrôles d'audit sans aucune entrée (créations, approbations, in_review) ;
- trois remplacements de décision : réessais du même/autre approbateur et deux
  approbateurs concurrents ;
- huit écritures acceptées avec compte suspendu/supprimé, membership désactivé ou
  rôle abaissé après émission du JWT ;
- un état non reconnu promu vers approved ;
- deux succès HTTP malgré une panne contrôlée de stockage de l'audit.

Les neuf refus rôle/tenant/absence et deux contrôles du mécanisme d'audit historique
étaient déjà verts. Ce ne sont pas 22 vulnérabilités distinctes.

Deux erreurs initiales de fixture ont été corrigées **avant** la baseline finale :
l'audit utilise `occurred_at` (pas created_at) ; les deux organisations voient les
mêmes modèles globaux du registre. Un vrai registre privé B est désormais créé pour
le contrôle étranger. Ni ces erreurs ni les modèles globaux ne sont déclarés findings.

## Correctif

- Les deux écritures DPIA revérifient le compte actif/non supprimé et un membership
  actif dans le tenant, dont le rôle actuel est director ou super_admin. Les
  décorateurs HTTP restent inchangés. Un ancien JWT director ne suffit plus après
  déclassement du membership pour **ces deux opérations**.
- L'auteur ne peut pas approuver sa déclaration : 403 DPIA_SELF_APPROVAL_FORBIDDEN.
  Deux comptes distincts peuvent avoir le même rôle director. Pas de nouveau rôle.
- `FOR UPDATE` sur la DPIA sérialise les approbateurs. La première décision est
  conservée ; les réessais autorisés retournent la même réponse sans écraser
  approved_by/approved_at/review_date ni créer une seconde entrée d'approbation.
  L'auteur reste refusé même après cette première décision.
- draft et in_review restent approuvables ; état inconnu : 409 DPIA_STATE_CONFLICT.
- `AuditService.logInTransaction()` utilise le client du `withTenantConnection`.
  Mutation et audit sont committés ensemble ; erreur d'audit → rollback et HTTP 500,
  jamais un faux succès. Le mécanisme historique `log()` reste best-effort pour ses
  autres appelants. Écriture/redaction partagées, logDataAccess inchangé.
- Audit limité à l'identité de l'acteur, tenant, ressource et transition de statut
  (plus l'identifiant de registre à la création). Ni évaluation des risques ni
  mesures de mitigation recopiées dans les valeurs de l'audit.

Aucune migration, aucun grant ou workflow modifié. Formes des réponses positives,
accès aux modèles globaux du registre et intervalle existant de revue +365 jours
conservés. Un réessai HTTP n'est pas un renouvellement de la décision ; le workflow
complet de révision périodique reste à valider séparément.

## Validation

- Deux vraies requêtes concurrentes, toutes deux observées en attente avec
  pg_blocking_pids derrière un verrou de fixture, puis libérées : même résultat,
  une seule entrée d'approbation, acteur de l'audit identique à approved_by.
- Refus : snapshots métier/audit inchangés. Panne d'audit via un trigger de test
  PostgreSQL ciblé, pas un mock de service ; création et approbation annulées.
- Deux cas supplémentaires exercent directement l'AuditService réel contre PG :
  redaction préservée et erreur d'audit historique toujours absorbée.
- Fixtures positives des phases 10/20/21/22 : second directeur synthétique avec
  login HTTP, créé par le helper d'administration dédié `fixtures/dpia-reviewer.mjs`.
  Pas de bypass SQL d'approbation ; les refus d'auto-approbation restent testés en 45.
- Rejeu final : deux services remis au code babbbba, build, reset/migrate/seed,
  **11/33** ; correctif restauré, rebuild et nouvelle base fraîche, **33/33**.
- Typecheck/build workspaces, lint zéro avertissement ESLint, **27/27 unitaires**,
  audit production **0 vulnérabilité**. Avertissement Node préexistant sur le type
  de module de la configuration ESLint distinct des avertissements ESLint.
- Runner **48 suites**, seuil G3 33, notice `G security passed` agrégée G1/G2/G3 ;
  budget des notices testé. Qualification finale : strict local **48/48**, CI
  **34931752882**, **9/9** sur `74b24c29008c7832fe7a6b778efe83b83fc09683`, database
  **104261231618** ; G1=26/G2=113/G3=33 et H2/H1/F2/F4 relus en PR #44.

```sh
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
npm run test:unit
npm audit --omit=dev
# DESTRUCTIF : base *_test synthétique, jamais une base client.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_TEST> node scripts/test-production-roles.mjs
```

Pour le ciblé, bootstrap des rôles puis reset/migrate/seed avant la suite, avec URLs
admin/migrateur/application distinctes et PRODUCTION_ROLE_TESTS=1. Ne pas réinitialiser
une base utilisée par une autre batterie.

## Autre point G3 : terminaison jobs/notifications

Relecture contre E1/E3/H2b existants, **pas de nouveau correctif worker** :
`job-runtime.ts` attend le handler puis termine via jobs_finish_leased conditionné
au bail. Le job send_parent_notification ne modifie aucune ligne de notification ;
l'appelant attendance crée le job et la file dans la même transaction. Les appels
runtime à notif_queue_finish sont dans le drain de main.ts. Fin du job ≠ livraison.

Les suites 27 (baux), 28 (E3, sans device : sent + PUSH_NOT_CONFIGURED_OR_NO_DEVICE)
et 36 (droits après claim et traitements refusés) couvrent les contrats déjà livrés.
`sent` signifie **traité**, pas reçu par un téléphone ; conserver statut + motif est
la décision E explicite, pas une raison de réintroduire skipped. Pas de qualification
FCM/APNs/Meta réelle ni d'exclusivité contre un détenteur des identifiants SQL : les
helpers privilégiés de la base restent des capacités du serveur.

## Limites et rollback

- Contrôle HTTP des mutations DPIA, pas une contrainte SQL protégeant toute écriture
  administrative ; ni preuve que deux comptes correspondent à deux personnes
  indépendantes. Impersonation et pouvoirs globaux restent un périmètre séparé.
- Revérification à l'entrée de l'opération ; révocation **après** cette vérification,
  autres ordres de verrous/isolation et révocation globale des JWT non qualifiés.
- Aucune ancienne décision auto-approuvée invalidée, aucun audit historique inventé,
  aucune purge. Avant une installation sur des données existantes : inventorier ces
  décisions et définir leur réexamen autorisé. Leur simple réessai n'ajoute pas un
  audit rétroactif et ne prolonge plus implicitement la validité de l'accord.
- L'audit global reste best-effort hors de la méthode explicite ; pas de qualification
  globale de sa résistance à l'altération, de toutes ses projections ou de toutes
  les lectures privacy. Autres frontières G/H restent ouvertes.
- Rollback installation neuve : arrêter les écritures DPIA concernées et revenir à
  une version sûre ou livrer un correctif ciblé ; ne pas réactiver l'auto-approbation
  pour contourner l'audit indisponible. Conserver décisions et journaux. Pas de rollback
  de schéma requis par ce lot et aucune suppression d'une migration déjà appliquée.
- Numérotation des factures et prorata paie : décisions client toujours absentes,
  aucun changement implicite. APK Android release et production non qualifiés.
