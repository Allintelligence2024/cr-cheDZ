#!/usr/bin/env bash
# ============================================================================
# render-nginx-support-allowlist.sh
# R7 (remédiation 2026-09-21) — génération de l'allowlist /support/ à partir
# de SUPPORT_ALLOWED_CIDRS (variable d'env du .env prod).
#
# Usage :
#   SUPPORT_ALLOWED_CIDRS="10.8.0.0/24 192.0.2.10/32" \
#     bash scripts/render-nginx-support-allowlist.sh \
#       --template infrastructure/nginx/support-allowlist.conf.template \
#       --out      /etc/nginx/conf.d/support-allowlist.conf
#
# Prérequis : bash, sed, awk. Aucun binaire nginx requis (le rendu est
# indépendant du serveur ; nginx n'a qu'à include le fichier généré).
#
# Invariants :
#   - L'allowlist minimale (127.0.0.1/32 + 10.0.0.0/8) reste TOUJOURS dans le
#     template (cf. infrastructure/nginx/support-allowlist.conf.template) :
#     en cas de SUPPORT_ALLOWED_CIDRS vide / non défini, seuls ces deux CIDR
#     sont actifs. Aucun accès Internet public par défaut.
#   - Toute IP non listée reçoit 403 dans le bloc location /support/ (cf.
#     nginx.conf). deny all est implicite via `default 0` du geo.
#   - Validation naïve : on rejette toute chaîne qui ne ressemble pas à un
#     CIDR IPv4 (regex ^[0-9./]+$) — pas d'injection de directives nginx.
#
# Refs : R7/F5 du PLAN_REMEDIATION_FINAL.md.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE="${REPO_ROOT}/infrastructure/nginx/support-allowlist.conf.template"
OUT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --template) TEMPLATE="$2"; shift 2 ;;
    --out)      OUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Argument inconnu : $1" >&2; exit 2 ;;
  esac
done

if [[ -z "${OUT}" ]]; then
  echo "--out REQUIS (chemin du fichier nginx à include)" >&2
  exit 2
fi
if [[ ! -r "${TEMPLATE}" ]]; then
  echo "Template introuvable : ${TEMPLATE}" >&2
  exit 2
fi

CIDRS_RAW="${SUPPORT_ALLOWED_CIDRS:-}"
CIDR_LINES=""
if [[ -n "${CIDRS_RAW}" ]]; then
  # Découpage par espaces/newlines/comma ; validation CIDR ; production des
  # lignes « CIDR 1; » du bloc geo.
  for cidr in $(echo "${CIDRS_RAW}" | tr ', \t\n' ' '); do
    if [[ ! "${cidr}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(/[0-9]+)?$ ]]; then
      echo "⚠️  CIDR ignoré (format invalide) : ${cidr}" >&2
      continue
    fi
    CIDR_LINES+="${cidr} 1;"$'\n    '
  done
fi

mkdir -p "$(dirname "${OUT}")"
# Remplacement du marqueur >>>SUPPORT_CIDR_LINES<<< par les lignes générées.
# sed simple : on substitue la ligne contenant le marqueur par ${CIDR_LINES}.
awk -v lines="${CIDR_LINES}" '
  />>>SUPPORT_CIDR_LINES<</ {
    sub(/^[[:space:]]*# >>>SUPPORT_CIDR_LINES<<</, "")
    printf "%s", lines
    next
  }
  { print }
' "${TEMPLATE}" > "${OUT}"

# Récapitulatif (auditabilité) : nombre de CIDR supplémentaires ajoutés.
NB=$(echo -n "${CIDR_LINES}" | grep -c "1;" || true)
echo "✓ Allowlist /support/ rendue : ${NB} CIDR opérateur supplémentaires (${OUT})"
echo "  + toujours inclus : 127.0.0.1/32, 10.0.0.0/8 (boucle locale + Docker interne)"
echo "  + SUPPORT_ALLOWED_CIDRS brut : ${CIDRS_RAW:-<vide>}"
