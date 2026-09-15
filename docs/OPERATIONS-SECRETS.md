# OPERATIONS — Secrets réels + Garde P1

> La garde de config P1 (`@creche/prod-config`) refuse de démarrer si un secret est faible ou partiel. C'est voulu : elle vous dira immédiatement ce qui manque en prod.

## Garde P1 — Règles

`packages/prod-config/src/index.ts` :
- `PAYMENT_WEBHOOK_SECRET` ≥32 chars, présent
- `JWT_SECRET` ≥32, ≠ `dev_jwt_secret_change_in_prod_minimum_32_chars`
- `STORAGE_BACKEND=s3` → `S3_ACCESS_KEY`/`S3_SECRET_KEY` ≠ `minio_dev`/`minio_dev_password`
- `STORAGE_BACKEND=local` → `STORAGE_LOCAL_DIR` ≠ `/tmp/creche-pdf`
- SATIM : `SATIM_MERCHANT_ID` + `SATIM_SECRET` + `SATIM_GATEWAY_URL` → 3 ensemble ou 0, jamais partiel

Test :
```bash
NODE_ENV=production node apps/api/dist/main.js
# Si invalide → GARDE CONFIG PRODUCTION — démarrage REFUSÉ + liste variables
```

## PostgreSQL — séparation obligatoire (Phase D)

Sur installation neuve, générer **trois secrets distincts** (trois appels séparés
à `openssl rand -hex 32`) et les conserver dans le coffre opérateur :

| Secret / variable | Destinataire uniquement |
|---|---|
| `POSTGRES_PASSWORD` | PostgreSQL init `postgres` + `BOOTSTRAP_DATABASE_URL` du bootstrap |
| `MIGRATOR_DATABASE_PASSWORD` | bootstrap ; même secret encodé dans `MIGRATION_DATABASE_URL` de migrate/seed |
| `APP_DATABASE_PASSWORD` | bootstrap ; même secret encodé dans `DATABASE_URL` de l'API/worker et du contrôle de schéma |

Les URLs doivent désigner **la même base**. Utiliser les exemples de
`.env.prod.example` ; les mots de passe non hexadécimaux doivent être encodés dans
les URLs (pas dans les variables de mot de passe du bootstrap). Ne pas transmettre
les secrets bootstrap/migrateur aux environnements API/worker. Le rôle du
migrateur est NOSUPERUSER **BYPASSRLS**, secret réservé au déploiement.

Au boot production/staging, API et worker interrogent le catalogue et refusent
un rôle dangereux (`DATABASE_ROLE_UNSAFE`) avant écoute/claim. Ne jamais contourner
cette garde en changeant NODE_ENV. Le bootstrap refuse les propriétaires et
appartenances applicatives historiques : suivre le
[runbook Phase D](PHASE_D_ROLES_RUNBOOK.md), pas une rétrogradation improvisée.

Rotation : arrêter API/worker, changer les secrets dans le coffre et toutes les
URLs correspondantes, rejouer bootstrap puis migrate, recréer les conteneurs
applicatifs. Les sessions PostgreSQL déjà ouvertes ne sont pas invalidées par un
simple ALTER ROLE PASSWORD ; l'arrêt/recréation des pools est indispensable.

## Secrets à obtenir (ordre)

### 1. SATIM (paiement en ligne)

- Demander accès **sandbox** SATIM : merchant_id, secret, gateway_url sandbox
- `.env.prod` :
```
SATIM_MERCHANT_ID=...
SATIM_SECRET=...
SATIM_GATEWAY_URL=https://test.satim.dz/...
PAYMENT_WEBHOOK_SECRET=... # ≥32, HMAC webhook
```
- Test : init paiement pending → `payments_expire` job (72h) → webhook tardif → phase24
- Passage prod : gateway_url prod, nouveaux secrets, `PAYMENT_WEBHOOK_SECRET` rotaté

### 2. WhatsApp Business (notifications + OTP parent)

- Créer app Meta Developers, numéro Business, token permanent
```
WHATSAPP_TOKEN=...
WHATSAPP_PHONE_ID=...
WHATSAPP_API_URL=https://graph.facebook.com/v19.0 # défaut
```
- Flag `whatsapp_otp` (seed 014) → `POST /support/flags/whatsapp_otp`
- Test : sans flag → 422 `WHATSAPP_OTP_DISABLED`, sans config → 503 `WHATSAPP_NOT_CONFIGURED` (jamais de faux "envoyé")
- OTP : migration 045 `otp_codes.channel` = `sms` défaut, `whatsapp` si flag

### 3. FCM / APNs (push)

- FCM : `FIREBASE_SERVICE_ACCOUNT_JSON` (JSON service account, projet_id)
- APNs : `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_BUNDLE_ID`, `APNS_PRIVATE_KEY` (ES256, `\n` → `\\n`), `APNS_PRODUCTION=true/false`
- Test : `notification_queue` → worker `notif_queue_claim` → FCM HTTP v1 / APNs HTTP/2. Sans config → `PUSH_NOT_CONFIGURED_OR_NO_DEVICE` (inbox reste fiable)

### 4. SMTP ANPDP (violation 25-11)

- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `ANPDP_EMAIL`
- Test : `POST /privacy/violations` → `POST /privacy/violations/:id/anpdp-notify` (échéance +5j auto)

### 5. Invitations — transport non livré (G1c)

- Seul `NODE_ENV=development` avec `EMAIL_PROVIDER=none` autorise une simulation :
  token remis au client, aucune transmission et aucun token/ destinataire journalisé.
- `test`, `staging`, `production`, environnement absent ou fournisseur non implémenté :
  **503 INVITATION_DELIVERY_UNAVAILABLE avant toute écriture de domaine**.
- Le SMTP ANPDP ci-dessus est indépendant. `EMAIL_PROVIDER=smtp` ne branche pas un
  transport d'invitations ; ne pas annoncer « envoyé » ni utiliser development en
  production pour contourner ce refus. Livraison réelle à implémenter/qualifier avant
  déploiement. [Runbook G1c](PHASE_G1C_INVITATIONS_RUNBOOK.md).

## .env.prod.example → .env.prod

Copier `.env.prod.example` (documenté) → `.env.prod` (jamais commité) :
```bash
cp .env.prod.example .env.prod
# Remplir via Vault
# Tester garde :
NODE_ENV=production node -e "require('./packages/prod-config/dist').assertProductionConfig()"
```

## Rotation

- `JWT_SECRET` rotaté → tous les JWT invalides, users reconnectés
- `PAYMENT_WEBHOOK_SECRET` rotaté → webhooks SATIM échouent jusqu'à MAJ côté SATIM
- Documenter rotation dans RUNBOOK § Incidents

## Check prod avant go-live

- [ ] `assertProductionConfig()` verte
- [ ] `GET /api/v1/health` OK
- [ ] Job `payments_expire` planifié (GLOBAL, org NULL)
- [ ] Job `video_clips_purge` planifié par org (si flag vidéo actif)
- [ ] Backup restore <30 min testé (voir BACKUP-RUNBOOK.md)
