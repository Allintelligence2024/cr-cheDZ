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
- Vérifier cohérence schéma (`migrate.mjs --check`) + seeds + suites d'isolation (`scripts/run-isolation-suites.sh`)
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
# Doit dire : Schéma cohérent, toutes migrations appliquées (001→NNN), checksums OK, sinon drift
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
# Attendu : toutes les suites du runner vertes (compte réel donné par le runner)
```

### T0+30min — Bilan
- [ ] Temps total < 30 min : ___ min
- [ ] Taille backup : ___ MB
- [ ] `migrate --check` vert
- [ ] Suites d'isolation vertes (`scripts/run-isolation-suites.sh`, sans échec)
- [ ] Restauration documentée dans `docs/pilot/BILAN-PILOTE.md` § Exercice restauration

## Échecs connus

| Symptôme | Cause | Fix |
|---|---|---|
| `gpg: decryption failed` | mauvaise passphrase | Vérifier Vault |
| `psql: role does not exist` | dump avec owner | `pg_dump --no-owner --no-privileges` déjà fait par backup.sh, sinon `--no-owner` au restore |
| `migrate --check` drift | migration manquante | Appliquer `node scripts/migrate.mjs` |

## Automatisation (cron VPS)

```cron
0 3 * * * DATABASE_URL=... BACKUP_DIR=/var/backups/creche BACKUP_PASSPHRASE=... BACKUP_OFFSITE_DIR=/mnt/offsite/creche /home/user/cr-cheDZ/scripts/backup.sh >> /var/log/creche-backup.log 2>&1
```

### Hors site (P0-2, audit continu 2026-09) — OBLIGATOIRE avant pilote

`BACKUP_OFFSITE_DIR` pointe vers un montage distant du VPS (l'archive et son
empreinte `.sha256` y sont copiées, rétention alignée) :

```bash
# Option recommandée : bucket S3/MinIO distant monté via rclone
rclone config create offsite s3 provider=Other access_key_id=... secret_access_key=... endpoint=...
mkdir -p /mnt/offsite && rclone mount offsite:creche-backups /mnt/offsite --daemon
# Alternative : montage NFS / snapshot objet du fournisseur VPS.
```

Règle : un incendie du VPS ne doit jamais emporter à la fois la base et ses
sauvegardes. Tester une fois : `rclone ls offsite:creche-backups/daily`.

## Drill automatique sauvegarde → restauration (P0-2)

`scripts/restore-drill.mjs` rejoue le cycle complet contre une base `*_test` :
backup.sh chiffré (+ copie hors site simulée) → sha256 → **preuve de
chiffrement** (mauvaise passphrase refusée) → restauration (pipeline exact
du runbook : gpg → gunzip → psql) dans une base dédiée
`restore_drill_target` → comparaison source/restauré (comptes de lignes des
tables majeures, politiques RLS, fonctions SECURITY DEFINER) → nettoyage.
Prérequis : gpg, gzip, pg_dump et psql (présents en CI et sur le VPS).

- **CI : job `backup-drill` sur CHAQUE push** (`.github/workflows/ci.yml`) —
  une régression du pipeline de sauvegarde casse la CI le jour même.
- Local :
  ```bash
  DATABASE_URL="postgres://postgres:postgres@localhost:54329/creche_test" \
  BACKUP_PASSPHRASE="..." node scripts/restore-drill.mjs
  ```

Ce drill remplace l'exercice manuel mensuel comme preuve de routine ;
l'exercice chronométré < 30 min ci-dessus reste requis **avant pilote**
(conditions réelles, VM propre, autre opérateur).

## Effacement 25-11 et sauvegardes

L'effacement d'une personne est réalisé par **anonymisation à chaud**
(`anonymize_child`, migration 067 — voir `PRIVACY_ERASURE_RUNBOOK.md`) : aucune
suppression physique n'existe par conception (FK `RESTRICT`). Les sauvegardes
prises **avant** une anonymisation contiennent donc encore les données : elles
disparaissent avec la rotation ci-dessus. Après toute **restauration**,
rejouer les anonymisations postérieures à la sauvegarde avant remise en ligne
(liste : `SELECT resource_id, occurred_at FROM audit_logs WHERE resource_type='child' AND action='delete' AND occurred_at > '<horodatage du dump>'`).

## Critère go/no-go pilote

- [ ] Job CI `backup-drill` vert sur la dernière release
- [ ] Copie hors site effective et vérifiée (`rclone ls` ou équivalent)
- [ ] Exercice restore <30 min réalisé **2 fois** (dont 1 fois par une autre personne que l'auteur du backup)
- [ ] Temps consigné, logs conservés
