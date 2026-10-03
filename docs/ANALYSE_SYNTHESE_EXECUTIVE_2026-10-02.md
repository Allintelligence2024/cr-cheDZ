# Synthèse exécutive « Not safe to release » — vérification et correctifs

**Date de vérification** : 2026-10-02
**Périmètre audité** : `main` @ `0b70d71` — « Merge PR #52 feat director-mobile + analytics premium » (01/10/2026)
**Objet** : rejouer les **cinq défauts phares** annoncés par la troisième revue (résumé exécutif « Not safe to release »), trancher chacun sur preuve dans le code **réellement présent**, puis **corriger dans le dépôt** — pas de simples recommandations.
**Complément** : ce document s'ajoute à `VERIFICATION_RAPPORT_AUDIT_2026-10-02.md` (round 1) et `ANALYSE_REVUE_SECURITE_2026-10-02.md` (round 2), dont il partage la méthode (verdict par affirmation, preuve exécutable, zéro réécriture d'histoire).

## Verdict global

**La conclusion « Not safe to release » était fondée au commit audité.** Les cinq défauts phares sont réels, reproductibles et bloquants ; un sixième défaut annexe (job de sécurité `npm audit`) a été confirmé, ainsi que deux défaillances de garde-fous que la CI de `main` ne pouvait pas voir.

Tous ont été corrigés dans ce dépôt, avec un test de non-régression par correctif. Les gardiens rejouables localement sont verts (détail §7). Les modifications sont dans l'arbre de travail, non commitées à l'heure de rédaction.

| # | Défaut annoncé (synthèse) | Verdict | Correctif | Preuve de non-régression |
|---|---|---|---|---|
| D1 | Cloisonnement par salle contournable : une éducatrice lit/écrit les médias d'une autre salle | ✅ Confirmé | Garde d'aire sur lecture **et** écriture | `phase67` §5bis — 50 assertions ✓ |
| D2 | Cookie de refresh `__Host-` inutilisable en production (`Path` interdit par le préfixe) | ✅ Confirmé | `REFRESH_COOKIE_PATH = '/'` en prod | `phase64` cas 6 (sonde hors-process) — 27 assertions ✓ |
| D3 | L'écran Analytics échoue en 500 sur sa requête par défaut | ✅ Confirmé — 6 causes | 6 correctifs SQL/UI | `phase79` (nouvelle suite) — 21 assertions ✓ |
| D4 | Les images des compose ne correspondent pas à ce que la CI publie (pull impossible) | ✅ Confirmé | Namespace GHCR réel + `${VERSION:-latest}` | `production-compose-contract` — 22/22 ✓ |
| D5 | Le service `backup` peut échouer silencieusement (sauvegarde absente annoncée « OK ») | ✅ Confirmé | Entrypoint → `scripts/backup.sh` (`set -euo pipefail`) | Contrat compose (script monté, pas de pipe inline) ✓ |
| D6 | Job sécurité : `npm audit` échoue sur les dépendances de production | ✅ Confirmé | `multer` 2.4.0, `nodemailer` ^10.0.13 | `npm audit --omit=dev` → 0 vulnérabilité, exit 0 |

---

## D1 — Médias : le cloisonnement par salle ne valait que pour la liste

**Annoncé** : une éducatrice assignée à une seule salle peut lire et créer des médias pour des enfants d'une autre salle.

**Vérifié** : exact. Dans `media.service.ts` à `0b70d71`, le filtre `memberships.room_ids` n'existait que dans `list()`. `downloadUrl()`, `streamContent()`, `upload()` et `register()` ne contrôlaient que l'appartenance au tenant, et le contrôleur admet `educator`/`receptionist` sur ces routes. Connaître un `media_asset.id` suffisait donc à télécharger, streamer ou rattacher une photo hors de son aire.

**Corrigé** :
- `MEDIA_SEES_ALL_ROLES` (`director`, `super_admin`, `accountant`) et `MEDIA_PARENT_ROLES` explicites ;
- `staffScope()` (rôle + `memberships.room_ids`) et `assertMediaScope()` (perimetre par salle) ;
- sémantique volontairement asymétrique : **lecture** = au moins un enfant référencé dans l'aire, sinon **404** (pas de fuite d'existence) ; **écriture** = *tous* les enfants référencés (`child_id` + `children_in_photo`) dans l'aire, sinon **403 `MEDIA_OUT_OF_SCOPE`** ; document sans enfant accepté (il reste invisible à la liste des rôles restreints) ;
- rôles parent inchangés : leur chemin (`ParentsService` : filiation + consentement photo re-vérifiés) est plus strict, on ne le double pas.

**Preuve** : `tests/tenant-isolation/phase67-media-upload.api.test.mjs`, section `5bis` — deux salles A/B, un enfant chacune, une éducatrice `room_ids=[A]` : lecture B → 404 sans octets ; lecture A → 200 octets identiques ; écriture enfant B (directe et via `children_in_photo`) → 403 ; écriture A → 201 ; directrice inchangée. Suite complète : **50 assertions ✓** (rejouée après correctif).

## D2 — Cookie de refresh `__Host-` rejeté en production

**Annoncé** : en production, le refresh token n'est jamais stocké par le navigateur ; la session web tombe à la première rotation.

**Vérifié** : exact, et la cause est double. `REFRESH_COOKIE_NAME` vaut `__Host-creche_refresh` en production, mais le cookie était posé **et** effacé avec `path: '/api/v1/auth'`. Or le préfixe `__Host-` (RFC 6265bis §4.1.3) **exige** `Path=/` (en plus de `Secure` et de l'absence de `Domain`) : tout navigateur conforme rejette le cookie. Le même chemin devait aussi être utilisé à la suppression, sinon le cookie n'est jamais supprimé.

**Corrigé** : `REFRESH_COOKIE_PATH` centralisé (`'/'` en production, `'/api/v1/auth'` en dev, où le préfixe n'est pas utilisé), employé par `setRefreshCookie()` **et** `clearRefreshCookie()`.

**Preuve** : `tests/tenant-isolation/phase64-auth-cookies.api.test.mjs`, cas 6 — une sonde **hors-process** importe `apps/api/dist/shared/auth/auth-cookies.js` avec `NODE_ENV=production`, instrumente `res.cookie`/`res.clearCookie` et vérifie le nom `__Host-`, `Path=/` et `Secure` sur les deux appels. Suite : **27 assertions ✓**.

## D3 — Analytics : l'écran échouait en 500 sur sa requête par défaut

**Annoncé** : l'écran Analytics de la direction est inutilisable.

**Vérifié** : exact — six causes distinctes, toutes dans `analytics.service.ts` / `AnalyticsPage.tsx` :

1. **`attendanceTrend`** passait `[tenantId, null, trunc, fromDate, toDate]` alors que le SQL ne référence pas `$2` (« null fantôme »). PostgreSQL refuse la requête au parse : **`42P18 could not determine data type of parameter $2`** → 500 sur *toute* variante, à commencer par la requête par défaut de l'écran (`GET /analytics/attendance?groupBy=day`).
2. **`billingTrend`** filtrait `invoice_date`, colonne **inexistante** (migration 010 : la période comptable est `period_year`/`period_month`) → 500.
3. **`overview`** (KPI « facturation du mois ») filtrait la même colonne fantôme → 500, donc l'écran entier.
4. **`revenueTrend`** sommait `amount` alors que la colonne est `amount_allocated` ; le repli « table absente » était capturé **dans** une transaction déjà avortée (« current transaction is aborted ») ; la borne haute `BETWEEN … $3::date` excluait les encaissements du jour courant.
5. **`ratiosHistory`** lisait `compliance_checks.room_id` et `check_type`, colonnes **inexistantes** (migration 013) → 500.
6. **KPI incidents** : `incident_severity IN ('high','critical')` alors que les sévérités réellement écrites sont `minor|moderate|serious` (`journal.dto.ts`) → « critiques 7 j » toujours nul.

Côté UI, `AnalyticsPage` charge les cinq endpoints via un seul `Promise.all` : un seul 500 suffisait à blanchir tout l'écran (mode de défaillance aggravant, conservé mais désormais sans cause).

**Corrigé** : renumérotation des bindings **sans trou** ($1 org, $2 unité, $3/$4 bornes, $5 site) + verrou statique ; `make_date(period_year, period_month, 1)` pour `billingTrend` ; sonde `to_regclass('payment_allocations')` **avant** la requête + `SUM(amount_allocated)` + borne haute `< date + 1 jour` ; JOIN `compliance_rules.code='RATIO_EDUC'` + `details->>'room_id'` + `checked_at::date` ; KPI critiques sur `'serious'` ; typage `RevenueRow` ; suppression du doublon `(r as any).data ?? (r as any).data ?? []` dans `AnalyticsPage.tsx`.

**Preuve** : **nouvelle** suite `tests/tenant-isolation/phase79-analytics-director.api.test.mjs` (enregistrée dans `scripts/run-isolation-suites.sh`) : requête par défaut, variante sans paramètre, `week`/`month`, filtre `site_id`, les six endpoints (overview, attendance, billing, revenue, occupancy, ratios) → 200, refus 403 des rôles non-direction, et verrou statique anti-retour du « null fantôme ». **21 assertions ✓**.

## D4 — Compose : des images que la CI ne publie pas

**Annoncé** : le déploiement ne peut pas tirer les images applicatives.

**Vérifié** : exact. `.github/workflows/docker.yml` publie sur `ghcr.io/allintelligence2024/creche-saas-{api,worker,admin-web,support-console}` avec les tags `latest` et `sha-<sha>`. Les trois environnements pointaient pourtant vers `ghcr.io/creche-saas/*` (organisation inexistante), avec `${VERSION}` sans défaut ; `.env.prod.example` livrait `VERSION=staging` et le staging utilisait `:staging` — **deux tags qu'aucun workflow ne publie**. Le faux vert H1 (`scripts/test-staging-stack.mjs`) construisait lui-même ces tags localement, ce qui masquait le défaut.

**Corrigé** : `docker-compose.prod.yml` et `docker-compose.staging.yml` alignés sur le namespace réel avec `${VERSION:-latest}` ; `.env.prod.example` → `VERSION=latest` (avec la recommandation d'épingler `sha-<sha>`) ; `test-staging-stack.mjs` aligne le build local et l'interpolation compose ; `docs/RUNBOOK.md` corrigé.

**Preuve** : `tests/tenant-isolation/production-compose-contract.test.mjs` étendu (namespace GHCR, tag `${VERSION:-latest}`, image `migrate`, sauvegarde par script, `VERSION` prod ≠ `staging`) — **22/22 ✓**.

## D5 — Sauvegarde : l'échec était masqué par la pipeline

**Annoncé** : le conteneur de sauvegarde peut afficher un succès alors qu'aucune sauvegarde exploitable n'a été produite.

**Vérifié** : exact. L'entrypoint inline `pg_dump -h postgres … | gzip -9 | gpg …` n'avait ni `set -e` ni `pipefail` : le statut de la pipeline était celui de `gpg`, et l'`echo « écrit »` s'exécutait inconditionnellement. Un `pg_dump` en échec (droits, base absente, disque plein) donnait donc un conteneur « OK » avec un fichier absent ou partiel. Le script audité `scripts/backup.sh` (`set -euo pipefail`, correctifs déjà éprouvés par `restore-drill.mjs`) n'était pas utilisé par le compose.

**Corrigé** : le service monte `../../scripts:/app/scripts:ro`, installe `bash` (échec explicite sinon) et exécute `bash /app/scripts/backup.sh || exit 1` — la référence unique, la même que le drill de restauration.

**Preuve** : contrat compose — le service `backup` exécute le script, aucune pipeline inline, `set -euo pipefail` présent dans `scripts/backup.sh`. 22/22 ✓.

## D6 — Dépendances de production vulnérables (défaut annexe)

**Annoncé / vérifié** : le job de sécurité échoue sur `npm audit --omit=dev --audit-level=low`. Reproduit : `multer` 2.3.0 (transitif) et `nodemailer` ^9.1.1 étaient touchés.

**Corrigé** : override `multer` **2.4.0** ; `nodemailer` **^10.0.13** (`apps/api/package.json`), lockfile régénéré.

**Preuve** : `npm audit --omit=dev` → `found 0 vulnerabilities`, **exit 0**. Restent 2 vulnérabilités **dev-only** (esbuild/vite) : le correctif automatique passerait `vite@8.x` (cassant) — non appliqué, hors périmètre production, documenté ici.

---

## 6. Défauts annexes découverts pendant la vérification

| Défaut | État sur `0b70d71` | Correctif | Preuve |
|---|---|---|---|
| `npm run lint` (`eslint . --max-warnings=0`) : 1 erreur `no-useless-assignment` + 4 warnings `no-explicit-any` | 🔴 échec (gate `quality` de la CI) | Typage `RevenueRow`, suppression des casts `any` inutiles | `npm run lint` → **exit 0, 0 erreur, 0 warning** |
| Contrat de vérité documentaire (`claims-contract`) : compteurs faux | 🔴 2 échecs **préexistants** (`32` runbooks vs 33 ; `198` routes vs 204) + 1 introduit par l'ajout de `phase79` (74→75 entrées, `phase3 → phase78`) | `ci.yml` + 4 documents alignés sur le disque | `node --test tests/tenant-isolation/claims-contract.test.mjs` → **12/12 ✓** |

Le premier point compte : la CI de `main` était **rouge** sur le job `quality` (lint ET contrat de vérité), indépendamment des cinq défauts phares. Les deux échecs préexistants sont désormais fermés.

## 7. Vérifications finales exécutées (2026-10-02)

| Commande | Résultat |
|---|---|
| `npm run lint` (`eslint . --max-warnings=0`) | ✅ exit 0 — 0 erreur, 0 warning |
| `npm run typecheck` | ✅ 5/5 workspaces |
| `npm run build --workspace @creche/api` | ✅ build OK (dist utilisé par les suites) |
| `npm run test --workspace @creche/api` | ✅ 17 suites, **121/121 tests** |
| `bash scripts/run-isolation-suites.sh phase64` | ✅ **27 assertions** (cookies prod `__Host-`) |
| `bash scripts/run-isolation-suites.sh phase67` | ✅ **50 assertions** (dont §5bis cloisonnement salle) |
| `bash scripts/run-isolation-suites.sh phase79` | ✅ **21 assertions** (Analytics, nouvelle suite) |
| `node --test tests/tenant-isolation/production-compose-contract.test.mjs` | ✅ **22/22** |
| `node --test tests/tenant-isolation/claims-contract.test.mjs` | ✅ **12/12** |
| `npm audit --omit=dev` | ✅ 0 vulnérabilité, exit 0 |
| Gardiens CI : `check-guards-wired`, `check-env-example`, `check-e2e-skeletons`, `inventory-route-guards` | ✅ tous verts (14 gardiens câblés ; 204 routes inventoriées) |

## 8. Fichiers modifiés

- **Code** : `apps/api/src/modules/media/media.service.ts`, `apps/api/src/modules/analytics/analytics.service.ts`, `apps/api/src/shared/auth/auth-cookies.ts`, `apps/admin-web/src/pages/AnalyticsPage.tsx`
- **Déploiement** : `infrastructure/docker/docker-compose.prod.yml`, `docker-compose.staging.yml`, `.env.prod.example`, `scripts/test-staging-stack.mjs`, `docs/RUNBOOK.md`
- **Dépendances** : `package.json`, `apps/api/package.json`, `package-lock.json`
- **Tests** : `tests/tenant-isolation/phase64-auth-cookies.api.test.mjs`, `phase67-media-upload.api.test.mjs`, `production-compose-contract.test.mjs`, **nouveau** `phase79-analytics-director.api.test.mjs`, `scripts/run-isolation-suites.sh`
- **CI & documentation** : `.github/workflows/ci.yml`, `docs/VERIFICATION_ANALYSE_2026-09-24.md`, `docs/ANALYSE_PILIERS_MANQUANTS.md`, `docs/HANDOFF.md`, `docs/LOCAL-RUN.md`, `docs/PLAN_REPARATION_2026-09-24.md`

## 9. Limites et suites à donner

- **Docker/stack réelle non démarrés** dans ce bac à sable : la conformité GHCR/sauvegarde est verrouillée par test statique (22/22), pas par un `docker compose pull` observé.
- **CI GitHub non rejouée** (aucun push effectué) : les gardiens exécutables localement sont verts ; la batterie complète d'isolation reste à faire tourner sur le runner.
- **2 vulnérabilités dev-only** (esbuild/vite) subsistent, correctif majeur cassant.
- Les documents **datés** gardent leurs mesures historiques (règle du dépôt) ; seuls les marqueurs « état courant » et les affirmations vérifiées par le contrat ont été alignés.

## Conclusion

« Not safe to release » était exact au commit `0b70d71` : cinq causes bloquantes réelles (dont un écran entièrement inutilisable et une sauvegarde non fiable), plus un job de sécurité en échec et deux garde-fous rouges. Les six défauts sont corrigés dans le dépôt, chacun gardé par un test exécutable, et l'ensemble des vérifications rejouables localement est vert.

**Recommandation** : pousser ces correctifs, laisser la CI rejouer la batterie complète, et épingler `VERSION=sha-<sha>` au déploiement pour que l'image déployée soit celle qui a été scannée.
