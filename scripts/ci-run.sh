#!/usr/bin/env bash
#
# Exécute une commande de CI en gardant son code de sortie HONNÊTE, en archivant
# sa sortie dans un fichier de log, et en publiant les lignes d'échec en
# annotations GitHub.
#
# POURQUOI CE SCRIPT EXISTE (fait mesuré en CI le 2026-09-25, run 36189792213) :
# `flutter test | tee log` laisse le pipeline renvoyer le code de sortie de
# `tee` (0). Un test réellement en échec passait donc pour vert : la seule trace
# était un `::error::4 tests passed, 1 failed.` du reporter Dart — sans fichier,
# sans ligne, sans test nommé. Deux suites de 5 tests côté staff-mobile
# pouvaient être la cause, impossible de trancher sans exécuter. Le job `flutter`
# était donc un « faux vert », exactement ce que ce dépôt refuse ailleurs.
#
# Le verrou statique correspondant est la règle 8 de
# `tests/tenant-isolation/parent-session-contract.test.mjs` : tout `| tee` d'un
# workflow doit passer par ce script (ou par `set -o pipefail` explicite), et
# les étapes de test doivent publier leurs échecs.
#
# Usage : bash scripts/ci-run.sh <fichier-log> <titre-annotation> <commande...>
set -o pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <fichier-log> <titre-annotation> <commande...>" >&2
  exit 2
fi

log="$1"; shift
title="$1"; shift

set +e
"$@" 2>&1 | tee "$log"
rc=$?
set -e

if [ "$rc" -ne 0 ]; then
  # Au maximum 8 annotations : au-delà, GitHub agrège/tronque, et la sortie
  # complète reste dans le fichier de log (archivé en artefact du job). Le
  # `|| true` évite qu'un `head` qui ferme le tube ne transforme ce diagnostic
  # en code de sortie parasite (SIGPIPE) — c'est `rc` qui fait foi.
  {
    grep -aE '\[E\]|Expected:|Actual:|Which:|error •|Error:|FAILURE|What went wrong|Exception' "$log" \
      | head -8 \
      | while IFS= read -r line; do
          echo "::error title=${title}::${line:0:400}"
        done
  } || true
fi

# Le code de sortie de la commande, jamais celui du tube.
exit "$rc"
