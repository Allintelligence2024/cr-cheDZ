# G2 — Lignes globales, connexions réutilisées et allocations concurrentes

2026-09-15 · base G1a `68a187d22bd1bfd2ca6844ba93823a35d023d2c7` · PR #44.
Installation neuve, aucune base de production. Aucun merge ni déploiement.

## Préflight

G1a confirmé : [CI 34913991948](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34913991948),
**9/9 checks** sur 68a187d, database **104207497079**, notice G1 26 et H2/H1/F2/F4.
Le dernier log local G1 a disparu avec la restauration du sandbox : pas de résultat
local complet inventé. Le nouveau workspace avait HEAD/index sur d6f2dfe et les fichiers
G1 ; fetch explicite Arena, comparaison exhaustive des blobs avec 68a187d (zéro écart),
réalignement de HEAD/index sans écrasement de fichiers. Base synthétique recréée en UTF8.

## Trois findings reproduits avant correction

`phase44-rls-integrity.pg.test.mjs` ouvre de vraies connexions `creche_app` NOBYPASSRLS,
avec les grants livrés, pas de mocks SQL ni d'administration dans les connexions testées.
Administrateur réservé aux fixtures et observations indépendantes.

| Finding | Avant | Après |
|---|---|---|
| 014/018 : lignes globales de feature_flags/background_jobs/outbox_events modifiables par DML ordinaire | INSERT, UPDATE, DELETE, adoption d'une ligne globale et promotion d'une ligne propre vers NULL acceptés | INSERT/promotion refusés 42501 ; UPDATE/DELETE/adoption ne touchent aucune ligne |
| 029 réintroduit le cast direct de GUC corrigé en 018 | Après COMMIT, le tenant local devient `''` : 22P02 sur les trois tables privacy ; espaces également en erreur | `app_tenant_id()` : résultat vide sans erreur, tenant A/B corrects conservés |
| 023 : paiement non verrouillé avant somme des allocations | Deux factures différentes acceptent 70 + 70 pour un paiement de 100, total **140 committé** | La seconde transaction attend le paiement, puis refuse avec PAYMENT_ALLOCATION_EXCEEDS_PAYMENT ; total **70** |

**52/113 avant → 113/113 après**. Les 61 scénarios rouges ne sont pas 61 vulnérabilités :
54 DML global, six cas GUC vide/espaces, une surallocation concurrente.
Le dépassement séquentiel et les allocations valides **40 + 40 = 80** fonctionnaient
déjà. Les accès étrangers ordinaires et les CRUD propres sont des non-régressions.

## Migration additive 055

`055_rls_and_race_fixes.sql` occupe le numéro explicitement réservé à G2 (absent jusqu'ici).
**Aucun fichier de migration existant n'est modifié**, en particulier 001–052 et 053–061.
Sur une installation neuve : 055 s'exécute après 054, avant 056 ; sur une base ayant
001–061 hors 055 : elle est appliquée comme migration manquante, sans rejouer les autres.

- Trois tables partagées : policy ALL limitée à `organization_id=app_tenant_id()`
  pour visibilité d'écriture et WITH CHECK ; policy SELECT distincte conserve les
  lectures globales et du tenant. ENABLE/FORCE RLS et grants inchangés.
- Trois tables privacy de 029 : seules les expressions des policies existantes
  sont remplacées par le helper robuste, pour USING et WITH CHECK.
- Fonction `guard_payment_allocation` remplacée avec **FOR UPDATE sur payments**.
  Garde facture et rattachement du trigger de 023 conservés. Pas de nouveau trigger,
  grant ou fonction SECURITY DEFINER.

Les lectures globales ne sont **pas** fermées. Les helpers privilégiés worker/support
restent autorisés : test d'un flag global et d'un claim/finish de job global avec bail.
Ce lot ferme les **DML ordinaires**, pas toute possibilité d'administration globale :
les fonctions SECURITY DEFINER sont des capacités explicites du serveur, dont les
frontières HTTP/autorités restent à revoir séparément. Il ne protège pas d'un acteur
possédant les identifiants de la base et capable de changer lui-même son tenant.

## Matrice et migration sans purge

- **96 cas** : 3 tables × 4 contextes (A, B, non défini, vide) × 8 actions.
  Les mutations de ces tests sont exercées puis nettoyées par ROLLBACK : pas de
  publication de flags/jobs synthétiques. Le refus est constaté dans PostgreSQL,
  pas déduit de l'absence de différence après le rollback de nettoyage.
- **12 cas privacy** : tenant correct, étranger, connexion réutilisée après COMMIT,
  espaces ; trois tables contenant de vraies fixtures.
- **3 cas allocations** : deux courses (70/40), un contrôle séquentiel. Deux vraies
  transactions ; observer la fin de la seconde ou son attente via pg_blocking_pids,
  puis COMMIT de la première. Les totaux finaux sont relus par l'administrateur.
- **2 cas helpers privilégiés** : administration de flag et claim/finish global conservés.

Rejeu final : migration 055 temporairement exclue sur base fraîche → **52/113** ;
restauration → migration **en place**, `--check`, second appel idempotent ; snapshots
de sept tables de données identiques avant/après (flags, jobs, outbox, trois tables
privacy et allocations). Puis reset/migrate/seed frais → **113/113**.
Cela prouve aussi qu'une ancienne allocation erronée n'est **pas purgée ou réparée**
silencieusement. Aucun déploiement ou nettoyage de données client réalisé.

```sh
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
npm run test:unit
npm audit --omit=dev
# DESTRUCTIF : base *_test synthétique seulement.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_TEST> node scripts/test-production-roles.mjs
```

Pour le ciblé : bootstrap puis `node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`,
puis `PRODUCTION_ROLE_TESTS=1 node tests/tenant-isolation/phase44-rls-integrity.pg.test.mjs`,
avec URLs admin/migrateur/application distinctes. Pas de reset pendant une autre batterie.

Ciblé **113/113**, typecheck/build, lint zéro avertissement, **27/27 unitaires**, audit
production **0 vulnérabilité** et garde de budget des notices verts. Runner **47 suites**,
seuil 113 ; G1/G2 regroupés dans `G security passed` avec leurs compteurs réels, détails
en stdout, pour éviter le plafond d'annotations. Batterie complète/CI à confirmer en PR #44.

## Limites et rollback

- Pas de qualification de toutes les fonctions privilégiées ou des changements de rôles
  JWT ; autres frontières G auth, DPIA/G3, projections/privacy et H restent ouvertes.
- Le trigger reste celui des **INSERT** de 023. UPDATE/DELETE d'allocations, cohérence
  composite de toutes les références financières, réconciliation des anciens totaux,
  autres ordres de verrous et isolation transactionnelle autre que READ COMMITTED
  ne sont pas qualifiés par ce test. Ne pas annoncer l'intégrité financière complète.
- De nouveaux verrous peuvent conduire à l'attente ou au rollback/retry d'une transaction.
  Pas de garantie d'absence de deadlocks sur tous les workflows financiers.
- Données historiques inchangées ; avant un futur déploiement sur données existantes,
  inventorier les anomalies et définir leur correction comptable autorisée.
- Migration de sécurité conservée en cas de rollback applicatif ; les chemins légitimes
  restent compatibles. En cas d'incident, suspendre les écritures concernées, conserver
  les preuves puis livrer une correction additive. Ne pas rétablir les policies globales
  permissives ni supprimer une migration déjà appliquée pour contourner les refus.
- Décisions paie/numérotation toujours ouvertes ; aucun changement métier implicite,
  aucune aptitude production. Workflows, SDK et lockfile inchangés.
