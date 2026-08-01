# Restauration des workflows GitHub Actions

**Contexte** : la GitHub App utilisée par l'agent de développement n'a pas la
permission `workflows` — GitHub refuse de créer/mettre à jour
`.github/workflows/*` via ce token (push rejeté : « refusing to allow a
GitHub App to create or update workflow … without workflows permission »).

## État actuel

- Les workflows **ci.yml** (database → suites phase3→11, api, web, security
  avec CodeQL, e2e Playwright) et **docker.yml** (api, worker, admin-web →
  ghcr.io/creche-saas) sont prêts dans `.github/workflows/` du dépôt local,
  ainsi que `apps/worker/Dockerfile`.
- Ils sont **non commités** (le commit de restauration a été retiré de la
  branche pour ne pas bloquer les pushs).

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
