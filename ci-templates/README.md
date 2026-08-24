# Workflows CI en attente de déploiement

La GitHub App de poussée n'a pas la permission `workflows` : les fichiers ne
peuvent pas etre poussés sous `.github/` depuis cet environnement (voir
docs/CI-RESTORE.md). Déploiement en une commande depuis un compte avec le
droit workflows :

    mkdir -p .github/workflows
    git mv ci-templates/workflows/ci.yml ci-templates/workflows/security-audit.yml .github/workflows/
    git mv ci-templates/dependabot.yml .github/dependabot.yml
    rmdir ci-templates/workflows ci-templates 2>/dev/null || true
    git commit -m "ci: workflows ci (postgres:18) + security-audit hebdo + dependabot"
