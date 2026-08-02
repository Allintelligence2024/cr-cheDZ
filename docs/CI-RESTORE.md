# Restauration des workflows GitHub Actions

**Contexte** : la GitHub App utilisée par l'agent de développement n'a pas la
permission `workflows` — GitHub refuse de créer/mettre à jour
`.github/workflows/*` via ce token (push rejeté : « refusing to allow a
GitHub App to create or update workflow … without workflows permission »).

## État actuel

- Les workflows **ci.yml** (database → 23 suites schema-check…phase20, api,
  web, security avec CodeQL, e2e Playwright) et **docker.yml** (api, worker,
  admin-web, support-console → ghcr.io/creche-saas) sont prêts dans
  `.github/workflows/` du dépôt local, ainsi que les Dockerfiles des 4 apps.
- Ils sont **non commités** (le commit de restauration a été retiré de la
  branche pour ne pas bloquer les pushs).
- **2026-08-02** : les versions locales d'origine ont été perdues avec
  l'espace de travail — les fichiers présents ont été **réécrits** à partir
  de la description ci-dessus (mêmes jobs). Nouvelle tentative de push :
  toujours refusé sans la permission `workflows` (« refusing to allow a
  GitHub App to create or update workflow .github/workflows/ci.yml »).
  **Action humaine requise** : accorder la permission `workflows` à la
  GitHub App, puis exécuter la commande de restauration ci-dessous.
- NB e2e : les specs Playwright (login + director-flow) n'ont JAMAIS été
  exécutées — le premier run CI du job e2e peut échouer sur la spec elle-même
  (chemins, sélecteurs) ; corriger la spec, jamais l'application.

## Restaurer (une seule commande, depuis le dépôt)

```bash
git add .github apps/worker/Dockerfile
git commit -m "ci: restore GitHub Actions workflows"
git push origin arena/019fbeff-cr-chedz
```

## Alternative — accorder la permission à l'App

1. GitHub → Settings → Developer settings → GitHub Apps → **Arena** →
   Permissions → **Workflows : Read and write**.
2. Relancer le push du commit ci-dessus.

## Contenu des workflows (prêts à l'emploi)

| Fichier | Rôle |
|---|---|
| `.github/workflows/ci.yml` | Jobs : **database** (migrations + seeds + schema-check + GATE RLS + isolation + phases 3→11), **api** (typecheck + build), **web** (admin + support), **security** (npm audit + CodeQL), **e2e** (Playwright parcours directeur) |
| `.github/workflows/docker.yml` | Build des images `ghcr.io/creche-saas/{api,worker,admin-web}` (dev/staging/tags v*) |
