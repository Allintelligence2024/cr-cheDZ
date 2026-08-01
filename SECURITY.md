# Sécurité — posture et vulnérabilités résiduelles (Phase 11)

## Posture

- **Isolation multi-tenant** : RLS PostgreSQL `USING` + `WITH CHECK` sur toutes
  les tables tenant, rôle applicatif `NOBYPASSRLS` (`creche_app`), helper
  `app_tenant_id()` (safe-by-default). Vérifié par les suites
  `tests/tenant-isolation/*` sur PostgreSQL réel.
- **Secrets** : exclusivement via variables d'environnement ; aucun token ni
  secret journalisé (FCM/APNs/SMS) ; audit PII masqué (`[REDACTED]`).
- **Uploads** : URLs signées S3/MinIO courtes (1 h), consentements photo
  re-vérifiés à chaque URL, accès journalisés.
- **Webhook** : signature HMAC-SHA256 sur le corps brut, idempotence par
  `external_reference`.
- **Erreurs** : `AppError` FR/AR, jamais de SQL brut ni d'anglais exposé.

## Vulnérabilités résiduelles (npm audit — statut au 2026-08-01)

`npm audit` signale des vulnérabilités **moderate/high** dont le correctif
exige une migration cassante vers NestJS 11. **Aucune n'est exploitable dans
la configuration actuelle** (évalué cas par cas ci-dessous). Plan : migration
NestJS 11 dédiée après le MVP (PR séparée, suites complètes rejouées).

| Paquet | Sévérité | Correctif | Exploitabilité actuelle | Plan |
|---|---|---|---|---|
| `@nestjs/core` / `@nestjs/platform-express` (≤10.4.x) | moderate | NestJS 11 (cassant) | Injection via sortie non neutralisée (templates) — non utilisé | NestJS 11 post-MVP |
| `body-parser` (via express) | low/moderate | 1.20.6 (override bloqué par npm) | DoS si `limit` invalide — limit par défaut valide ('100kb') | NestJS 11 (express 5) |
| `multer` (via platform-express) | high | NestJS 11 | **Upload non utilisé** : les médias passent par URLs signées S3 directes | NestJS 11 |
| `file-type` (via @nestjs/common) | moderate | non cassant (audit fix) | Parser ASF/ZIP — upload non utilisé | `npm audit fix` au prochain install |
| `lodash` (transitif @nestjs/config) | high | @nestjs/config ≥4.0.4 **appliqué** | — | — |
| `glob` (via @nestjs/cli, **dev**) | high | CLI 11 (cassant) | Dev uniquement, jamais en production | CLI 11 avec NestJS 11 |
| `react-router-dom` (admin-web) | high→moderate | audit fix **appliqué** | — | — |

**Recommandation** : planifier la migration NestJS 11 + express 5 (avec
`@nestjs/config` 4 déjà en place) avant la mise en production, puis exiger
`npm audit --omit=dev` à 0 high/critical en CI (gate de merge).

## Règles CI (à activer avec .github/workflows)

- `npm audit --omit=dev` : gate sur 0 high/critical (une fois NestJS 11 migré).
- CodeQL / Semgrep : analyse statique sur chaque PR.
- Dependabot : mises à jour automatiques des dépendances.
- Tests d'isolation : base PostgreSQL fraîche (migrations + seeds + suites
  phase3 → phase11).
