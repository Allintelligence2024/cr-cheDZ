# Plan de remédiation — synthèse vérifiée des deux audits externes

**Date** : 2026-09-19 · **Base** : HEAD `785adba` (PR #45), 591 fichiers, 63 migrations.
**Méthode** : chaque bug des deux rapports a été re-vérifié fichier par fichier dans l'état
actuel du code. Seuls les défauts **confirmés au HEAD** entrent dans ce plan ; les items
réfutés ou déjà corrigés sont listés en §4 pour trace.

---

## 1. Résultat de la vérification des deux rapports

### Rapport 1 (« Rapport maître »)
Décrit un état **antérieur** du repo (~13/09, ~397 fichiers, 52 migrations). La plupart de
ses CRITICAL sont corrigés et verrouillés par tests (rôles prod, sync, purpose JWT, epoch,
garde super_admin, @Roles staff, préfixe tenant stockage, purge 30 j, anonymisation,
scheduler/reaper). Restent vrais aujourd'hui : parcours web (invitation, refresh 429,
téléchargements), e2e impossible à démarrer + absent de la CI, jest/lint hors CI, doc
périmée (SECURITY.md/CI-RESTORE/comptes de suites), URL défaut parent-mobile, apps Flutter
jamais compilées (dette assumée issue #8).

### Rapport 2 (« Liste des bugs B1–B4, M1–M32 »)
Qualité inégale : certains BLOCKERs sont **réfutés par l'architecture actuelle**, et des
fichiers listés comme « lus » n'existent pas au HEAD (`apps/worker/src/stripe.ts`,
`fcm.ts`, `health.ts`, `SECURITY_AUDIT.md`) ; plusieurs références de lignes sont fausses
(ex. `tenant-utils.ts` fait 13 lignes, pas 267). Items confirmés repris ci-dessous.

| Réf R2 | Verdict au HEAD | Motif |
|---|---|---|
| B1 getInvoice/getPayment sans filtre org | **Rétrogradé MEDIUM** | `invoices`/`invoice_lines`/`payments` sont FORCE RLS + politique tenant (010), requêtes sous `withTenantConnection` avec rôle NOBYPASSRLS ; reste de la défense en profondeur |
| B2 parents assertInvoicePermission/receiptDetail | **Rétrogradé LOW-MEDIUM** | Idem RLS + contrôle guardianship (`canReceiveInvoices`) ; nuance réelle : 403 au lieu de 404 (énumération) |
| B3 fallback DATABASE_URL silencieux | **LOW confirmé** | Défaut codé en dur subsiste, mais compose prod exige `DATABASE_URL:?` et `assertApplicationDatabaseRole` refuse superuser/bypassrls |
| B4 secret JWT par défaut | **Mitigé** | Garde de boot `@creche/prod-config` refuse la prod si `JWT_SECRET` absent/<32 car. / égal au défaut |
| B5 traversal exports | **Corrigé** | Préfixe tenant + `resolve` + containment + contrainte DB 049 (le rapport le dit lui-même) |
| M1/M2 triple client S3 | **VRAI** | `storage.service` / `pdf-storage.service` / `exports.service` / `video.service` dupliquent le client |
| M3 sync device sans ownership | **RÉFUTÉ** | `registered_by = $2` vérifié dans push **et** pull |
| M4 INSERT messages org NULL | **LOW** | Fail-closed : WITH CHECK RLS rejette `organization_id` NULL ; dans la même transaction |
| M5 ROLLBACK ignoré | **LOW** | Pattern volontaire (`.catch(() => undefined)`), à documenter |
| M6 next_org_sequence non atomique | **RÉFUTÉ** | Fonction SECURITY DEFINER, `UPDATE … RETURNING seq` atomique (017) |
| M7/M22 childOfTenant dépend de RLS | **LOW (design)** | RLS FORCE partout + schema-check ; filtre org explicite = durcissement |
| M8 super_admin bloqué par requireTenant | **VRAI (design)** | Tension réelle, à trancher/documenter |
| M9 invoicePdf sans existence fichier | **LOW-MEDIUM confirmé** | Garde DB (404 `PDF_NOT_READY`) mais `readFile` local → 500 si fichier absent |
| M10 period non validé | **RÉFUTÉ** | Regex DTO + `EXPORT_PERIOD_INVALID` côté service |
| M11 requireTenant sans existence org | **LOW** | RLS est le mécanisme d'exécution (by design) |
| M12 webhook rawBody fallback | **LOW** | Fail-closed : re-sérialisation ≠ corps brut → HMAC rejette |
| M14 test lockout non idempotent | **Mitigé** | Verrou borné dans le temps (15 min), compte seedé |
| M15 pilot-report ne vérifie que la présence | **PARTIELLEMENT VRAI** | schema-check/rls-behavior exécutés ; suites phase* seulement `existsSync` |
| M16/M17 journal fragilités | **LOW** | `visible_to_parents` privé forcé faux = comportement à documenter |
| M19 notifications guardian soft-deleted | **RÉFUTÉ** | `g.deleted_at IS NULL` filtré (ligne 39) |
| M20 dashboard `CURRENT_DATE` | **VRAI (mineur)** | Incohérent avec `NOW() AT TIME ZONE 'Africa/Algiers'` du même fichier |
| M25 vidéo buffer en mémoire | **VRAI (perf)** | `streamContent` retourne un Buffer complet |
| M27/M28 seed-pilot | **VRAI (démo)** | `Password123!` + dates irréalistes — script de démo à baliser |
| M29 schedule_type sans enum | **VRAI (mineur)** | `@IsString` libre |
| M30 health.dto `any` | **RÉFUTÉ** | DTO entièrement validés (class-validator) |
| M31 media.dto storage_key sans regex | **PARTIELLEMENT VRAI** | Gardes serveur + contrainte DB 049 compensent ; harmoniser avec le DTO vidéo |

---

## 2. Plan de remédiation (ordre strict)

### Lot A — Parcours web cassés (1 j) — ✅ IMPLÉMENTÉ & VÉRIFIÉ (2026-09-19)

> Preuves : `npm run typecheck` (workspaces) OK, `npm run lint` OK,
> `npm run build --workspace @creche/admin-web` OK, login/refresh testés
> via le proxy Vite réel contre PG18 embarqué (jetons émis et renouvelés).


| # | Fichier | Correction | Vérification |
|---|---|---|---|
| A1 | `apps/admin-web/src/pages/AcceptInvitationPage.tsx` + `src/auth/AuthContext.tsx` | Supprimer `login('', '')` : exposer `refreshProfile()` dans AuthContext (ré-`GET /me` + `setUser`) et l'appeler après `setTokens`. L'utilisateur doit arriver sur le dashboard, pas sur /login | Spec e2e `accept-invitation` (à ajouter) + test manuel seed invitation |
| A2 | `apps/admin-web/src/api/client.ts` | Single-flight avec `try/finally` ; ne `clearTokens()` que sur 400/401 (`INVALID_REFRESH`/réutilisation), **jamais** sur 429/5xx (retry backoff) ; exposer le statut pour l'UI | Couvrir par un test unitaire (vitest ou jest admin-web) : 429 → tokens conservés |
| A3 | `apps/admin-web/src/pages/ExportsPage.tsx` | Télécharger via le client `api()` (retry refresh) ou demander une URL signée courte au serveur au lieu d'un `fetch` nu avec token localStorage | phase13-exports + e2e téléchargement après 15 min simulées |

### Lot B — CI : exécuter ce qui existe (0,5 j) — ✅ IMPLÉMENTÉ & VÉRIFIÉ (2026-09-19)

> Preuves : jest 6/6 suites · 45/45 tests (après fix `moduleNameMapper`
> `@creche/prod-config`) ; lint exit 0 ; `playwright --list` charge la
> config corrigée (3 tests) ; API + Vite démarrés avec les commandes exactes
> du `webServer` (health OK, login + refresh via proxy) ; suite phase6
> rejouée intégralement verte avec le worker sous `appUrl()`. Les specs
> navigateur elles-mêmes s'exécuteront pour la première fois dans le job
> `e2e` CI (aucun navigateur disponible dans l'environnement de dev actuel).


| # | Fichier | Correction |
|---|---|---|
| B1 | `.github/workflows/ci.yml` | Ajouter `npm run lint` (eslint --max-warnings=0) et `npm run test:unit` (jest API, 6 specs existent) au job `database` ou à un job `quality` dédié |
| B2 | `.github/workflows/ci.yml` + `apps/admin-web/playwright.config.ts` | Corriger le `webServer` : `cwd: '../..'` (racine) pour `node apps/api/dist/main.js`, ou chemin relatif corrigé ; ajouter un job `e2e` (migrate + seed + seed-e2e + playwright) — même non bloquant au début, pour un signal honnête |
| B3 | `tests/tenant-isolation/phase6.api.test.mjs` | Spawn worker avec `DATABASE_URL: appUrl()` (comme phase8/11/13/16/21/23/24/27/28) au lieu de l'URL admin capturée |

### Lot C — Défense en profondeur API (1–2 j)

| # | Fichier | Correction | Réf audit |
|---|---|---|---|
| C1 | `billing.service.ts` (`getInvoice`, `getPayment`, `recordCashPayment` lecture facture) | Ajouter `AND i.organization_id = $2` / `p.organization_id = $2` explicites (tenant depuis `requireTenant`) — double garde au-delà de la RLS | R2-B1 |
| C2 | `parents.service.ts` (`assertInvoicePermission`, `receiptDetail`) | Filtre org explicite **+** retourner 404 (et non 403) pour tout objet hors tenant afin d'empêcher l'énumération d'ids | R2-B2 |
| C3 | `messaging.service.ts` (`sendMessage`) | Résoudre `organization_id` par un `SELECT … FOR UPDATE` de la conversation dans la transaction, puis INSERT avec la valeur explicite (plus de sous-requête potentiellement NULL) | R2-M4 |
| C4 | `billing.service.ts` (`invoicePdf`) | `pdfStorage.exists(pdf_url)` avant `read` → 404 `PDF_NOT_READY` si absent ; idem pour tout chemin local des exports | R2-M9 |
| C5 | `dashboard.service.ts` (`documentsExpiring`) | Remplacer `CURRENT_DATE` par `(NOW() AT TIME ZONE 'Africa/Algiers')::date` (cohérence fuseau) | R2-M20 |
| C6 | `health.service.ts` / `journal.service.ts` (`childOfTenant`) | Ajouter `AND organization_id = $2` au filtre enfant (défense en profondeur, la RLS reste l'exécution) | R2-M7/M22 |
| C7 | `media.dto.ts` | `@Matches` path-safe sur `storage_key` aligné sur le DTO vidéo (la contrainte DB 049 et `assertStorageKeyInTenant` restent les gardes finales) | R2-M31 |
| C8 | `billing.dto.ts` | `schedule_type` : `@IsIn([...])` aligné sur la contrainte CHECK de table | R2-M29 |
| C9 | Décision à trancher (doc + code) | Comportement super_admin sans tenant sur les routes `requireTenant` : soit tenant explicite par header/query validé, soit erreur documentée `TENANT_REQUIRED` | R2-M8 |

### Lot D — Hygiène configuration & environnement (0,5 j)

| # | Fichier | Correction | Réf audit |
|---|---|---|---|
| D1 | `.env.prod` / `.gitignore` | `.env.prod` commité avec `POSTGRES_USER=creche_app` : soit le retirer du suivi Git (`git rm --cached` + entrée `.gitignore`), soit l'aligner sur `POSTGRES_USER=postgres` ; valeurs CHANGE_ME uniquement | R1-fait 1 (résidu) |
| D2 | `shared/database/database.provider.ts` | Si `NODE_ENV=production` et `DATABASE_URL` absent → erreur fatale au lieu du fallback dev ; garder le fallback uniquement hors prod | R2-B3 |
| D3 | `apps/parent-mobile/lib/main.dart` | URL par défaut : supprimer le défaut `http://10.0.2.2:3000` (exiger `--dart-define API_URL` au build release, ou défaut `https://api.creche.dz/api/v1` comme staff-mobile) | R1-fait 3 |
| D4 | `scripts/pilot/seed-pilot.mjs` | Mot de passe via variable d'env (`PILOT_PASSWORD`, défaut affiché dans le log de seed uniquement) + commentaire « données synthétiques » | R2-M27/M28 |

### Lot E — Dette qualité / perf (1 j, non bloquant)

| # | Fichier | Correction | Réf audit |
|---|---|---|---|
| E1 | `storage.service.ts` + `pdf-storage.service.ts` + `exports.service.ts` + `video.service.ts` | Factoriser un `StorageClientService` unique (config S3 résolue une fois via `@creche/prod-config`) | R2-M1/M2 |
| E2 | `video.service.ts` (`streamContent`) | Streaming (pipe S3 GetObject / `createReadStream` local) au lieu du Buffer complet | R2-M25 |
| E3 | `scripts/pilot/pilot-report.mjs` | Exécuter réellement les suites phase* (ou renommer la section « présence » et documenter) | R2-M15 |
| E4 | `journal.service.ts` | Documenter `visible_to_parents` forcé faux pour les notes privées (commentaire + contrat) | R2-M17 |

### Lot F — Documentation (0,5 j)

| # | Fichier | Correction | Réf audit |
|---|---|---|---|
| F1 | `SECURITY.md` | Supprimer la mention CodeQL (aucun job n'existe) **ou** ajouter le job ; mettre à jour les comptes de suites (runner actuel ≈ 61 entrées) et la date | R1-fait 9 |
| F2 | `docs/CI-RESTORE.md` | Bannière « historique — les workflows sont commités » ; contenu décrit un ci.yml avec CodeQL/e2e qui n'existe pas | R1-fait 9 |
| F3 | `packages/api-contracts/openapi.yaml` | En-tête : retirer « régénéré par le backend NestJS à chaque build » (contradiction avec l'état vérifié verrouillé par `openapi-contract.test.mjs`) ; ajouter cette phrase aux assertions du test | R1-fait 9 |
| F4 | `.github/workflows/ci.yml` (commentaire), `docs/BACKUP-RUNBOOK.md`, `docs/ANTIGRAVITY-MCP.md`, `docs/CURSOR-FINAL-MISSIONS.md` | Comptes périmés : « 001→049 » → 063 ; « 28/28 suites » → compter depuis le runner réel (ou référence générique) | R1-fait 9 |

### Lot G — Hors périmètre immédiat, à planifier

- **G1** : compilation réelle des apps Flutter (issue #8) — `flutter build apk` en CI ; c'est le
  dernier point qui maintient « capacité à livrer : non » pour les mobiles.
- **G2** : e2e Playwright étendus (invitation, téléchargement, refresh) une fois A1–A3 livrés.

---

## 3. Estimation consolidée

| Lot | Effort | Bloquant pour la prod ? |
|---|---|---|
| A — Parcours web | 1 j | Oui (utilisabilité) |
| B — CI lint/jest/e2e | 0,5 j | Oui (signal honnête) |
| C — Défense en profondeur API | 1–2 j | Recommandé avant données réelles |
| D — Hygiène config | 0,5 j | Oui (D1/D2) |
| E — Qualité/perf | 1 j | Non |
| F — Documentation | 0,5 j | Non (mais évite les faux signaux) |
| **Total** | **≈ 4,5–5,5 j** | |

## 4. Items des rapports ne nécessitant AUCUNE action (vérifiés faux ou déjà corrigés)

- R1 : rôles prod/RLS (corrigé), sync offline (réécrite + contrats), purpose JWT + epoch,
  garde super_admin users.service, @Roles staff, préfixe tenant stockage + contrainte 049,
  purge 30 j vidéo + scheduler + reaper, anonymize.sql étendu, seeds idempotents,
  copie racine dupliquée / SDK Flutter dans le workspace (absents au HEAD).
- R2 : B5 (corrigé), M3 (ownership device vérifiée), M6 (séquence atomique), M10 (regex DTO),
  M19 (guardians soft-deleted filtrés), M30 (DTO health validés).
- R2 fichiers inexistants cités comme lus : `worker/stripe.ts`, `worker/fcm.ts`,
  `worker/health.ts`, `SECURITY_AUDIT.md` — aucune action possible, signal de fiabilité
  du rapport à garder en tête pour les items restants.
