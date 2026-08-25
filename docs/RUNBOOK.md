# RUNBOOK — Exploitation (Phase 11)

> Procédures opérationnelles : déploiement, restauration, incidents, montée de
> version. À compléter avec les accès réels (vault) et les alertes Grafana.

## 1. Déploiement

1. Migrations (expand) :
   ```bash
   DATABASE_URL="$DATABASE_URL_PROD" node scripts/migrate.mjs
   DATABASE_URL="$DATABASE_URL_PROD" node scripts/seed.mjs
   node scripts/migrate.mjs --check   # drift detection (dev == prod)
   ```
2. Build des images : `docker build` (workflow `.github/workflows/docker.yml`,
   images `ghcr.io/creche-saas/{api,worker,admin-web}`).
3. Déploiement des conteneurs (API + worker d'abord, puis admin-web).
4. Vérification : `GET /api/v1/health` → `{"status":"ok"}` ; `GET /api/v1/metrics`
   → contient `creche_jobs_pending`.

## 2. Restauration d'une sauvegarde (incident)

```bash
# Trouver la sauvegarde la plus récente
ls -lt /var/backups/creche/daily/

# Restaurer (base vide ou écrasée) — voir scripts/backup.sh
gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" "$BACKUP" \
  | gunzip | psql "$DATABASE_URL"
node scripts/migrate.mjs --check   # vérifier la cohérence du schéma
```

**Objectif** : restauration complète en staging < 30 minutes (exercice à
programmer mensuellement).

## 3. Incidents connus

| Symptôme | Cause probable | Action |
|---|---|---|
| `/api/v1/health` en erreur | API down / DB injoignable | `docker ps` ; `journalctl` ; vérifier `DATABASE_URL` |
| Jobs bloqués en `pending` | Worker arrêté / erreur | Consulter `GET /support/jobs` (console support) ; `POST /support/jobs/:id/retry` ; redémarrer le worker |
| Notifications jamais `sent` | FCM/APNs non configurés | Vérifier `failure_reason='PUSH_NOT_CONFIGURED_OR_NO_DEVICE'` ; configurer `FIREBASE_SERVICE_ACCOUNT_JSON` / `APNS_*` |
| OTP SMS indisponible | Twilio non configuré | Erreur `SMS_UNAVAILABLE` 503 ; configurer `TWILIO_*` |
| 409 CAPACITY_EXCEEDED | Capacité atteinte | Vérifier `organizations.max_children` (décret 19-253) |
| Latence fil du jour | Index manquant | `EXPLAIN ANALYZE` ; ajouter un index via migration numérotée |

## 4. Montée de version (expand/contract, zero-downtime)

1. **Expand** : appliquer les migrations additives (nouvelles colonnes/tables).
2. Déployer la nouvelle version de l'API (compatible ancienne + nouvelle).
3. **Contract** : dans une migration ultérieure, supprimer les éléments
   devenus inutiles.
4. Ne jamais modifier une migration appliquée (ADR-007) — toute évolution =
   migration suivante.

## 5. Sauvegardes

- Quotidien chiffré (AES256 GPG) : `scripts/backup.sh` (cron).
- Rétention : 7 jours locaux + copie hebdomadaire hors-site.
- MinIO/S3 : mirror du bucket `creche-media` (photos) sur un second stockage.
- Exercice de restauration : mensuel, chronométré (< 30 min en staging).

## 6. Conformité (loi 25-11)

- Violation de données : créer l'événement dans l'API (`POST /privacy/violations`),
  échéance ANPDP +5 jours automatique ; notifier via `POST /privacy/violations/:id/anpdp-notify`
  (SMTP configuré requis).
- Demandes de droits : export JSON via `POST /privacy/requests/:id/export`.
- Rétention : job `retention_purge` (5 ans) — `RETENTION_DAYS` (défaut 1825).
- Vidéosurveillance (DPIA 25-11) : planifier le job quotidien
  `video_clips_purge` (INSERT INTO background_jobs …, comme retention_purge)
  sur chaque org ayant le flag actif — purge stockage + lignes à 30 jours,
  échec explicite (VIDEO_PURGE_PARTIAL) si le stockage est injoignable.
- Paiements en ligne SATIM : planifier le job quotidien `payments_expire`
  (INSERT INTO background_jobs …, comme retention_purge — job GLOBAL,
  organization_id NULL) ; les pending SATIM de plus de 72 h passent en
  `failed` (gateway_response reason PENDING_EXPIRED_72H), aucune ligne
  supprimée (traçabilité compta), job idempotent. Un initiateur de paiement
  est TOUJOURS planifié — jamais de pending éternel.
- **Webhook tardif (MISSION P2)** : un paiement expiré (PENDING_EXPIRED_72H)
  ou supersédé (SUPERSEDED_BY_NEW_INIT) qui reçoit PUIS le webhook signé de
  son fournisseur est confirmé honnêtement (paiement 'confirmed', allocation
  créée, facture soldée — l'argent est réellement arrivé ; jamais de rejet
  silencieux). Le webhook du MAUVAIS paiement (supersédé, facture déjà
  soldée) → 422 INVOICE_IMMUTABLE (pas de double paiement). Si le MONTANT du
  webhook ≠ du montant du paiement → 422 PAYMENT_AMOUNT_MISMATCH explicite
  (jamais de « correction » silencieuse) : le paiement reste tel quel, un
  humain rapproche (support).
- Staging : toujours passer `scripts/anonymize.sql` après import d'un dump réel.

## 7. Surveillance

- `GET /api/v1/metrics` (Prometheus) : `http_requests_total`, `creche_jobs_pending`,
  `creche_notifications_pending`, `creche_invoices_unpaid`, `process_uptime_seconds`,
  et jauges pilote : `creche_children_active`, `creche_checkins_today`,
  `creche_sync_ops_24h`, `creche_jobs_failed_24h`, `creche_http_5xx_24h`.
- Alertes recommandées : erreur rate > 1 %, jobs en attente > 50, disque > 80 %,
  restauration non testée depuis > 30 j.

## 8. Suivi pilote (Phase 12)

1. Préparer l'environnement : `node scripts/migrate.mjs && node scripts/seed.mjs`,
   puis `node scripts/pilot/seed-pilot.mjs` (5 crèches de démonstration).
2. Vérifier la préparation : `node scripts/pilot/pilot-report.mjs --bench`
   (produit `docs/pilot/RAPPORT-PREPARATION.md` : checks, critères MVP, mesures).
3. Suivi quotidien : relever les jauges `/metrics` (checkins/jour, sync 24 h,
   jobs échoués 24 h, 5xx 24 h) — voir `docs/pilot/CHECKLIST_PILOTE.md`.
4. Incident pilote : ticket support → console support (recherche globale,
   jobs, impersonation) ; objectif résolution < 24 h (critère go/no-go).
5. Fin de pilote : bilan `docs/pilot/BILAN-PILOTE.md` + décision go/no-go ;
   les irritants acceptés rejoignent `docs/ROADMAP_V2.md`.
