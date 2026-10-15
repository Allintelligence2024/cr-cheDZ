# Phase G — Frontières privilégiées (audit 2026-10-14)

> Tâche handoff §3.4 point 3 : « lister les fonctions `SECURITY DEFINER` et les grants
> `UPDATE/DELETE`, décider lesquelles restreindre, écrire un test par frontière ».
> Ce document consigne l'inventaire et l'analyse. Aucune migration n'est ajoutée : les frontières
> examinées sont **déjà conformes** (voir conclusions). Une restriction supplémentaire exigerait une
> nouvelle migration **103+** (ADR-007 : 001–102 immuables) + un test dédié, à décider avec le métier.

## Inventaire — fonctions `SECURITY DEFINER`

Analyse statique de `infrastructure/database/migrations/*.sql` (commentaires `--` retirés, blocs
`$$…$$` isolés) :

- **76 fonctions `SECURITY DEFINER`** recensées.
- **76 / 76 portent `SET search_path`** → **0 fonction sans `search_path` figé**.

Le `search_path` figé sur chaque fonction DEFINER neutralise le *search_path hijacking* (injection
d'un schéma parasite pour intercepter un identifiant non qualifié). C'est la bonne pratique PG et
elle est appliquée partout. Répartition par migration (extrait) : `024`, `053`, `056`, `062`, `100`,
`016` (5 chacune), `029`, `057`, `015` (4), etc.

> Piège d'analyse écarté : `091_payroll_lines_immutable.sql` contient la chaîne « SECURITY DEFINER »
> **dans un commentaire** (« SECURITY DEFINER inutile : trigger exécuté comme propriétaire »). La
> fonction `guard_payroll_line_finalized()` est un trigger **SECURITY INVOKER** (droits du
> propriétaire de table), donc hors périmètre DEFINER. Confirmé : 0 fonction DEFINER sans
> `search_path` commentaires retirés.

## Rôle applicatif `creche_app` — surface de privilèges

D'après `infrastructure/database/grants.sql` (rejoué par le migrateur après chaque migration) :

- `GRANT USAGE ON SCHEMA public`.
- `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` — CRUD standard.
- `GRANT USAGE, SELECT ON ALL SEQUENCES`.
- `GRANT EXECUTE ON ALL FUNCTIONS`.
- **`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON schema_migrations`** — le
  registre de migrations est en lecture seule pour l'application (intégrité ADR-007).

La **vraie** frontière d'autorisation est **au niveau ligne** (RLS `FORCE ROW LEVEL SECURITY`,
rôle `NOBYPASSRLS`), pas au niveau des grants de table : `creche_app` a le DML mais RLS + le contexte
tenant (`set_config('app.current_org', …)`) limitent chaque requête aux lignes du tenant. Les
`UPDATE`/`DELETE` restreints sont donc assurés par :

1. RLS `WITH CHECK` (clause `USING`/`WITH CHECK` par table) ;
2. triggers d'immuabilité métier (paie finalisée `072`/`091`, cycle de vie financier `064`, etc.) ;
3. gardes de service (`RolesGuard`/`PermissionsGuard`) en amont de la DB.

## Conclusion

- **Aucune fonction `SECURITY DEFINER` sans `search_path`** : le risque principal est couvert.
- Les grants `UPDATE`/`DELETE` de `creche_app` sont volontairement larges (CRUD) **parce que** la
  restriction fine est portée par RLS + triggers + gardes de service. C'est le modèle documenté
  (`docs/architecture/authorization-matrix.md`, ADR-011).
- **Dette résiduelle assumée** (handoff §3.4 point 4) : renouvellement DPIA et historisation des
  décisions — hors périmètre technique immédiat, à traiter avec le responsable conformité.

## Rejouer l'audit

```bash
# 68 accès privilégiés conformes (RLS usage guard)
node scripts/check-rls-usage.mjs
# Schéma + RLS
node tests/tenant-isolation/schema-check.mjs --verbose
node tests/tenant-isolation/rls-behavior-check.mjs
```

Le gate Phase D (`node scripts/test-production-roles.mjs`, rôles de prod `creche_app` NOBYPASSRLS)
rejoue ces frontières sous le rôle applicatif réel — 77/77 en CI.
