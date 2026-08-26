# OPÉRATIONS — Gestion des secrets (MISSION P2)

> Conforme garde P1 `@creche/prod-config`. Aucun secret en clair dans ce fichier.

## 1. Inventaire des secrets

| Variable | Usage | Où elle est lue | Obligatoire en prod |
|---|---|---|---|
| `JWT_SECRET` | Signature jetons auth (access + refresh) | `apps/api/src/main.ts` via `ConfigService` | Oui (≥ 32 car., ≠ dev) |
| `JWT_REFRESH_SECRET` | Signature refresh tokens | `apps/api/src/main.ts` | Oui (≥ 32 car.) |
| `PAYMENT_WEBHOOK_SECRET` | Vérification HMAC webhooks SATIM | `apps/api/src/modules/payments/payments.controller.ts` | Oui (≥ 32 car.) |
| `SATIM_MERCHANT_ID` | Initiation paiement CIB/Edahabia | `apps/api/src/modules/payments/satim.service.ts` | Oui (les 3 ensemble) |
| `SATIM_SECRET` | Secret marchand SATIM | `apps/api/src/modules/payments/satim.service.ts` | Oui (les 3 ensemble) |
| `SATIM_GATEWAY_URL` | URL gateway SATIM | `apps/api/src/modules/payments/satim.service.ts` | Oui (les 3 ensemble) |
| `WHATSAPP_TOKEN` | API Graph Meta WhatsApp | `apps/api/src/modules/notifications/whatsapp.service.ts` | Si flag activé |
| `WHATSAPP_PHONE_ID` | ID téléphone WhatsApp Business | `apps/api/src/modules/notifications/whatsapp.service.ts` | Si flag activé |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account FCM | `apps/api/src/modules/notifications/fcm.service.ts` | Pour push Android |
| `APNS_KEY_ID` | Clé APNs Apple | `apps/api/src/modules/notifications/apns.service.ts` | Pour push iOS |
| `APNS_TEAM_ID` | Team ID Apple | `apps/api/src/modules/notifications/apns.service.ts` | Pour push iOS |
| `APNS_BUNDLE_ID` | Bundle ID iOS | `apps/api/src/modules/notifications/apns.service.ts` | Pour push iOS |
| `APNS_PRIVATE_KEY` | Clé privée APNs (PEM) | `apps/api/src/modules/notifications/apns.service.ts` | Pour push iOS |
| `SMTP_HOST` | Hôte SMTP (DPO / violations) | `apps/api/src/modules/privacy/privacy.service.ts` | Pour notifications ANPDP |
| `SMTP_PORT` | Port SMTP | `apps/api/src/modules/privacy/privacy.service.ts` | Pour notifications ANPDP |
| `SMTP_USER` | Utilisateur SMTP | `apps/api/src/modules/privacy/privacy.service.ts` | Pour notifications ANPDP |
| `SMTP_PASS` | Mot de passe SMTP | `apps/api/src/modules/privacy/privacy.service.ts` | Pour notifications ANPDP |
| `SMTP_FROM` | Expéditeur emails | `apps/api/src/modules/privacy/privacy.service.ts` | Pour notifications ANPDP |
| `SMTP_TO` | Destinataire emails DPO | `apps/api/src/modules/privacy/privacy.service.ts` | Pour notifications ANPDP |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | Stockage objets (MinIO / S3) | `apps/api/src/modules/media/media.service.ts` | Oui si STORAGE_BACKEND=s3 |
| `BACKUP_PASSPHRASE` | Chiffrement sauvegardes GPG | `scripts/backup.sh` | Oui (AES256 symétrique) |

## 2. Provisionnement

### Génération
```bash
# JWT + webhook (≥ 32 octets)
openssl rand -hex 32

# Exemple :
export JWT_SECRET=$(openssl rand -hex 32)
export PAYMENT_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

### Stockage
- **Vault ANPDP** : `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `BACKUP_PASSPHRASE`,
  `SATIM_*`, `WHATSAPP_*`, `FIREBASE_SERVICE_ACCOUNT_JSON`, `APNS_*`, `SMTP_*`.
- **Jamais** dans le repo, jamais dans les logs, jamais dans les issues GitHub.
- `.env.prod` est **gitignoré** (voir `.gitignore`).

## 3. Validation au bootstrap

La garde `@creche/prod-config` (`packages/prod-config/src/index.ts`) est exécutée
au démarrage de l'API et du worker **UNIQUEMENT** quand `NODE_ENV=production` :

```bash
NODE_ENV=production node -e "require('./packages/prod-config/dist').assertProductionConfig()"
```

Refuse le démarrage si :
- `PAYMENT_WEBHOOK_SECRET` absent ou < 32 car. ;
- `JWT_SECRET` absent, < 32 car., ou égal au défaut de développement ;
- `STORAGE_BACKEND=s3` avec les défauts MinIO ;
- `STORAGE_BACKEND=local` avec le répertoire par défaut `/tmp/creche-pdf` ;
- Configuration SATIM partielle (1 ou 2 variables sur 3).

## 4. Rotation

| Secret | Fréquence | Procédure |
|---|---|---|
| `JWT_SECRET` | Annuelle ou fuite | Générer nouveau → redéployer API + worker → invalider tous les jetons actifs |
| `PAYMENT_WEBHOOK_SECRET` | Annuelle ou fuite | Mettre à jour SATIM + redéployer |
| `SATIM_SECRET` | Sur demande SATIM | Coordonner avec la banque / gateway |
| `SMTP_PASS` | Semestrielle | Via panel du provider SMTP |
| `BACKUP_PASSPHRASE` | Annuelle | Régénérer → re-chiffrer les backups existants (script prévu) |

## 5. Audit

- `npm audit --omit=dev` en CI (dépendances).
- Semgrep local pour les fuites de secrets (`git grep -i "password\|secret\|token"`).
- Vérification manuelle avant chaque release : `grep -r "CHANGE_ME" .env.prod`.

## 6. Incident

Si un secret est exposé (log, repo, screen) :
1. **Révoquer immédiatement** le secret compromis.
2. **Générer** un nouveau secret.
3. **Redéployer** les services concernés.
4. **Notifier** le DPO si des données personnelles sont concernées (loi 25-11).
