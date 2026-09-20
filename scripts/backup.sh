#!/usr/bin/env bash
# ============================================================================
# Sauvegarde PostgreSQL chiffrée (Phase 11) + rétention 7 jours.
#
# Usage :
#   DATABASE_URL="postgres://user:pass@host:5432/creche" \
#   BACKUP_DIR=/var/backups/creche BACKUP_PASSPHRASE="secret" \
#   ./scripts/backup.sh
#
# Produit : $BACKUP_DIR/daily/creche-YYYY-MM-DD.sql.gz.gpg
# Rétention : 7 sauvegardes quotidiennes (les plus anciennes sont supprimées).
# ============================================================================
set -euo pipefail

DATABASE_URL="${DATABASE_URL:?DATABASE_URL requis}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/creche}"
BACKUP_PASSPHRASE="${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE requis (clé symétrique GPG)}"
KEEP_DAYS="${KEEP_DAYS:-7}"

DAY_DIR="$BACKUP_DIR/daily"
mkdir -p "$DAY_DIR"
STAMP="$(date +%F)"
OUT="$DAY_DIR/creche-$STAMP.sql.gz.gpg"

echo "→ Sauvegarde $STAMP"

# PG_BIN : répertoire des binaires PostgreSQL à utiliser (défaut : PATH).
# Le drill de restauration (scripts/restore-drill.mjs) pointe ici les
# binaires embedded-postgres pour garantir pg_dump ≥ version du serveur.
PG_DUMP="${PG_BIN:+$PG_BIN/}pg_dump"

# pg_dump (format SQL compressé) puis chiffrement symétrique GPG (AES256).
"$PG_DUMP" "$DATABASE_URL" --no-owner --no-privileges \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase "$BACKUP_PASSPHRASE" \
        -o "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ Sauvegarde écrite : $OUT ($SIZE)"

# Intégrité : somme de contrôle à côté de l'archive.
( cd "$DAY_DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256" )
echo "✓ Empreinte SHA-256 : $OUT.sha256"

# Copie hors site (P0-2, audit continu 2026-09) : si BACKUP_OFFSITE_DIR est
# défini (montage rclone/s3fs/NFS vers un stockage distant), l'archive et son
# empreinte y sont copiées. Un incendie VPS ne doit jamais emporter à la fois
# la base ET ses sauvegardes.
if [[ -n "${BACKUP_OFFSITE_DIR:-}" ]]; then
  mkdir -p "$BACKUP_OFFSITE_DIR/daily"
  cp -f "$OUT" "$BACKUP_OFFSITE_DIR/daily/"
  cp -f "$OUT.sha256" "$BACKUP_OFFSITE_DIR/daily/"
  echo "✓ Copie hors site : $BACKUP_OFFSITE_DIR/daily/$(basename "$OUT")"
fi

# Rétention : suppression des plus anciennes que KEEP_DAYS.
find "$DAY_DIR" -name 'creche-*.sql.gz.gpg' -mtime "+$KEEP_DAYS" -delete
find "$DAY_DIR" -name 'creche-*.sql.gz.gpg.sha256' -mtime "+$KEEP_DAYS" -delete
echo "✓ Rétention appliquée (${KEEP_DAYS} j)"
if [[ -n "${BACKUP_OFFSITE_DIR:-}" ]]; then
  find "$BACKUP_OFFSITE_DIR/daily" -name 'creche-*.sql.gz.gpg' -mtime "+$KEEP_DAYS" -delete
  find "$BACKUP_OFFSITE_DIR/daily" -name 'creche-*.sql.gz.gpg.sha256' -mtime "+$KEEP_DAYS" -delete
fi

# Restauration (à exécuter manuellement en cas d'incident) :
#   gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" "$OUT" \
#     | gunzip | psql "$DATABASE_URL"
echo "Restauration : gpg --decrypt \"$OUT\" | gunzip | psql \$DATABASE_URL"
