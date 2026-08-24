#!/usr/bin/env bash
# Rejoue les 24 suites d'isolation dans l'ordre canonique (HANDOFF).
# Prérequis : PostgreSQL réel sur DATABASE_URL, apps/api + apps/worker compilés.
# Usage : bash scripts/run-isolation-suites.sh [préfixe-de-filtrage]
set -uo pipefail

export RATE_LIMIT_DISABLED="${RATE_LIMIT_DISABLED:-1}"
export NODE_ENV="${NODE_ENV:-test}"
export STORAGE_BACKEND="${STORAGE_BACKEND:-local}"
export STORAGE_LOCAL_DIR="${STORAGE_LOCAL_DIR:-/tmp/creche-storage-tests}"
export PAYMENT_WEBHOOK_SECRET="${PAYMENT_WEBHOOK_SECRET:-phase8-test-secret}"
mkdir -p "$STORAGE_LOCAL_DIR"

cd "$(dirname "$0")/.."
: "${DATABASE_URL:?DATABASE_URL requis (ex. postgres://postgres:postgres@localhost:54329/creche_test)}"

SUITES=(
  schema-check.mjs
  rls-behavior-check.mjs
  isolation.api.test.mjs
  phase3.api.test.mjs
  phase4.api.test.mjs
  phase5.api.test.mjs
  phase6.api.test.mjs
  phase7-parent.api.test.mjs
  phase8-billing.api.test.mjs
  phase9-dashboard.api.test.mjs
  phase10-compliance.api.test.mjs
  phase10-health.api.test.mjs
  phase10-privacy.api.test.mjs
  phase11-hardening.api.test.mjs
  phase12-messaging.api.test.mjs
  phase13-exports.api.test.mjs
  phase14-online-payment.api.test.mjs
  phase15-multirole.api.test.mjs
  phase16-whatsapp.api.test.mjs
  phase17-payroll.api.test.mjs
  phase18-marketplace.api.test.mjs
  phase19-whatsapp-otp.api.test.mjs
  phase20-video-dpia-gate.api.test.mjs
  phase21-video-surveillance.api.test.mjs
  phase22-audit-fixes.api.test.mjs
)

FILTER="${1:-}"
declare -a RESULTS=()
failed=0

# Garde anti-bypass RLS (audit 4.1) — AVANT toute suite : aucun pool.query
# brut sur table tenant ne doit exister (le bug P0 serait mort né).
if node scripts/check-rls-usage.mjs; then
  RESULTS+=("PASS|check-rls-usage.mjs|garde anti-bypass RLS")
else
  RESULTS+=("FAIL|check-rls-usage.mjs|accès pool.query brut illégal — voir sortie")
  failed=$((failed+1))
fi

for s in "${SUITES[@]}"; do
  if [[ -n "$FILTER" && "$s" != *"$FILTER"* ]]; then continue; fi
  f="tests/tenant-isolation/$s"
  if [[ ! -f "$f" ]]; then
    RESULTS+=("ABSENT|$s|fichier manquant")
    failed=$((failed+1)); continue
  fi
  log="/tmp/suite-$(basename "$s" .mjs).log"
  if node "$f" >"$log" 2>&1; then
    RESULTS+=("PASS|$s|$(grep -c '✓' "$log" 2>/dev/null || echo '?') assertions ✓")
  else
    RESULTS+=("FAIL|$s|$(grep -c '✗' "$log" 2>/dev/null || echo '?') échecs — voir $log")
    failed=$((failed+1))
  fi
done

echo
echo "═══════════ RÉSUMÉ DES SUITES ═══════════"
for r in "${RESULTS[@]}"; do
  IFS='|' read -ra parts <<< "$r"
  printf '%-5s %-42s %s\n' "${parts[0]}" "${parts[1]}" "${parts[2]}"
done
total=${#RESULTS[@]}
echo "═══════════ $((total-failed))/$total suites vertes ═══════════"
[[ $failed -eq 0 ]] || exit 1
