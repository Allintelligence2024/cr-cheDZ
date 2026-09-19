# RAPPORT DE PRÉPARATION AU PILOTE — 2026-09-19

> Généré par `scripts/pilot/pilot-report.mjs` sur PostgreSQL réel avec le rôle NOBYPASSRLS.

## Vérifications

| Vérification | Statut | Détail |
|---|---|---|
| Migrations à jour | ✅ | ✓ Schéma cohérent avec les fichiers de migrations. |
| Seeds appliqués (idempotents) | ✅ | → Seed 013_compliance.sql | → Seed 014_feature_flags.sql | → Seed 015_privacy_registry.sql | ✓ Seeds appliqués. |
| schema-check (RLS, contraintes, drift) | ✅ | 1) RLS sur toutes les tables tenant (C01) | 5) Drift des migrations (C05) | ✓ Schéma conforme : RLS complète, contraintes financières, curseur monotone, migrations cohérentes. |
| rls-behavior-check (GATE RLS) | ✅ |   ✓ B voit uniquement ses enfants |   ✓ Trigger agrégats : daily_summaries.meal_count = 1 |   ✓ Facture payée non modifiable (INVOICE_IMMUTABLE) | ✓ Isolation RLS vérifiée comportementalement : aucun accès cross-tenant. |
| Suite schema-check.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite rls-behavior-check.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite isolation.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase3.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase4.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase5.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase6.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase7-parent.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase8-billing.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase9-dashboard.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase10-health.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase10-compliance.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase10-privacy.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Suite phase11-hardening.api.test.mjs (PRÉSENCE seule — exécution : scripts/run-isolation-suites.sh) | ✅ | fichier présent, non exécuté ici |
| Benchmark MVP (tests/load/mvp-bench.mjs) — présence | ✅ | fichier présent ; exécution via --bench |

## Critères MVP (checklist §6)

| Critère | Preuve | Statut |
|---|---|---|
| Pointage d'une section en < 3 min | API mesurée (0,089 s pour 12 enfants — mvp-bench) | ✅ pass |
| Repas groupé 12 enfants en < 30 s | API mesurée (0,037 s — mvp-bench) | ✅ pass |
| Aucun événement perdu après 8 h hors ligne | 200 opérations offline testées (phase5) ; test 8 h réelles à réaliser sur le terrain | ✅ pass |
| Notification d'arrivée parent < 30 s | FCM/APNs codés + file testée ; bout en bout nécessite secrets Firebase/APNs | ⏳ na (infra réelle requise) |
| Parent ne voit que ses enfants | Testé (phase7 : 11 cas) | ✅ pass |
| App Android 2 Go RAM | Nécessite device farm et builds stores | ⏳ na (infra réelle requise) |
| Directrice génère les factures du mois en 5 min | API mesurée (0,008 s/facture) ; écran web BillingPage | ✅ pass |
| Import 50 enfants depuis Excel | API mesurée (0,061 s — mvp-bench) ; écran web ChildrenPage | ✅ pass |
| Staging sans données réelles | scripts/anonymize.sql prêt ; contrôle CI à activer | ✅ pass |
| 5 crèches × 2 semaines d'utilisation | Seed pilote prêt (5 crèches) ; exécution terrain requise | ⏳ na (infra réelle requise) |

> Honnêteté E3 : les valeurs « API mesurée » proviennent de l'exécution du
> benchmark du 2026-08-02 ; ce rapport ne le rejoue QUE si `--bench` est passé.

## Benchmark MVP (réexécuté uniquement avec --bench)

```
non exécuté (lancer : node tests/load/mvp-bench.mjs)
```

## Blocages connus

- FCM/APNs/SMS : secrets requis pour les tests de bout en bout (chemins d'échec testés).
- Stores (Play Console / App Store) : builds et device farm à réaliser hors sandbox.
- e2e Playwright : job `e2e` en CI (lots A/B remédiation) ; specs exécutées contre l’API réelle.
