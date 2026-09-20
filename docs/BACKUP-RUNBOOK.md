# BACKUP RUNBOOK — Restauration réelle (<30 min, staging)

> Une sauvegarde non restaurée n'est pas une sauvegarde. Ce runbook est l'exercice obligatoire avant pilote.

## Source

`scripts/backup.sh` :
```bash
DATABASE_URL="..." BACKUP_DIR=/var/backups/creche BACKUP_PASSPHRASE="..." ./scripts/backup.sh
# Produit : /var/backups/creche/daily/creche-YYYY-MM-DD.sql.gz.gpg (AES256 GPG, rétention 7j)
```

`docs/RUNBOOK.md §2` et §5 décrivent déjà la restauration, mais jamais exécutée en temps réel.

## Objectif de l'exercice

- Restaurer **en staging < 30 min** depuis la sauvegarde chiffrée la plus récente
- Vérifier cohérence schéma (`migrate.mjs --check`) + seeds + 28 suites isolation
- Documenter temps, taille, incidents

## Pré-requis VM clean (Ubuntu 22.04)

```bash
# 1. Dépendances
sudo apt update && sudo apt install -y postgresql-18 postgresql-client-18 gpg gzip nodejs npm
# Ou Docker : postgres:18 + node:22

# 2. Variables (vault, jamais en clair dans Git)
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/creche_restore"
export BACKUP_DIR="/var/backups/creche"
export BACKUP_PASSPHRASE="..." # depuis Vaultwarden / 1Password
export BACKUP_DIR=/tmp/restore-test # pour test local
```

## Procédure chronométrée

### T0 — Trouver sauvegarde
```bash
ls -lt $BACKUP_DIR/daily/ | head
BACKUP=$(ls -t $BACKUP_DIR/daily/creche-*.sql.gz.gpg | head -1)
echo $BACKUP
du -h $BACKUP
```

### T0+2min — Préparer base vide
```bash
# Option A : base locale
createdb creche_restore || psql -c "DROP DATABASE creche_restore; CREATE DATABASE creche_restore;"

# Option B : Docker
docker run -d --name pg-restore -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18
```

### T0+5min — Restaurer
```bash
# Déchiffrement + gunzip + psql (cf. RUNBOOK §2)
gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" "$BACKUP" | gunzip | psql "$DATABASE_URL"

# Vérif rapide
psql "$DATABASE_URL" -c "SELECT count(*) FROM organizations; SELECT max(created_at) FROM audit_logs;"
```

### T0+15min — Vérif schéma
```bash
cd /home/user/cr-cheDZ
DATABASE_URL="$DATABASE_URL" node scripts/migrate.mjs --check
# Doit dire : Schéma cohérent, 001→052, checksums OK, sinon drift
```

### T0+20min — Seeds + smoke
```bash
DATABASE_URL="$DATABASE_URL" node scripts/seed.mjs
# Smoke API avec config prod valide (garde P1)
NODE_ENV=production PAYMENT_WEBHOOK_SECRET=... JWT_SECRET=... STORAGE_BACKEND=local STORAGE_LOCAL_DIR=/tmp/restore-storage node apps/api/dist/main.js &
curl http://localhost:3000/api/v1/health
```

### T0+25min — Suites isolation (échantillon)
```bash
export RATE_LIMIT_DISABLED=1 NODE_ENV=test STORAGE_BACKEND=local STORAGE_LOCAL_DIR=/tmp/restore-storage PAYMENT_WEBHOOK_SECRET=phase8-test-secret
bash scripts/run-isolation-suites.sh | tail -n 30
# Attendu : 28/28 vertes
```

### T0+30min — Bilan
- [ ] Temps total < 30 min : ___ min
- [ ] Taille backup : ___ MB
- [ ] `migrate --check` vert
- [ ] 28/28 suites vertes
- [ ] Restauration documentée dans `docs/pilot/BILAN-PILOTE.md` § Exercice restauration

## Échecs connus

| Symptôme | Cause | Fix |
|---|---|---|
| `gpg: decryption failed` | mauvaise passphrase | Vérifier Vault |
| `psql: role does not exist` | dump avec owner | `pg_dump --no-owner --no-privileges` déjà fait par backup.sh, sinon `--no-owner` au restore |
| `migrate --check` drift | migration manquante | Appliquer `node scripts/migrate.mjs` |

## Automatisation mensuelle (cron)

```cron
0 3 * * * DATABASE_URL=... BACKUP_DIR=/var/backups/creche BACKUP_PASSPHRASE=... /home/user/cr-cheDZ/scripts/backup.sh >> /var/log/creche-backup.log 2>&1
0 4 1 * * /home/user/cr-cheDZ/docs/BACKUP-RUNBOOK.md # exercice mensuel 1er du mois
```

## Critère go/no-go pilote

- [ ] Exercice restore <30 min réalisé **2 fois** (dont 1 fois par une autre personne que l'auteur du backup)
- [ ] Temps consigné, logs conservés
