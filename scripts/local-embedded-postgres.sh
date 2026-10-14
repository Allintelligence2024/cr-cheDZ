#!/usr/bin/env bash
# Sans Docker : PostgreSQL 18 embarqué (npm `embedded-postgres`, même version
# que la CI `postgres:18`) pour les gates base de données en local.
#
# Usage :
#   bash scripts/local-embedded-postgres.sh start    # démarre + crée creche_test
#   bash scripts/local-embedded-postgres.sh status
#   bash scripts/local-embedded-postgres.sh env      # imprime DATABASE_URL (eval-able)
#   bash scripts/local-embedded-postgres.sh stop
#
# Variables facultatives : PG_PORT (défaut 54329), PG_DATA (défaut /tmp/creche-pg-data).
# Prérequis : `npm ci` exécuté à la racine du dépôt.
set -euo pipefail

cd "$(dirname "$0")/.."
PG_PORT="${PG_PORT:-54329}"
PG_DATA="${PG_DATA:-/tmp/creche-pg-data}"
PG_LOG="${PG_LOG:-/tmp/creche-pg.log}"

BIN_DIR=""
for candidate in node_modules/@embedded-postgres/*/native/bin; do
  if [[ -x "$candidate/pg_ctl" ]]; then BIN_DIR="$(cd "$candidate" && pwd)"; break; fi
done
if [[ -z "$BIN_DIR" ]]; then
  echo "✗ Binaires embedded-postgres introuvables : lancer 'npm ci' à la racine." >&2
  exit 1
fi

url() { echo "postgres://postgres:postgres@localhost:${PG_PORT}/${1:-creche_test}"; }

case "${1:-status}" in
  start)
    if [[ ! -f "$PG_DATA/PG_VERSION" ]]; then
      rm -rf "$PG_DATA"
      "$BIN_DIR/initdb" -D "$PG_DATA" -U postgres --auth=trust -E UTF8 >/dev/null
    fi
    if ! "$BIN_DIR/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
      "$BIN_DIR/pg_ctl" -D "$PG_DATA" -o "-p $PG_PORT -k /tmp" -l "$PG_LOG" -w start >/dev/null
    fi
    # Base de test (idempotent)
    node -e "
      const pg = require('pg');
      (async () => {
        const c = new pg.Client(process.argv[1]); await c.connect();
        const r = await c.query(\"SELECT 1 FROM pg_database WHERE datname='creche_test'\");
        if (r.rowCount === 0) await c.query('CREATE DATABASE creche_test');
        await c.end();
      })().catch((e) => { console.error(e.message); process.exit(1); });
    " "$(url postgres)"
    echo "✓ PostgreSQL démarré : $(url)"
    ;;
  status)
    if "$BIN_DIR/pg_ctl" -D "$PG_DATA" status >/dev/null 2>&1; then
      echo "✓ démarré sur le port $PG_PORT"
    else
      echo "✗ arrêté"; exit 1
    fi
    ;;
  env)
    echo "export DATABASE_URL=$(url creche_test)"
    ;;
  stop)
    "$BIN_DIR/pg_ctl" -D "$PG_DATA" stop -m fast >/dev/null 2>&1 && echo "✓ arrêté" || echo "déjà arrêté"
    ;;
  *)
    echo "usage: $0 {start|status|env|stop}" >&2; exit 2 ;;
esac
