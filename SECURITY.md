# Sécurité — posture (mise à jour 2026-08-02)

## Posture

- **Isolation multi-tenant** : RLS PostgreSQL `USING` + `WITH CHECK` sur toutes
  les tables tenant, rôle applicatif `NOBYPASSRLS` (`creche_app`), helper
  `app_tenant_id()` (safe-by-default). Vérifié par les suites
  `tests/tenant-isolation/*` sur PostgreSQL réel (15 suites vertes).
- **Secrets** : exclusivement via variables d'environnement (`.env.prod.example`) ;
  aucun token ni secret journalisé ; audit PII masqué (`[REDACTED]`) ; le lien
  d'invitation (qui contient le jeton) n'est plus journalisé en mode dev.
- **OTP** : codes générés par `crypto.randomInt` (Math.random retiré — détecté
  par analyse statique locale).
- **Uploads** : URLs signées S3/MinIO courtes (1 h), consentements photo
  re-vérifiés à chaque URL, accès journalisés.
- **Webhook** : signature HMAC-SHA256 sur le corps brut, idempotence par
  `external_reference`.
- **Erreurs** : `AppError` FR/AR, jamais de SQL brut ni d'anglais exposé.

## Dépendances — `npm audit --omit=dev` : **0 vulnérabilité** ✅

Corrections appliquées le 2026-08-02 (migration de durcissement) :

| Paquet | Avant | Après |
|---|---|---|
| @nestjs/{core,common,platform-express,cli,jwt,passport} | 10.x (advisories moderate/high) | **11.1.x** (advisories corrigées) |
| @nestjs/config | 4.0.4 | 4.0.4 (inchangé, déjà sûr) |
| nodemailer | 9.0.3 | 9.0.3 (déjà sûr) |
| lodash (transitif) | override 4.18.1 | override conservé |
| react-router / react-router-dom (admin-web) | 6.x (open redirect) | **react-router 8.3.0** + React 19 |
| xlsx (admin-web, import) | high prototype pollution, SANS correctif | **remplacé par exceljs** (chunk lazy) |
| uuid (via gaxios/worker) | 9.0.1 | override **^11.1.1** |

Suites complètes rejouées sous NestJS 11 / React 19 : **14/14 vertes** +
phase12-messaging (7 cas).

## Analyse statique

- semgrep local (règles maison, hors ligne) : 5 résultats — 1 vrai bug corrigé
  (Math.random pour les OTP), 4 faux positifs documentés (logs sans secret).
- CodeQL : configuré dans `.github/workflows/ci.yml` (à exécuter en CI une fois
  la permission `workflows` accordée).

## Recommandations restantes

1. **Restaurer les workflows CI** (permission `workflows` de la GitHub App) :
   e2e Playwright, CodeQL et Docker en CI dépendent de cette permission.
2. **Gate de merge** : `npm audit --omit=dev --audit-level=high` doit rester à 0
   (vérifiable désormais sans exception).
3. Headers de sécurité, TLS et rate limiting : configurés dans
   `infrastructure/nginx/nginx.conf` (template, à déployer avec le VPS).
