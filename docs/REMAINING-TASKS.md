# Tâches restantes (mise à jour 2026-10-15)

> Référence handoff : « HANDOFF — Issues ouvertes (état au 2026-10-14) ».
> Après la PR #58 (body-parser 2.3.0 + iconv-lite prod + docs Phase D/autorisation/claims +
> frontières + i18n Dart), voici ce qui **reste** et **qui** doit l'exécuter.

## Fait dans la PR #58 (prêt pour revue, sans merge)

1. `body-parser@2.3.0` overridden (express 5.2.1) + `iconv-lite` passé en prod.
2. Rollback Phase D écrit (`PHASE_D_ROLES_RUNBOOK.md` : ordre de révocation + Qui décide).
3. ADR-015-moteur : PostgreSQL 18 uniforme (commentaire `ci.yml` postgres:16 corrigé).
4. Inventaire des 40 routes sans `@Roles`/`@Public` justifiées self-service.
5. `DEPS-BODY-PARSER-FIX.md` : traçabilité + reproductibilité clone propre vérifiée.
6. `PHASE_G_PRIVILEGE_BOUNDARIES.md` : 76/76 fonctions DEFINER avec `SET search_path`.
7. i18n : `nap_start` + 5 autres types FR/AR dans parent-mobile et director-mobile
   (API `JOURNAL_NOTIFICATION_TYPES` inchangée : `[meal, nap_end, incident]` = choix produit
   anti-bruit ; traductions à relire par un locuteur arabe).
8. `docs/VERIFICATION_ANALYSE_2026-09-24.md` : compteur ADR 15 → 16 (règle 4).

## Validation CI observée

- `codeql`, `docker`, `flutter`, `security`, `admin-web`, `support-console`, `e2e`,
  `backup-drill` : **pass**.
- Gate D `77/77` sous rôles de prod : déjà prouvé sur la baseline (handoff §2/§3.1,
  `test-production-roles.mjs`) ; les runs CI de la PR restent à confirmer après corrections.
- `claims-contract.test.mjs` : **12/12** local (après compteur ADR 16).

## Reste : action HUMAINE requise

| # | Sujet | Qui | Détail |
|---|---|---|---|
| D1–D6 | Décisions client | client | `next_org_sequence` (D1), paie sans prorata (D2), SMTP/Twilio (D3), MinIO (D4), keystore Android (D5), autorisation de merge (D6). |
| #14 | Drill restauration VM vierge | OPS humain | Runbook `BACKUP-RUNBOOK.md` + script `restore-drill.mjs` ; `< 15 min` pour `< 1 Go`. |
| #38-E2 | Secrets SMTP/Twilio prod | client | Activation exploitation (plan l.321). |
| #40 | Qualification Android release | humain | Keystore réel + release build. |
| i18n | Relecture arabe | locuteur natif | Fin de sieste / بداية القيلولة, Couche / حفاض, Activité / نشاط, Température / حرارة, Note / ملاحظة, Observation santé / ملاحظة صحية. |
| #41 | Renouvellement DPIA | conformité | Hors périmètre technique immédiat. |

## Reste : faisable AGENT (cliquable pour la session suivante)

| # | Sujet | Piste |
|---|---|---|
| #42-H3-tz | Audit timezone UTC+1 | `NOW() AT TIME ZONE 'Africa/Algiers'` déjà utilisé (analytics, dashboard, journal, attendance `todayInAlgiers`, billing, parents, exports) ; le résidu à auditer est **module par module** : intervalles 24h (`NOW() - INTERVAL`, metrics 050, support 036/037), `updated_at = NOW()` système (immuable, pas métier), défaut `toISOString()` côté web. Ne pas toucher sans test par module. |
| #39-H3 | Règle de paie sans prorata | Décision client D2 d'abord, puis implémentation. |
| #41-inv | Invitations : nonce/réinvitation + transport | Décision fournisseur D3, puis implémentation. |
| #15/#16/#17/#35/#55 | Clôture issues GitHub | Textes prêts dans handoff §7 (le jeton de session renvoyait 403 sur écriture d'issues ; si le jeton courant écrit, fermer avec ces commentaires). |

## Conformité branchée à cette session

- Repro lockfile clone propre : `npm ci` exit 0, `git status` vierge, `npm ls body-parser qs`
  sans ELSPROBLEMS, `npm audit --omit=dev` 0 vuln.
- Flutter absent localement : les gates F2/F4 (check-staff-sync, test-sync-api-flutter) relèvent
  de la CI `flutter-check` (déjà passée) ; `flutter analyze` des deux fichiers modifiés reste à
  confirmer en CI.
