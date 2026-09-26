# Dossier historique — les workflows CI sont sous `.github/workflows/`

Ce dossier ne contient **plus aucun workflow** : les quatre workflows du dépôt
(`ci.yml`, `docker.yml`, `flutter.yml`, `security-audit.yml`) sont versionnés
sous `.github/workflows/` et s'exécutent à chaque push.

Il rappelle un épisode terminé : la GitHub App de poussée n'ayant **pas eu**
la permission `workflows`, ces fichiers **avaient été** préparés ici, hors de
`.github/`, et la documentation de l'époque expliquait comment les déplacer
d'un coup. La restriction est **levée depuis** ; le déplacement a été fait.

Vérification (contrat de vérité documentaire,
`tests/tenant-isolation/claims-contract.test.mjs`, contrôle « workflows CI ») :

- les quatre workflows existent sous `.github/workflows/` et ne sont pas vides ;
- ce dossier ne contient **aucun** `.yml`/`.yaml` (un workflow qui « attend »
  ici fait échouer la CI `quality` avec le chemin fautif) ;
- aucun document de référence ne revendique l'état ancien (« en attente hors dépôt »)
  ailleurs que dans un récit explicitement historique.

État CI courant : voir `docs/CI-DATABASE-JOB-FINDINGS.md` (le job `database`
est rouge sur **H1 seul**, le tirage anonyme de `quay.io/minio/minio`).
