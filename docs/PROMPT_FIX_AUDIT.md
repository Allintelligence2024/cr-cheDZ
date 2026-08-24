# PROMPT_FIX_AUDIT — spécification de correction (trace historique)

> NOTE 2026-08-23 : la première session de correction avait produit 7 fichiers
> modifiés + 1 workflow CI, mais `npm ci` avait expiré : AUCUNE exécution
> (ni typecheck, ni tests), et son environnement (jamais poussé) a été PERDU.
> Les correctifs ont été RÉAPPLIQUÉS à l'identique selon la spécification
> ci-dessous, puis EXÉCUTÉS et PROUVÉS (mutation, 25/25 suites) par la
> session du 2026-08-23 — voir docs/HANDOFF.md § « Audit externe ».
> Ne pas modifier : trace historique.

## Spécification des correctifs (reprise de la session perdue)

a) `billing/payment-provider.service.ts` — chemin SUCCÈS d'init : l'UPDATE
   `payments SET gateway_response=…` passe par `TenantContextService.
   withTenantConnection` (comme le chemin erreur ~l.123-130) + assertion
   `rowCount !== 1` → AppError 500 `PAYMENT_STATE_ERROR` FR/AR (jamais
   0 ligne silencieux).
b) `video/dto/video.dto.ts` — `storage_key` regex `^(?!.*\.\.)[\w\-./]{1,200}$`
   (rejette tout `..`).
c) `video.service.ts` — politique SERVEUR : la clé doit commencer par
   `${tenantId}/video/` et sans `..` ; `storage_backend` dérivé UNIQUEMENT
   de STORAGE_BACKEND serveur (champ DTO conservé mais @deprecated, pour ne
   pas casser forbidNonWhitelisted) ; refus de `local` si
   NODE_ENV=production.
d) `resolve()` + `startsWith(root+sep)` avant tout accès fichier :
   `video.service.streamContent`, `exports.service.download` (~70-74),
   worker `pdf.ts` `localPath()` utilisé par `storeFile` ET `deleteFile`
   (couvre la purge vidéo).
e) `auth.service.ts` — commentaire « anti-énumération » corrigé (réalité =
   message unifié ; `recordFailedAttempt(null, ·)` est un no-op) ; login
   `status='pending'` documenté comme choix produit.
f) `health.service.ts` : 7 `dto: any` → types de `./dto/health.dto` ;
   `worker/exports.ts` : `(wb as any).xlsx` → `wb.xlsx.writeBuffer()`.
g) `.github/workflows/ci.yml` : **postgres:18** (PAS 16 — toute la
   validation projet tourne sur PG 18, embedded-postgres 18.4.0-beta.17) ;
   steps : npm ci, typecheck, migrate + --status, seeds, schema-check,
   rls-behavior-check, build api+worker, suites `*.api.test.mjs`.
   NE PAS pousser (permission `workflows` manquante — docs/CI-RESTORE.md).

## Suite de régression exigée

`tests/tenant-isolation/phase22-audit-fixes.api.test.mjs` : init succès
persistée (relecture SQL) ; rowCount=0 → PAYMENT_STATE_ERROR explicite ;
clés hostiles (`..`, absolu, backslash) → 422 avant tout accès disque,
bilingue FR/AR ; cross-tenant (`exports/<tenantB>/…`) refusé, aucun octet
lu ; storage_backend client ignoré / local interdit en production (spawn
env dédiée) ; CHECK DB migration 049. Prouver chaque test PAR MUTATION.

## Durcissements complémentaires

- Migration **049** : CHECK sur `video_clips.storage_key` (et
  media_assets/staff_documents/report_exports) rejetant `..` et chemins
  absolus — cohérent avec la regex DTO ; jamais modifier 001-048.
- Codes d'erreur nouveaux (`PAYMENT_STATE_ERROR`, `PATH_TRAVERSAL`,
  `STORAGE_POLICY`…) via AppError FR/AR.
- Garde anti-bypass RLS globale (`scripts/check-rls-usage.mjs`) : tout
  `pool.query` brut doit viser une fonction SECURITY DEFINER whitelistée ou
  une table système justifiée, sinon ÉCHEC. Intégrée à la CI/au runner.
- schema-check : FORCE ROW LEVEL SECURITY + présence de policy + ancrage
  tenant vérifiés sur chaque table tenant.
- Lint : eslint flat config réel (typescript, no-explicit-any en warn).
- Tests unitaires jest `payment-provider.service` (pool mockée) : succès
  persiste, rowCount=0 → 500, échec passerelle → failed.
- HORS PÉRIMÈTRE (PAS FAIRE) : Flutter, push workflows, e2e Playwright/k6,
  identifiants réels SATIM/WhatsApp/FCM/APNs/SMTP/Twilio, pilote terrain,
  écran admin-web violations/DPIA, flux vidéo live.
