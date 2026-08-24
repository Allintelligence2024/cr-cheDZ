#!/usr/bin/env bash
# PREUVE PAR MUTATION (phase22) : pour chaque correctif, revient TEMPORAIREMENT
# à la version pré-correctif (git HEAD), rejoue phase22, constate les tests
# ROUGES, restaure le correctif et re-vérifie le VERT. Aucune affirmation de
# pertinence de test sans ce passage.
set -uo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL='postgres://postgres:postgres@localhost:54329/creche_test'
export RATE_LIMIT_DISABLED=1 NODE_ENV=test STORAGE_BACKEND=local
export STORAGE_LOCAL_DIR=/tmp/creche-storage-mutation PAYMENT_WEBHOOK_SECRET=phase8-test-secret
mkdir -p "$STORAGE_LOCAL_DIR" /tmp/mutation-backups

SUITE=tests/tenant-isolation/phase22-audit-fixes.api.test.mjs

run_suite () { # $1 = étiquette
  local log="/tmp/mutation-$1.log"
  if node "$SUITE" >"$log" 2>&1; then
    echo "  [$1] VERT (rc=0)"
  else
    echo "  [$1] ROUGE (rc=1) — tests en échec :"
    grep -E '^✗' "$log" | sed 's/^✗ /    ✗ /'
  fi
}

rebuild () {
  (cd apps/api && npx tsc -p tsconfig.json) || return 1
  (cd apps/worker && npx tsc -p tsconfig.json) || return 1
}

mutate () { # $1 = fichier
  local f="$1"
  cp "$f" "/tmp/mutation-backups/$(echo "$f" | tr '/' '_').fixed"
  git checkout HEAD -- "$f"
}

restore () { # $1 = fichier
  local f="$1"
  cp "/tmp/mutation-backups/$(echo "$f" | tr '/' '_').fixed" "$f"
}

targets=(
  apps/api/src/modules/billing/payment-provider.service.ts
  apps/api/src/modules/video/video.service.ts
  apps/api/src/modules/video/dto/video.dto.ts
  apps/api/src/modules/exports/exports.service.ts
  apps/worker/src/pdf.ts
)

echo "═══ 0. État corrigé complet (référence VERTE) ═══"
rebuild && run_suite FIXED

for t in "${targets[@]}"; do
  echo
  echo "═══ MUTATION : $t (réversion pré-correctif) ═══"
  mutate "$t"
  rebuild
  run_suite "MUT-$(basename "$t")"
  restore "$t"
  rebuild
  run_suite "RESTORED-$(basename "$t")"
done

# Migration 049 : retirée temporairement (le reset de la suite rejoue 001→048).
echo
echo "═══ MUTATION : migration 049 retirée ═══"
mv infrastructure/database/migrations/049_storage_key_safety.sql /tmp/mutation-backups/049_storage_key_safety.sql
run_suite MUT-049-absente
mv /tmp/mutation-backups/049_storage_key_safety.sql infrastructure/database/migrations/049_storage_key_safety.sql
run_suite RESTORED-049

echo
echo "═══ Contrôle final : fichiers tous restaurés = corrigés ═══"
git status --porcelain -- apps infrastructure | head -20
echo "(les fichiers ci-dessus doivent être les correctifs, pas des réversions)"
