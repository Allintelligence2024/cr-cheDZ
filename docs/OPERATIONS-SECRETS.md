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
