# Restauration des workflows GitHub Actions

**Contexte** : la GitHub App utilisée par l'agent de développement n'a pas la
permission `workflows` — GitHub refuse de créer/mettre à jour
`.github/workflows/*` via ce token. Les fichiers existent dans le dépôt local
mais ne sont pas suivis par git.

## Restaurer (une seule commande, depuis le dépôt)

```bash
git add .github
git commit -m "ci: restore GitHub Actions workflows"
git push origin arena/019fbde5-cr-chedz
```

## Alternative — accorder la permission à l'App

1. GitHub → Settings → Developer settings → GitHub Apps → **Arena** →
   Permissions → **Workflows : Read and write**.
2. Relancer le push sans modification (le commit `chore:` est déjà poussé) :
   ```bash
   git push origin arena/019fbde5-cr-chedz
   ```

## Contenu des workflows (prêts à l'emploi)

| Fichier | Rôle |
|---|---|
| `.github/workflows/ci.yml` | Jobs : **database** (migrations + seeds + contrôle schéma + GATE RLS + isolation API + phases 3→6), **api** (typecheck + build), **web** (admin + support), **e2e** (Playwright login) |
| `.github/workflows/docker.yml` | Build des images `ghcr.io/creche-saas/{api,worker,admin-web}` (staging / tags v*) |

Les jobs s'appuient sur les scripts racine :
`npm run db:migrate`, `db:seed`, `db:check-schema`, `db:check-rls`,
`test:api-isolation`, `test:api-phase3..6`.
