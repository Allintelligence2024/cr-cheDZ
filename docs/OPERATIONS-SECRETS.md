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
  token remis au client, aucune transmission et aucun token/destinataire dans la console du simulateur.
  Le resource_label e-mail de l’audit de création préexistant reste conservé.
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

### 6. Secret TOTP — portée G1d

- Préparation `/auth/2fa/enable` : secret retourné uniquement tant que le facteur est
  pending ; une fois activé, **409 TOTP_ALREADY_ENABLED** sans secret/URI. Désactivation
  exige un code valide et supprime le secret ; pas de récupération par simple GET/setup.
- Audit du changement atomique, booléens d'état seulement. Les échecs verify/disable
  et TOTP du login mot de passe comptent dans `MAX_LOGIN_ATTEMPTS` (5 par défaut),
  verrou `ACCOUNT_LOCK_MINUTES` (15). Limite HTTP supplémentaire 5/min/IP/route.
- **Le secret reste en clair dans PostgreSQL.** Aucun chiffrement/gestion des clés
  livré par G1d, aucune rotation des anciens secrets qui auraient été divulgués.
  Ne pas prétendre que tous les canaux PIN/OTP imposent désormais la MFA, ni que le
  code est à usage unique côté serveur. [Runbook et limites G1d](PHASE_G1D_TOTP_RUNBOOK.md).

### 7. Choix du stockage — H2i

- Les processus de production exigent `STORAGE_BACKEND=local` ou `s3` ; hors
  production, l'absence conserve s3. Une faute, valeur vide ou casse différente
  échoue au bootstrap au lieu de choisir un backend implicitement.
- Backend s3 sélectionné en production : credentials non vides/non blancs et
  non égaux aux défauts de développement. Local : `STORAGE_LOCAL_DIR` explicite,
  absolu et non équivalent au défaut `/tmp/creche-pdf`.
- Configuration identique pour API/worker ; volumes réellement partagés si local.
  Le service média/signature reste S3, même si les PDF sont locaux : **ne pas
  interpréter local comme une désactivation de S3 pour tous les médias**.
- [Reproduction, exploitation et limites H2i](PHASE_H2I_STORAGE_SELECTION_RUNBOOK.md).
  Pas de validation des credentials par un fournisseur réel, ni de migration d'objets.

### 8. Credential de collecte Prometheus — H2k

- `/api/v1/metrics` accepte le JWT d'accès administrateur plateforme (H2j) **ou** un
  credential de collecteur à privilège limité : un secret opaque de 32 octets dont
  l'API ne connaît **que le digest SHA-256** (`METRICS_COLLECTOR_TOKEN_HASHES`,
  liste séparée par virgules). Le token brut ne vit que dans le fichier lu par
  Prometheus (`authorization.credentials_file`, monté en lecture seule).
- Générer le couple, hors dépôt :
  `node scripts/provision-metrics-collector.mjs --out-file /etc/creche/secrets/metrics-collector-token`
  puis coller le digest imprimé dans `.env.prod`. Permissions 0600 (0400 + chown
  65534 comme le secret Alertmanager si le conteneur Prometheus tourne en nobody).
- **Rotation** : générer un nouveau couple → ajouter le nouveau digest à la liste
  (les deux coexistent pendant la bascule) → remplacer le fichier côté Prometheus →
  retirer l'ancien digest. **Révocation** : retirer le digest (et le fichier) ; un
  redéploiement suffit — aucun secret n'est encodé dans un JWT, aucune session
  utilisateur n'est créée, et la suppression n'ouvre rien : la voie admin reste.
- Liste **malformée** = entrée non-SHA-256 : démarrage refusé en production et
  chemin collecteur désactivé (fail-closed) ; liste absente = seul H2j.
  **Jamais** d'accès anonyme rétabli pour « réparer » un scraper.
- Le collecteur ouvre exactement le scrape : 401 sur toute autre route, réponse
  identique à celle de l'admin (mêmes agrégats globaux, jamais de PII ni de
  contenu tenant) — c'est une **fuite d'agrégats potentielle** si le fichier
  filtre : le traiter comme un secret d'infrastructure à durée non limitée.
- Preuves et limites : [runbook H2j/H2k](PHASE_H2J_METRICS_RUNBOOK.md) ; ingestion
  réelle qualifiée par le gate `scripts/test-metrics-collector-stack.mjs` (vrai
  Prometheus 2.53.0). La voie E2 (exporter SQL, sans API) reste distincte.

### 9. Clé de chiffrement des secrets TOTP — G5

- `TOTP_ENCRYPTION_KEY` protège **uniquement** `users.totp_secret` au repos
  (AES-256-GCM, AAD = identifiant utilisateur → un scellé arraché d'une ligne
  et collé sur une autre ne se déchiffre pas). Ce n'est ni le `JWT_SECRET`, ni
  l'`ENCRYPTION_KEY` métier existant ; ne jamais les réutiliser l'un pour l'autre.
- Format : 32 octets — hexadécimal 64 caractères (`openssl rand -hex 32`) ou
  base64/base64url. **Rotation** : liste `courante,ancienne` ; la première scelle,
  toutes déchiffrent ; chaque usage rescelle la ligne à la courante — une fois
  tous les comptes actifs passés (ou après le délai de rétention souhaité), on
  retire l'ancienne et seule la courante reste.
- Fail-closed : valeur scellée indéchiffrable (clé retirée trop tôt, octet
  altéré) ⇒ `403 MFA_SECRET_UNREADABLE`, aucune session, compteur de verrouillage
  de l'utilisateur non touché — c'est une erreur d'exploitation, pas une faute
  de l'utilisateur. **Ne jamais** « réparer » en repassant en mode clair ni en
  effaçant le secret de la victime.
- Production : absence de clé = **démarrage refusé** (garde `@creche/prod-config`).
  Clé présente mais malformée = refus dans tous les environnements. test/dev sans
  clé = mode historique explicite (clair en base) — l'anti-rejeu persistant des
  codes (`users.totp_last_step`, migration 063) s'applique de toute façon.
- Après un rollback applicatif pré-G5 : conserver la clé (les lignes déjà
  scellées restent illisibles sans elle) et ne pas supprimer la colonne 063.
- Preuves et limites : [runbook G5](PHASE_G5_MFA_RUNBOOK.md) ; suite `phase54`
  (18 scénarios HTTP+PG réels, rotation incluse). Les codes de récupération MFA
  relèvent d'une décision client explicite (non implémentés, non revendiqués).
