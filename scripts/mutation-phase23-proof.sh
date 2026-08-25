#!/usr/bin/env bash
# PREUVE PAR MUTATION (MISSION P1 — phase23) : pour chaque correctif, revient
# TEMPORAIREMENT à la version pré-correctif (git HEAD), rejoue phase23, constate
# les tests ROUGES, restaure le correctif et re-vérifie le VERT. Aucune
# affirmation de pertinence de test sans ce passage (même méthode que
# scripts/mutation-proof.sh).
set -uo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL='postgres://postgres:postgres@localhost:54329/creche_test'
export RATE_LIMIT_DISABLED=1 NODE_ENV=test STORAGE_BACKEND=local
export STORAGE_LOCAL_DIR=/tmp/creche-storage-mutation PAYMENT_WEBHOOK_SECRET=phase8-test-secret
mkdir -p "$STORAGE_LOCAL_DIR" /tmp/mutation-p23-backups

SUITE=tests/tenant-isolation/phase23-pending-expiry.api.test.mjs

run_suite () { # $1 = étiquette
  local log="/tmp/mutation-p23-$1.log"
  if node "$SUITE" >"$log" 2>&1; then
    echo "  [$1] VERT (rc=0)"
  else
    echo "  [$1] ROUGE (rc=1)"
    local n
    n=$(grep -cE '^✗' "$log" || true)
    if [[ "$n" -gt 0 ]]; then
      echo "    — assertions en échec :"
      grep -E '^✗' "$log" | sed 's/^✗ /    ✗ /'
    else
      echo "    — suite interrompue (migration/colonne absente) :"
      grep -m2 -E '^error:' "$log" | sed 's/^/    /'
    fi
  fi
}

rebuild () {
  npm run build --workspace @creche/prod-config >/dev/null || return 1
  (cd apps/api && npx tsc -p tsconfig.json) || return 1
  (cd apps/worker && npx tsc -p tsconfig.json) || return 1
}

mutate () { # $1 = fichier
  local f="$1"
  cp "$f" "/tmp/mutation-p23-backups/$(echo "$f" | tr '/' '_').fixed"
  git checkout HEAD -- "$f"
}

restore () { # $1 = fichier
  local f="$1"
  cp "/tmp/mutation-p23-backups/$(echo "$f" | tr '/' '_').fixed" "$f"
}

targets=(
  apps/worker/src/main.ts
  apps/api/src/modules/billing/payment-provider.service.ts
)

echo "═══ 0. État corrigé complet (référence VERTE) ═══"
rebuild && run_suite FIXED

echo
echo "═══ MUTATION M1 : worker — handler payments_expire réverté (HEAD) ═══"
mutate apps/worker/src/main.ts
rebuild
run_suite MUT-worker-payments-expire
restore apps/worker/src/main.ts
rebuild
run_suite RESTORED-worker

echo
echo "═══ MUTATION M2 : API — supersede à l'init réverté (HEAD) ═══"
mutate apps/api/src/modules/billing/payment-provider.service.ts
rebuild
run_suite MUT-api-supersede
restore apps/api/src/modules/billing/payment-provider.service.ts
rebuild
run_suite RESTORED-api

echo
echo "═══ MUTATION M3 : migration 051 retirée (fonction + invoice_id absents) ═══"
mv infrastructure/database/migrations/051_payments_pending_expiry.sql /tmp/mutation-p23-backups/051_payments_pending_expiry.sql
run_suite MUT-051-absente
mv /tmp/mutation-p23-backups/051_payments_pending_expiry.sql infrastructure/database/migrations/051_payments_pending_expiry.sql
run_suite RESTORED-051

echo
echo "═══ Contrôle final : fichiers tous restaurés = correctifs ═══"
git status --porcelain -- apps infrastructure scripts | head -30
echo "(les fichiers ci-dessus doivent être les correctifs, pas des réversions)"
