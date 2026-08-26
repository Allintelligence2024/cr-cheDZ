# RUNBOOK — Restauration sauvegarde PostgreSQL (backup.sh)

> Procédure de restauration chiffrée (Phase 11). À exécuter sur une **VM vierge**
> en cas d'incident (corruption / perte de la base). **Une sauvegarde non testée
> n'est pas une sauvegarde** : ce RUNBOOK doit être exécuté au moins une fois sur
> VM vierge et **chronométré AVANT** le pilote 5 crèches (P0 opérationnel).

## Prérequis (VM vierge)
- OS Linux (debian/ubuntu), accès root/sudo.
- `postgresql-client` (`psql`, `pg_dump`) et `gpg2` installés.
- Accès réseau à la base cible (`DATABASE_URL`).
- Secret `BACKUP_PASSPHRASE` (clé symétrique GPG) dispo dans le vault **jamais
  commité**.
- Le fichier `creche-YYYY-MM-DD.sql.gz.gpg` (local ou stockage distant monté).

## 1. Préparer l'environnement
```bash
export DATABASE_URL="postgres://user:pass@host:5432/creche"
export BACKUP_PASSPHRASE="***"   # depuis le vault, jamais en clair dans un fichier commité

# (re)créer la base si besoin :
psql "$DATABASE_URL" -c "DROP DATABASE IF EXISTS creche;"
psql "$DATABASE_URL" -c "CREATE DATABASE creche;"
```

## 2. Restaurer (1 commande)
```bash
gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" \
  creche-YYYY-MM-DD.sql.gz.gpg \
  | gunzip | psql "$DATABASE_URL"
```
(Équivalent à la ligne documentée en bas de `scripts/backup.sh`.)

## 3. Vérifier (critères d'acceptation)
- `psql "$DATABASE_URL" -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"` → > 0
- Migrations présentes : `node scripts/migrate.mjs --status` → 001→049 OK
- Garde RLS : `node tests/tenant-isolation/schema-check.mjs --verbose` → 61/61
- Jeu de référence retrouvé (ex. 1 crèche + 1 parent + 1 enfant).

## 4. Chronométrer
- Noter T0 (lancement) → T1 (prompt `psql` OK). Objectif : < 15 min pour une
  base < 1 Go. Si > 30 min, revoir taille de rétention / stockage / réseau.

## 5. Rollback / rejeu
- La restauration est idempotente côté fichier. Pour rejouer : DROP/CREATE la
  base puis refaire l'étape 2.

## Notes
- Chiffrement AES256 symétrique GPG. La passphrase est le **seul** secret ;
  la perdre = sauvegarde irrécupérable. La stocker dans le vault ANPDP.
- Rétention : 7 jours quotidiens (`KEEP_DAYS` dans `scripts/backup.sh`).
- Source : `scripts/backup.sh`.
- La **restauration** n'est pas encore exécutée sur VM vierge → à tester
  (voir issue "Restore backup.sh sur VM vierge — test chronométré (P0)").
