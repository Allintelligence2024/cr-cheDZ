# Correction `body-parser` — express 5.2.1 (2026-10-14)

> Trace la résolution du dernier vrai défaut de dépendances (issue #42, plan §H2 « overrides
> body-parser »). Commit `fix/body-parser-2-override` (`3f81fe5`), PR à ouvrir (aucun merge sans
> autorisation client).

## Symptôme

```
$ npm ls body-parser
express@5.2.1
  body-parser@1.20.8 invalid: "^2.2.1" from node_modules/express
npm error code ELSPROBLEMS
```

## Cause racine

`express@5.2.1` (seul consommateur de `body-parser`) exige `body-parser ^2.2.1`, mais le
`package-lock.json` portait une entrée **orpheline** `node_modules/body-parser@1.20.8` hoistée à
la racine — résidu d'un passage `express 4.x → 5.x` — sans version `2.x` nested sous `express`.
Aucun `package.json` ne demande `1.20.8`.

## Ce qui avait déjà été tenté (et échoué) — voir handoff §3.5.2

- `npm install --package-lock-only` : « up to date », rien ne change (résolution incrémentale qui
  préserve l'entrée orpheline).
- Suppression de l'entrée lockfile seule : npm n'ajoute pas de remplacement.
- Suppression entrée + `rm -rf node_modules` + `--package-lock-only` : même résultat.
- Override racine seul + `--package-lock-only` / `npm install` : l'override est bien lu
  (`invalid: "2.3.0"`) mais le lockfile incrémental n'est pas corrigé.

## Solution retenue (chirurgicale, diff minimal)

1. Override racine dans `package.json` :
   ```json
   "overrides": { ..., "body-parser": "2.3.0" }
   ```
2. Régénération from-scratch du lockfile pour obtenir la structure npm correcte du sous-arbre :
   `rm package-lock.json node_modules && npm install` (produit `body-parser@2.3.0` hoisté +
   `content-type@2.1.0` nested). Cette régénération complète rafraîchit aussi `@types/node`
   (`*` de `@jest/*` → 26) : **drift non désiré, écarté**.
3. Report **chirurgical** de la correction sur le lockfile d'origine (script jetable) : remplacer
   le bloc `body-parser` (1.20.8 → 2.3.0), supprimer ses nested obsolètes, ajouter
   `body-parser/node_modules/content-type@2.1.0`, et passer `raw-body` 2.5.3 → 3.0.2 (seul
   consommateur = body-parser). **11 entrées touchées, 0 drift** sur les ~1025 autres packages.

```diff
 body-parser: 1.20.8 -> 2.3.0
 raw-body:     2.5.3  -> 3.0.2
 + body-parser/node_modules/content-type: 2.1.0
 - body-parser/node_modules/{debug,iconv-lite,media-typer,mime-db,mime-types,ms,type-is}
 - raw-body/node_modules/iconv-lite (0.4.24 ; 3.0.2 accepte ~0.7.0 fourni par la racine)
```

> npm (lockfileVersion 3) n'enregistre pas les `overrides` dans le lockfile : il les applique
> depuis `package.json` à l'install. Le lockfile reste donc sans champ `overrides`, comme avant.

## Validation (2026-10-14, PostgreSQL 18.4 embarqué)

| Contrôle | Commande | Résultat |
|---|---|---|
| Résolution | `npm ls body-parser qs` | ✅ `body-parser@2.3.0 overridden`, plus d'ELSPROBLEMS |
| Install | `npm ci --ignore-scripts` | ✅ exit 0 |
| Audit prod | `npm audit --omit=dev --audit-level=low` | ✅ 0 vulnérabilité |
| Lint | `npm run lint` (`--max-warnings=0`) | ✅ 0 |
| Typecheck | `npm run typecheck` | ✅ exit 0 |
| Build | `npm run build --workspace @creche/api` / `@creche/worker` | ✅ exit 0 |
| Corps 413 | `http-exception.filter.spec.ts` (via body-parser) | ✅ 4/4 |
| Unitaires | `npm run test:unit` | ✅ exit 0 |

Contrat préservé : `@nestjs/core` reste en **11.2.7** (aucun downgrade — règle « jamais
`npm audit fix` » respectée). Le test « corps trop volumineux → 413 `PAYLOAD_TOO_LARGE` » reste
vert.

## Reste ouvert (hors périmètre agent, voir handoff)

- Reproductibilité lockfile sur clone propre (§3.5.1) : `pnpm-workspace.yaml` absent (confirmé),
  à cocher après un `git clone` + `npm ci` + `git status` vierge.
- L'override `body-parser 2.3.0` devra être re-vérifié si `express` monte en version majeure.
