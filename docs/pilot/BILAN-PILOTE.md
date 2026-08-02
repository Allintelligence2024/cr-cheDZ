# BILAN PILOTE — Préparation (rempli le 2026-08-02)

> **Baseline pré-pilote** : tout ce qui pouvait être mesuré SANS les crèches
> réelles a été mesuré et consigné ici. Les cases « terrain » restent à
> remplir après les 2 semaines de pilote (cf. CHECKLIST_PILOTE.md). Aucune
> valeur terrain n'est inventée.

## Participants (à remplir après le pilote)

| Crèche | Jours d'utilisation / 14 | Pointages totaux | Irritants signalés | Incidents bloquants |
|---|---|---|---|---|
| pilot-01 | /14 | | | |
| pilot-02 | /14 | | | |
| pilot-03 | /14 | | | |
| pilot-04 | /14 | | | |
| pilot-05 | /14 | | | |

## Critères MVP — mesures API réelles (baseline, PostgreSQL réel NOBYPASSRLS)

| Critère | Cible | Résultat mesuré | Verdict |
|---|---|---|---|
| Pointage section < 3 min | < 180 s | **0,09 s** (12 check-ins API, mvp-bench) | ✅ pré-pilote |
| Repas groupé < 30 s | < 30 s | **0,037 s** (12 enfants, mvp-bench) | ✅ pré-pilote |
| 8 h hors ligne sans perte | 0 perdu | 200 opérations offline testées (phase5) ; **8 h réelles ⏳ terrain** | ⏳ terrain |
| Notification arrivée < 30 s | < 30 s | File + FCM/APNs codés (chemins d'échec testés) ; **bout en bout ⏳ secrets** | ⏳ secrets |
| Parent : ses enfants uniquement | 0 fuite | 11 cas phase7 verts (dont 2 parents permissions différentes) | ✅ |
| Android 2 Go RAM | utilisable | **⏳ device farm** (SDK/builds stores) | ⏳ terrain |
| Factures du mois < 5 min | < 5 min | **0,008 s/facture** (API) + écran web BillingPage | ✅ pré-pilote |
| Import 50 enfants | sans erreur | **0,061 s** (mvp-bench) + dry-run/rapport FR-AR testés | ✅ |
| Staging sans données réelles | vérifié | `scripts/anonymize.sql` prêt (garde-fou) ; **contrôle CI ⏳** | ⏳ CI |

## Préparation (faite)

- ✅ 5 crèches pilotes créées (seed-pilot.mjs) : 3 salles, 15 enfants, directrice
  + 2 éducatrices + comptable, contrats, parents — login réel vérifié.
- ✅ Rapport de préparation : 19/19 vérifications OK (migrations, schema-check,
  GATE RLS, 14 suites d'isolation) — `docs/pilot/RAPPORT-PREPARATION.md`.
- ✅ Benchmark MVP 4/4 dans les limites (mesures ci-dessus).
- ✅ Jauges de suivi : `/metrics` (checkins/jour, sync 24 h, jobs échoués 24 h,
  5xx 24 h, enfants actifs = 75) + console support « Suivi pilote ».
- ✅ Sécurité : `npm audit --omit=dev` → **0 vulnérabilité** (NestJS 11,
  react-router 8, React 19, exceljs, uuid 11) ; OTP désormais généré par
  `crypto.randomInt` (Math.random retiré) ; semgrep local : 5 résultats
  analysés (1 vrai bug corrigé, 4 faux positifs).
- ✅ Onboarding, checklist 2 semaines, QR de partage, runbook §8, roadmap v2.

## Blocages terrain (non mesurables en sandbox — honnêtement listés)

1. **2 semaines réelles d'utilisation** par 5 crèches (indisponible ici).
2. **Stores** (Play Console / App Store) + **device farm** Android 2 Go RAM
   (comptes et SDK requis).
3. **FCM/APNs/SMS réels** (secrets Firebase, APNs, Twilio) pour la mesure
   terrain des notifications < 30 s.
4. **Workflows CI** (permission `workflows` de la GitHub App) → e2e Playwright,
   CodeQL et Docker en CI ne tournent pas encore.
5. **Exercice de restauration chronométré** (< 30 min) sur l'infrastructure
   réelle (VPS + TLS + backups programmés : compose prod + .env.prod.example
   prêts).

## Décision (à remplir en fin de pilote)

- [ ] **GO** — lancement de la production
- [ ] **NO-GO** — conditions à remplir :

Signature (responsable) : ____________________  Date : ____/____/______
