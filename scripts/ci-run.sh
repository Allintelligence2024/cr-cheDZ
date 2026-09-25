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

publish() {
  # Au maximum 8 annotations : au-delà, GitHub agrège/tronque, et la sortie
  # complète reste dans le fichier de log (archivé en artefact du job). Le
  # `|| true` évite qu'un `head` qui ferme le tube ne transforme ce diagnostic
  # en code de sortie parasite (SIGPIPE) — c'est `rc` qui fait foi.
  {
    printf '%s\n' "$@" | head -8 | while IFS= read -r line; do
      [ -n "$line" ] && echo "::error title=${title}::${line:0:400}"
    done
  } || true
}

if [ "$rc" -ne 0 ]; then
  # 1) les lignes qui NOMMENT l'échec (erreurs d'analyzer, échecs de test,
  #    messages de pub, exceptions de build). Le motif est large à dessein :
  #    la 1re version ne cherchait que `error •`/`Error:` et laissait un step
  #    ROUGE sans aucune annotation quand l'échec venait d'un lint (`info •`)
  #    ou de la résolution de dépendances — un rouge muet ne vaut pas mieux
  #    qu'un vert faux (vécu le 2026-09-25, run 36194782638).
  matches=$(grep -aE 'error •|warning •|info •|issues? found|\[E\]|Expected:|Actual:|Which:|Error:|error:|Exception|FAILURE|What went wrong|Failed to|Because .* depends|version solving failed' "$log" || true)
  # 2) sinon, repli : la fin du log, pour qu'un échec soit TOUJOURS lisible
  #    dans les annotations (les artefacts ne sont pas toujours accessibles).
  if [ -z "$matches" ]; then
    matches=$(grep -av '^[[:space:]]*$' "$log" | tail -6 || true)
    publish "sortie non reconnue — fin du journal ${log}" "$matches"
  else
    # Le RÉSUMÉ d'abord (`N issues found`, `N tests passed`), puis les lignes
    # détaillées : le plafond d'annotations (8) coupait la fin du journal, donc
    # le total — mesuré le 2026-09-25 sur le staff-mobile, où 8 lints publiés
    # cachaient le nombre réel d'issues.
    summary=$(printf '%s\n' "$matches" | grep -aiE 'issues? found|tests? passed|version solving failed' || true)
    rest=$(printf '%s\n' "$matches" | grep -aivE 'issues? found|tests? passed' || true)
    publish "$summary" "$rest"
  fi
fi

# Le code de sortie de la commande, jamais celui du tube.
exit "$rc"
