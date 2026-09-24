# Sécurité — posture (mise à jour 2026-09-19, remédiation lot F)

## Posture

- **Isolation multi-tenant** : RLS PostgreSQL `USING` + `WITH CHECK` sur toutes
  les tables tenant, rôle applicatif `NOBYPASSRLS` (`creche_app`), helper
  `app_tenant_id()` (safe-by-default), filtres organisation explicites en
  défense en profondeur sur les lectures sensibles (billing, parents, santé,
  journal, sync — lot C, 2026-09). Vérifié par les suites
  `tests/tenant-isolation/*` (phase3 → phase54 + gardes contrat/schema/RLS)
  sur PostgreSQL réel, **rejouvées en CI avec les rôles de production**
  (Gate D — `scripts/test-production-roles.mjs`).
- **Rôles base de données** : bootstrap reproductible (`roles.sql` exécuté par
  le service `bootstrap-roles` des compose dev/staging/prod) — l'applicatif
  n'est JAMAIS superuser, le migrateur est séparé (`creche_migrator`).
- **Secrets** : exclusivement via variables d'environnement (`.env.prod.example`) ;
  aucun token ni secret journalisé ; audit PII masqué (`[REDACTED]`) ; le lien
  d'invitation (qui contient le jeton) n'est plus journalisé en mode dev ;
  `.env.prod` est un fichier local d'exploitation, non versionné.
- **JWT** : tokens d'accès (`purpose: 'access'`) seuls acceptés par le garde
  d'authentification ; secret d'invitation dérivé (HMAC) ; révocation globale
  immédiate par époque du principal (`users.token_epoch`) ; garde de boot
  refusant la production si `JWT_SECRET` est absent, trop court ou égal au
  défaut de développement.
- **OTP** : codes générés par `crypto.randomInt` (Math.random retiré — détecté
  par analyse statique locale).
- **Uploads** : URLs signées S3/MinIO courtes (1 h), consentements photo
  re-vérifiés à chaque URL, accès journalisés ; clés de stockage contrôlées
  côté DTO, côté service (`assertStorageKeyInTenant`) et en base
  (contrainte 049).
- **Webhook** : signature HMAC-SHA256 sur le corps brut, idempotence par
  `external_reference`.
- **Erreurs** : `AppError` FR/AR, jamais de SQL brut ni d'anglais exposé.
- **En-têtes de bord (2026-09-24, lot 1 du plan de réparation)** :
  `Content-Security-Policy` servie par nginx (`default-src 'self'`, `object-src 'none'`,
  `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `connect-src 'self'`).
  **Étape 1 sur 2** : `script-src` tolère encore `'unsafe-inline'` pour le bootstrap
  anti-FOUC et le chargement non bloquant de la police écrits dans `index.html` ; l'étape 2
  (extraction de ces deux inline → `script-src 'self'` strict) exige la vérification
  navigateur du job `e2e`. Vérifié par `tests/tenant-isolation/edge-headers-contract.test.mjs`.
- **Limitation de débit** : en production, `RATE_LIMIT_DISABLED=true|1` **bloque le démarrage**
  (`@creche/prod-config`) — le garde applicatif interprète ces valeurs comme une désactivation
  sans regarder `NODE_ENV`. Correspondance stricte avec la sémantique du garde, `false`/absent
  admis.
- **Gardiens exécutés en CI** : les gardes `.env.example`, manifest Android, inventaire des
  gardes de route et seuils de charge sont désormais lancés par le job `quality` (ils ne
  l'étaient par **aucun** workflow avant le 2026-09-24).

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

## Analyse statique

- semgrep local (règles maison, hors ligne) : 5 résultats — 1 vrai bug corrigé
  (Math.random pour les OTP), 4 faux positifs documentés (logs sans secret).
- **CodeQL : NON configuré.** Aucun job CodeQL n'existe dans les workflows
  (l'affirmation contraire présente ici avant le 2026-09-19 était fausse —
  corrigée par le lot F de remédiation). L'audit des dépendances est assuré
  par `npm audit` (job `security` de la CI à chaque push/PR + workflow
  hebdomadaire `security-audit` avec ouverture d'issue automatique).

## CI — état réel (2026-09-19)

Les workflows sont **commités et actifs** (`docs/CI-RESTORE.md` est historique) :

| Workflow | Contenu |
|---|---|
| `ci.yml` | `database` (PG18 : migrations, seeds, schema-check, garde RLS, suites d'isolation sous rôles de prod), `quality` (eslint + jest), `e2e` (Playwright contre l'API réelle), `admin-web`, `support-console`, `security` (npm audit) |
| `docker.yml` | Build (et push sur main) des images api/worker/admin-web/support-console |
| `flutter.yml` | `pub get` + `analyze` des deux apps mobiles — les apps n'ont encore JAMAIS été compilées (dette assumée, issue #8) |
| `security-audit.yml` | `npm audit --omit=dev` hebdomadaire, issue auto si vulnérabilité |

## Recommandations restantes

1. **Compiler réellement les apps Flutter** (issue #8) : c'est le dernier
   point bloquant la livraison mobile.
2. **Gate de merge** : `npm audit --omit=dev --audit-level=high` doit rester à 0.
3. Headers de sécurité, TLS et rate limiting : configurés dans
   `infrastructure/nginx/nginx.conf` (template, à déployer avec le VPS).
