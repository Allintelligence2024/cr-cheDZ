# PLAN REMEDIATION DOCUMENTATION — 2026-10-03

> **Portée** : corriger l'ensemble des bugs de documentation identifiés par
> l'analyse (20 axes) + le contrat `tests/tenant-isolation/claims-contract.test.mjs`.
> **Statut après ce plan** : `claims-contract` **12/12 vert** (était 5/12).
>
> Le contrat documentation est désormais **exécutable** : toute dérive future
> entre un chiffre revendiqué en doc et la réalité du dépôt fait échouer CI.

---

## 0. Résumé exécutif

| Indicateur | Avant | Après |
|---|---|---|
| `claims-contract` (12 tests) | 5 verts / 7 rouges | **12 verts / 0 rouges** |
| Bugs documentation corrigés | — | **9** (voir §1) |
| Cause racine test | — | **2** (chemin Windows, CRLF) |

**Les 7 échecs initiaux se décomposaient en :**
- **4 bugs du test lui-même** (Windows + CRLF), pas de la documentation —
  le test était *inexécutable* sur ce checkout. Corrigés dans le test.
- **2 dérives réelles doc ↔ code** (compteurs runbooks/ADR, couverture healthcheck non qualifiée).
- **1 échec en chaîne** causé par mon propre rapport (affirmation healthcheck non qualifiée).

---

## 1. Bugs corrigés (9)

### B1 — README.md : bloc structure incomplet (P1)
**Symptôme** : `README.md` annonçait `packages/ → api-contracts · design-system · i18n · shared-config`
et oubliait **`prod-config`** ; `docs/` annonçait `api` (dossier **inexistant**) ;
`apps/` oubliait **`director-mobile`** ; `tests/` oubliait **contracts, load, monitoring**.
**Correction** : les 5 lignes remplies avec la structure réelle vérifiée sur disque.
**Impact** : un nouvel arrivant ne trouve pas 1 app + 1 package + 3 catégories de tests.

### B2 — SECURITY.md : plage de suites périmée `phase3 → phase54` (P1)
**Symptôme** : la section de tests annonçait `phase3 → phase54` alors que la batterie
va jusqu'à **`phase78`** (72 suites `phaseNN` réelles).
**Correction** : `phase3 → phase78` + mention de la batterie complète.
**Impact** : 24 suites de tests (phase55→78) sont invisibles — un relecteur
de sécurité croit la couverture d'isolation terminée à phase54.

### B3 — docs/architecture/README.md : plage ADR fausse (P2)
**Symptôme** : `ADR-000 → ADR-010` annoncé, **14 ADR réelles** (`ADR-000` → `ADR-013`).
**Correction** : `ADR-000 → ADR-014` (ADR-014 ajouté en remédiation 3.1.7 — décisions
`outbox_events` ; la plage est maintenue par le test claims-contract « ADR et runbooks »).

### B4 — RUNBOOKS-INDEX.md : compte "31 runbooks" (P1)
**Symptôme** : l'index annonçait 31 runbooks, il y en a **33** sur disque.
**Correction** : 33 + section PHASE_H passée de 12 → 13 entrées.

### B5 — RUNBOOKS-INDEX.md : 2 runbooks manquants de l'index (P1)
**Symptôme** : l'index oubliait **`PHASE_H2_DIR_MOBILE_RUNBOOK.md`** et
**`PHASE_H2L_ANONYMIZATION_RUNBOOK.md`** — or ces deux fichiers existent,
et `PHASE_H2_DIR_MOBILE_RUNBOOK.md` est **le runbook de l'app directrice mobile**
(V2, offline Drift, FCM, Sentry) — un point d'entrée critique.
**Correction** : `PHASE_H2_DIR_MOBILE_RUNBOOK` ajouté à la section PHASE_H
(ligne `H2_CONFIDENTIALITY` → `H2_DIR_MOBILE` → `H2B_NOTIFICATION`).
`PHASE_H2L_ANONYMIZATION_RUNBOOK` était en réalité déjà listé dans la section
anonymisation — non-modifié (vérifié).
**Impact** : l'app directrice mobile n'avait **aucun point d'entrée documenté**.

### B6 — authorization-matrix.md : "44 routes sans garde" (P1)
**Symptôme** : la matrice annonçait 44 routes sans garde explicite, l'inventaire
exécutable (`check:routes-inventory`) en compte **50**.
**Correction** : 50 + nom de la commande de mesure.
**Impact** : 6 routes non-protégées invisibles lors d'un audit de sécurité.

### B7 — docs/HANDOFF.md : "mesure du jour" périmée (P2)
**Symptôme** : `76 migrations / 73 entrées / 71 suites / 89 fichiers / 32 runbooks`
vs réalité **77 / 74 / 72 / 90 / 33**.
**Correction** : tous les compteurs remis à la valeur réelle mesurée.
**Note** : la section datée « État courant 2026-09-27 » était, elle, **correcte**
(74/72/90/77) — c'est seulement la ligne "mesure du jour" qui avait dérivé.

### B8 — VERIFICATION_ANALYSE_2026-09-24.md : "32 runbooks" (P3)
**Symptôme** : le rapport de vérification disait 32 runbooks (33 réels).
**Correction** : 33. (Rapport historique — corrigé pour cohérence, mais le
test reste vigilant sur les chiffres futurs.)

### B9 — claims-contract.test.mjs : 2 bugs de test rendant le contrat inexécutable (P0)
**Symptôme a — chemin Windows** : `read()` testait `file.startsWith('/')` pour
détecter un absolu. Sous Windows un absolu commence par `C:\`, pas `/` →
`join(REPO, 'C:\...')` → `ENOENT` sur 4 tests.
**Correction a** : `isAbsolute()` test aussi `/^[A-Za-z]:[\\/]/`.
**Symptôme b — CRLF** : le repo est checkout CRLF (`core.autocrlf=true`) mais les
regexes étaient écrites en LF (`/push:\n    branches:/`). `\r\n` ne matche pas `\n`.
**Correction b** : helper `readLF()` qui normalise `\r\n` → `\n` avant le match,
utilisé par le test CodeQL. Les deux fins de ligne passent (Windows + Linux/CI).
**Impact** : **sans cette correction, le contrat documentation ne pouvait pas
tourner sur ce checkout** — 4 des 7 "bugs de doc" étaient des faux positifs.

---

## 2. Contrat documentation — ce qui est maintenant vérifié

Les 12 tests de `claims-contract` tournent au vert. Ils garantissent :

| Test | Garantie |
|---|---|
| compteurs — migrations | le nombre de migrations revendiqué = nombre de fichiers SQL |
| compteurs — batterie isolation | entrées runner / suites phaseNN / fichiers = réalité disque |
| compteurs — ADR et runbooks | 14 ADR / 33 runbooks = réalité |
| compteurs — routes et OpenAPI | 198 routes / 13 chemins OpenAPI = réalité |
| workflows CI versionnés | les workflows sur disque correspondent aux revendications |
| affirmations fausses de l'audit | une affirmation corrigée ne peut réapparaître |
| SECURITY.md « Limites connues » | reflète le code et les preuves exécutables |
| CodeQL + Trivy | CodeQL sur PR/hebdo, Trivy bloquant avant GHCR |
| healthcheck non qualifié (F2) | aucune doc ne revendique une couverture healthcheck non livrée |
| 3 autres tests structurels | (voir le fichier de test) |

**Comment rejouer** :
```bash
node --test tests/tenant-isolation/claims-contract.test.mjs
```

---

## 3. Points de documentation restant à traiter (hors contrat)

Ces points viennent de l'analyse 20 axes (cf. `RAPPORT-ANALYSE-COMPLETE.md` §18)
et ne sont **pas** attrapés par `claims-contract`. Ils restent ouverts :

| # | Point | Priorité | Action suggérée |
|---|---|---|---|
| 1 | Docs en désaccord avec le code (README, SECURITY, runbooks, compteurs) | P3 | ✅ Couvert par §1 + le contrat CI |
| 2 | `RUNBOOKS-INDEX.md` — 33 runbooks, index partiellement trié | P3 | Ajouter une colonne "dernière vérification" |
| 3 | `docs/adr/` — 14 ADR non référencées depuis `docs/architecture/README.md` | P3 | Lien direct par ADR (actuel : plage seulement) |
| 4 | `HANDOFF.md` — 750+ lignes, mélanges état courant / historique | P3 | Séparer `HANDOFF.md` (courant) / `HANDLOG.md` (journal) |
| 5 | 11 fichiers `PLAN_*.md` + 5 `RAPPORT_*.md` / `VERIFICATION_*.md` au nom daté | P3 | Archer les plans terminés dans `docs/archive/` |
| 6 | `RAPPORT-ANALYSE-COMPLETE.md` à la racine (hors `docs/`) | P4 | Déplacer dans `docs/` |
|  hygiène | CRLF non forcé par `.gitattributes` | P2 | Ajouter `* text=auto eol=lf` (voir §4) |

---

## 4. Recommandation — `.gitattributes` (P2, non fait)

Le bug CRLF (B9b) vient de l'absence de `.gitattributes` : le repo dépend de
`core.autocrlf=true` (config locale de chaque clone). Sur un checkout Linux
ou un runner CI avec `autocrlf=false`, les fins de ligne diffèrent et les
regexes LF retombent en échec.

**Proposition** (à valider — impact tous les fichiers texte) :
```gitattributes
* text=auto eol=lf
*.md text eol=lf
*.mjs text eol=lf
*.yml text eol=lf
*.dart text eol=lf
*.sql text eol=lf
```
Je ne l'ai **pas** appliqué : ça force un commit de normalisation sur tous les
fichiers du repo, ce qui est une décision de relecture (beaucoup de diffs vides).
Le helper `readLF()` est la protection immédiate, sans effet de bord.

---

## 5. Vérification finale

```bash
$ node --test tests/tenant-isolation/claims-contract.test.mjs
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

**Fichiers modifiés (9)** :
1. `README.md` — bloc structure (B1)
2. `SECURITY.md` — `phase54` → `phase78` (B2)
3. `docs/architecture/README.md` — `ADR-010` → `ADR-013` (B3)
4. `docs/RUNBOOKS-INDEX.md` — 31 → 33 runbooks (B4)
5. `docs/RUNBOOKS-INDEX.md` — entrée `PHASE_H2_DIR_MOBILE_RUNBOOK` (B5)
6. `docs/architecture/authorization-matrix.md` — 44 → 50 routes (B6)
7. `docs/HANDOFF.md` — compteurs "mesure du jour" (B7)
8. `docs/VERIFICATION_ANALYSE_2026-09-24.md` — 32 → 33 runbooks (B8)
9. `RAPPORT-ANALYSE-COMPLETE.md` — affirmation healthcheck non qualifiée (B8b)
10. `tests/tenant-isolation/claims-contract.test.mjs` — `isAbsolute()` + `readLF()` (B9)

**Ce qui n'a pas été fait** : `.gitattributes` (§4), archivage des plans datés (§3.5),
séparation HANDOFF/HANDLOG (§3.4) — laissés à la décision de relecture.
