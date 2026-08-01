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

# pg_dump (format SQL compressé) puis chiffrement symétrique GPG (AES256).
pg_dump "$DATABASE_URL" --no-owner --no-privileges \
  | gzip -9 \
  | gpg --batch --yes --symmetric --cipher-algo AES256 \
        --passphrase "$BACKUP_PASSPHRASE" \
        -o "$OUT"

SIZE="$(du -h "$OUT" | cut -f1)"
echo "✓ Sauvegarde écrite : $OUT ($SIZE)"

# Rétention : suppression des plus anciennes que KEEP_DAYS.
find "$DAY_DIR" -name 'creche-*.sql.gz.gpg' -mtime "+$KEEP_DAYS" -delete
echo "✓ Rétention appliquée (${KEEP_DAYS} j)"

# Restauration (à exécuter manuellement en cas d'incident) :
#   gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" "$OUT" \
#     | gunzip | psql "$DATABASE_URL"
echo "Restauration : gpg --decrypt \"$OUT\" | gunzip | psql \$DATABASE_URL"
