# H2c — Portail parent : lien et état actuels

2026-09-14 · PR #44 · données synthétiques · aucun merge ni déploiement.

## Préflight

H2b est confirmé sur `7de167f8fc85d0a4d5bb02940f3944ecf3e3e9fd` :
[CI 34883591879](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34883591879),
**9/9 checks verts**, database **104108603013**. Notices vérifiées : H2b 50,
H2a 21, F2 51, F4 7 + PostgreSQL, H1 dev et staging. Ne pas réutiliser ce résultat
comme qualification du nouveau SHA H2c.

## Reproduction avant correction

`phase37-parent-revocation.api.test.mjs` a été exécuté avec l'API compilée H2b,
PostgreSQL réel et les rôles de production : **107/156 avant → 156/156 après**.
Les tokens ont été obtenus par HTTP avant les révocations en base ; ils sont
réutilisés pour exercer les contrôles du portail, sans simuler ces contrôles.

Les **49 échecs** avant correction se répartissent ainsi :

| État révoqué avant l'appel HTTP | Scénarios indûment autorisés |
|---|---:|
| Gardien supprimé logiquement | 13 |
| Enfant supprimé logiquement | 10 |
| Membership inactive | 13 |
| Utilisateur suspendu | 13 |

Les données de journal, de santé, de factures et de reçus étaient encore lues ;
le PDF local était servi, de nouvelles URLs photo étaient signées ; les demandes
d'absence et de consentement pouvaient encore produire une écriture métier.
Les écritures sont constatées par comptage PG avant/après, pas seulement par code HTTP.

**Faux positifs écartés :** après suppression de l'enfant, la liste enfants, la
santé et la déclaration d'absence étaient déjà protégées. Retrait physique du
lien, utilisateur non lié et autre tenant étaient déjà refusés. La révocation
des capacités journal/santé/factures était déjà effective sur les routes
correspondantes. Ces contrôles sont conservés comme non-régressions.

## Politique et périmètre

`apps/api/src/shared/authorization/guardian-access.ts` fournit le prédicat
`CURRENT_GUARDIAN_LINK_SQL`, appliqué aux requêtes du portail parent joignant
`child_guardians cg` et `guardians g` :

- lien présent et gardien dans la même organisation ;
- gardien et enfant non supprimés ; enfant du même tenant que le lien ;
- utilisateur actif et membership active dans ce tenant ;
- capacité requise ajoutée explicitement à chaque point d'utilisation.

Le SQL est une constante de code, exécutée avec la connexion applicative et
`SET LOCAL app.tenant_id`, sous RLS. Aucun SECURITY DEFINER, migration ou grant
ajouté. Les noms de permission du helper privé sont maintenant un type union
fermé, pas une chaîne arbitraire.

| Routes `/parent/*` | Droit conservé |
|---|---|
| `GET children` | Lien courant + can_view_journal, filtrage SQL |
| `GET children/:id/feed` | Lien courant + can_view_journal |
| `POST absence` | Lien courant + can_view_journal (règle existante, pas de changement métier) |
| `GET children/:id/consents`, `POST consents` | Lien courant ; ne dépend pas des droits journal/santé/factures |
| `GET children/:id/media`, `GET children/:id/media/:mediaId/download` | Lien courant + can_view_journal ; contrôles existants de visibilité et de consentement photo conservés |
| `GET invoices`, `GET receipts` | Lien courant + can_receive_invoices, filtrage SQL |
| `GET invoices/:id`, `GET invoices/:id/pdf`, `GET receipts/:id` | Lien courant + can_receive_invoices |
| `GET children/:id/health` | Lien courant + can_view_health |

Ce sont **13 routes** enfant. Elles restent self-service, sans restriction à un
rôle JWT parent particulier : le rôle seul ne remplace pas le lien ni ses droits.
Les listes refusées sont vides ; les détails/écritures refusés renvoient 403/404
selon le chemin existant, sans données ni écriture métier.

## Matrice de preuve

**12 états × 13 routes = 156 scénarios** : autorisé, gardien supprimé, enfant
supprimé, membership inactive, utilisateur suspendu, lien retiré, pair non lié,
autre tenant, journal révoqué, santé révoquée, factures révoquées, accès restauré.

- Tous les positifs vérifient une réponse non vide ou une écriture effective.
- Les contrôles de capacités vérifient aussi les domaines qui doivent rester
  accessibles : retirer la santé ne coupe pas les factures, par exemple.
- Le PDF est une fixture locale de contrôle d'accès, pas une qualification de
  génération/rendu PDF.
- Les URLs S3 sont réellement signées localement avec des clés synthétiques et
  une destination loopback ; aucun appel à un fournisseur de stockage.
- Aucun worker ou fournisseur de notification n'est lancé dans cette suite.
- Les fixtures ont des identifiants uniques ; pas de reset interne ni purge
  d'historique applicatif. Le répertoire temporaire de PDF est supprimé en fin de test.

## Validation et commandes

```sh
npm ci
npm run build
# DESTRUCTIF : base *_test dédiée et identités de test du runbook D.
# Le gate prépare la base fraîche : reset, migrations, seeds ; rôles livrés.
ALLOW_DATABASE_RESET=1 DATABASE_URL=<URL_ADMIN_BASE_JETABLE_TEST> \
  node scripts/test-production-roles.mjs
```

Pour le test ciblé, préparer explicitement une base fraîche avec
`node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs`,
puis exécuter `node tests/tenant-isolation/phase37-parent-revocation.api.test.mjs`
avec `DATABASE_URL` administrateur de fixture, `MIGRATION_DATABASE_URL`,
`APP_DATABASE_URL` et `PRODUCTION_ROLE_TESTS=1` (rôles bootstrapés auparavant).
Ne pas exécuter de reset concurrent avec une autre suite.

Local ciblé : **156/156**, typecheck/build tous workspaces, lint
`--max-warnings=0`, **27/27 unitaires**, audit production **0 vulnérabilité**.
Le runner existant comprend désormais **40 suites/contrôles** ; le gate exige
156 scénarios H2c et la notice `H2c parent access passed`. Aucun workflow modifié.
Batterie complète locale finale : **40/40 suites vertes**, notices H2a 21, H2b 50
et H2c 156 vérifiées. Le test final a également été rejoué sur l’ancien service
H2b : **107/156**, puis sur le correctif restauré : **156/156**. Résultats CI
du SHA publié à confirmer dans la PR #44.
Docker/Flutter ne sont pas disponibles localement ; leurs guards locaux ne
remplacent pas la qualification CI réelle.

## Rollback et limites

- Code seulement ; migrations 001–061, grants, lockfiles et SDK inchangés.
- En cas d'incident, suspendre les routes concernées, conserver les preuves,
  corriger et rejouer les gates. Ne pas rétablir un accès via un gardien supprimé
  pour rétablir le service ; aucune réactivation automatique de lien ou de compte.
- Les anciennes URLs signées ou copies déjà reçues ne sont pas rappelées par ce
  contrôle. Les contrôles précédant une lecture, signature ou écriture ne sont
  pas une sérialisation globale des révocations concurrentes en cours de requête.
  La preuve concerne des révocations terminées avant l'appel HTTP suivant.
- Ce lot ne révoque pas globalement les JWT/sessions : G reste ouvert. Les
  préférences de notification personnelles sans sujet enfant ne sont pas modifiées.
- Les projections de champs (notamment `i.*`/`p.*` dans les détails financiers),
  autres routes privacy, registre/DPIA/violations et snapshots historiques restent
  à revoir. Aucun champ n'est déclaré sûr par le seul contrôle d'accès H2c.
- Pas de purge de dossiers supprimés : seule leur exposition par ces routes du
  portail est bloquée. Les workflows internes de conservation/comptabilité ne
  sont pas modifiés ; cette règle n'est pas une décision juridique d'effacement.
- G/H3, maintien/CVE stockage, Android APK release et décisions paie restent ouverts.
  Aucun merge, déploiement ni aptitude à la production déclaré.


## Confirmation de livraison et suite H2d

H2c publié sur `5a6ece2b96d4aec20fdb6ea75bb138d1266623d7` :
[CI 34888169634](https://github.com/Allintelligence2024/cr-cheDZ/actions/runs/34888169634),
**9/9 checks**, database **104123879371**. Notices H2c 156, H2b 50, H2a 21,
F2 51, F4 7 + PG et H1 dev/staging vérifiées. Aucun merge ou déploiement.
La suite [H2d](PHASE_H2D_FINANCIAL_PROJECTION_RUNBOOK.md) minimise les quatre
réponses JSON financières parent ; les projections santé/journal/médias et G
restent à revoir.
