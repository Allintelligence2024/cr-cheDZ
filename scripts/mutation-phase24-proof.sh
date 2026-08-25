#!/usr/bin/env bash
# PREUVE PAR MUTATION (MISSION P2 — phase24, webhook tardif) : pour chaque
# correctif, revient TEMPORAIREMENT à la version pré-correctif, rejoue phase24,
# constate les tests ROUGES, restaure le correctif et re-vérifie le VERT.
# Aucune affirmation de pertinence de test sans ce passage (même méthode que
# scripts/mutation-proof.sh et scripts/mutation-phase23-proof.sh).
#
# M1 : migration 052 retirée → billing_webhook_apply version 039 (montant du
#      webhook ignoré, confirmation SILENCIEUSE au montant du paiement) →
#      les assertions M sont ROUGES (200 au lieu de 422, paiement confirmé).
# M2 : mapping API PAYMENT_AMOUNT_MISMATCH réverté (version main) → la
#      fonction 052 lève bien l'exception mais l'API ne la traduit pas en
#      422 explicite → les assertions M sont ROUGES (500 au lieu de 422).
set -uo pipefail
cd "$(dirname "$0")/.."
export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:54329/creche_test}"
export RATE_LIMIT_DISABLED=1 NODE_ENV=test STORAGE_BACKEND=local
export STORAGE_LOCAL_DIR=/tmp/creche-storage-mutation PAYMENT_WEBHOOK_SECRET=phase8-test-secret
mkdir -p "$STORAGE_LOCAL_DIR" /tmp/mutation-p24-backups

SUITE=tests/tenant-isolation/phase24-late-webhook.api.test.mjs
MIG=infrastructure/database/migrations/052_fix_webhook_amount_guard.sql
SERVICE=apps/api/src/modules/billing/billing.service.ts

run_suite () { # $1 = étiquette
  local log="/tmp/mutation-p24-$1.log"
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
      echo "    — suite interrompue :"
      grep -m2 -E '^error:' "$log" | sed 's/^/    /'
    fi
  fi
}

rebuild_api () {
  (cd apps/api && npx tsc -p tsconfig.json) || return 1
}

echo "═══ 0. État corrigé complet (référence VERTE) ═══"
run_suite FIXED

echo
echo "═══ MUTATION M1 : migration 052 retirée (fonction 039 : montant ignoré) ═══"
mv "$MIG" /tmp/mutation-p24-backups/052_fix_webhook_amount_guard.sql
run_suite MUT-052-absente
mv /tmp/mutation-p24-backups/052_fix_webhook_amount_guard.sql "$MIG"
run_suite RESTORED-052

echo
echo "═══ MUTATION M2 : mapping API réverté (exception non traduite en 422) ═══"
cp "$SERVICE" /tmp/mutation-p24-backups/billing.service.ts.fixed
git show "origin/main:$SERVICE" > "$SERVICE" || git show "HEAD~0:$SERVICE" > "$SERVICE"
rebuild_api
run_suite MUT-service-revert
cp /tmp/mutation-p24-backups/billing.service.ts.fixed "$SERVICE"
rebuild_api
run_suite RESTORED-service

echo
echo "═══ Contrôle final : fichiers tous restaurés = correctifs ═══"
git status --porcelain -- apps infrastructure scripts tests | head -30
echo "(les fichiers ci-dessus doivent être les correctifs, pas des réversions)"
