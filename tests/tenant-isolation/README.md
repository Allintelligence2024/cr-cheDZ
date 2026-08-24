# Tests — isolation multi-tenant

| Fichier | Contenu | Phase |
|---|---|---|
| `schema-check.mjs` | Contrôles structurels du schéma (RLS complète + FORCE + policy présente + ancrage tenant, WITH CHECK, contraintes C04, curseur C02, drift C05) — exécuté en CI | 1 |
| `rls-behavior-check.mjs` | **GATE** : test comportemental sur vraie base (rôle `NOBYPASSRLS`) — B ne lit/écrit pas chez A, sans tenant → 0 ligne, facture immuable | 1 |
| `isolation.api.test.mjs` | Tests API : org A ne voit jamais les données de org B (404 et non 403), sync cross-tenant rejetée, idempotence 10× | 2, 5 |
| `phase22-audit-fixes.api.test.mjs` | Régression des correctifs d'audit (P0 paiement, politique stockage vidéo, cross-tenant storage, backend serveur, CHECK 049, garde worker) — prouvée par mutation (`scripts/mutation-proof.sh`) | 22 |

Ordre canonique rejouable : `bash scripts/run-isolation-suites.sh` (inclut
la garde anti-bypass RLS `scripts/check-rls-usage.mjs` en tête).

## Exécution locale

```bash
export DATABASE_URL=postgresql://...:5432/creche_dev
node tests/tenant-isolation/schema-check.mjs --verbose
```

Les tests API (isolation.test.ts) arrivent en Phase 2 — ils s'exécutent contre
une vraie base PostgreSQL dans CI (service container `postgres:16`) et
suivent la Partie 6.1 de l'architecture.
