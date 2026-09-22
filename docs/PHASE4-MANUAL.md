# PHASE4-MANUAL — Items manuels pour un opérateur humain

> **Phase 4 / remédiation 2026-09-21** — checklist des items NON automatisables
> depuis la sandbox. Chacun nécessite : accès VPN au VPS, secrets de prod,
> ou navigateur + base pilote. À exécuter dans l'ordre avant le go-live.
>
> **Pourquoi cette page** : S1, S3, S5 du plan Phase 4 (`docs/PLAN_REMEDIATION_FINAL.md` §3)
> demandent un environnement que cette sandbox ne fournit pas. Plutôt que
> de les faire à moitié, on les **documente pour l'humain** qui les exécutera
> avec les bons accès.

---

## Items déjà automatisés (commités sur `arena/01a0c77a-cr-chedz`)

| ID | Description | Commit |
|---|---|---|
| **S2** | `flutter-version: 3.47.1` au lieu de `channel: stable` flottant | `86fe42f` |
| **S4** | `scripts/verify-load-tests.mjs` (sanity check structurel k6 + bench) | `7a35756` |
| **S6** | `scripts/audit-seeds-pii.mjs` (preuve 100 % synthétique) | `aa8b3e6` |
| **S7** | `docs/RUNBOOKS-INDEX.md` (index des 31 runbooks + ordre de lecture) | `78857f2` |

---

## Items à faire manuellement

### S1 — E2E UI des flux critiques (Playwright)

**Effort** : 3 jours.

**Pré-requis côté humain** :
- VPN vers le VPS de staging (ou la cible pilote configurée)
- Navigateur Chromium installé : `npx playwright install --with-deps chromium`
- Variables d'environnement (jamais commitées) :
  ```bash
  E2E_DIRECTOR_EMAIL=pilot-01.directrice@pilote.dz
  E2E_DIRECTOR_PASSWORD=<depuis vault — voir docs/OPERATIONS-SECRETS.md>
  E2E_BASE_URL=https://staging-admin.example.dz
  ```

**Specs existantes** (`apps/admin-web/e2e/`) — déjà commitées, à exécuter :
1. `login.spec.ts` — login directeur
2. `session-refresh.spec.ts` — refresh silencieux (R14)
3. `director-flow.spec.ts` — flux directeur générique
4. `export-download.spec.ts` — export PDF (worker)
5. `invitation-flow.spec.ts` — invitation + acceptation

**Specs squelette commitées** (à compléter + activer) :
6. `billing-overdue-flow.spec.ts` — facture → partiel → overdue (R15/R19)
7. `payroll-finalize-lock.spec.ts` — run → finalize → blocage (R15)

**Procédure d'exécution** :
```bash
cd apps/admin-web
npm run e2e                                # toutes les specs
npm run e2e -- billing-overdue-flow.spec  # une spec précise
```

**Critère de validation** : 7/7 specs vertes. Les specs 6 et 7 sont
actuellement `.skip(true, ...)` — il faut retirer le skip une fois le
scénario implémenté (TODO dans chaque test).

**Ce qui peut rester en TODO** : si une spec bloque le go-live, créer un
ticket et continuer — l'invariant DB est déjà testé par
`tests/tenant-isolation/phase62-payroll-finalized-lock.pg.test.mjs` et la
spécification UI sert surtout à valider le feedback utilisateur.

---

### S3 — Credentials d'alerting (SMTP / Twilio / WhatsApp)

**Effort** : 2 heures.

**Pré-requis côté humain** :
- Accès au vault prod (`OPERATIONS-SECRETS.md`)
- Compte SMTP fonctionnel (recommandé : Mailgun, SES, ou Postmark)
- Optionnel : Twilio (SMS) et/ou Meta WhatsApp Cloud API

**Variables à remplir dans `.env.prod`** :
```bash
# Alerte e-mail (obligatoire)
ALERT_SMTP_HOST=smtp.mailgun.org
ALERT_SMTP_PORT=587
ALERT_SMTP_USER=alerts@creche.example.dz
ALERT_SMTP_PASSWORD=<vault>
ALERT_EMAIL_FROM=Creche Alerts <alerts@creche.example.dz>
ALERT_EMAIL_TO=oncall@creche.example.dz

# Optionnels (canaux supplémentaires)
ALERT_TWILIO_ACCOUNT_SID=<vault>
ALERT_TWILIO_AUTH_TOKEN=<vault>
ALERT_TWILIO_FROM=+213XXXXXXXXX
ALERT_TWILIO_TO=+213XXXXXXXXX
```

**Test synthétique (obligatoire avant go-live)** :
1. Déployer une nouvelle version de l'API.
2. Déclencher manuellement une alerte (ex. forcer `creche_jobs_pending > 50`
   en bloquant le worker pendant 10 min).
3. Vérifier la réception sur `ALERT_EMAIL_TO` (et SMS/WhatsApp si configuré).
4. Vérifier le code de sortie ≠ 0 de `scripts/backup.sh` (déjà couvert par
   le test `phase8-backup-failure.alert.test.mjs`).

**Critère de validation** : alerte reçue en < 5 min (email) ou < 1 min (SMS).

**Référence** : `docs/PHASE_E2_ALERTING_RUNBOOK.md` (comment configurer
chaque canal) + `docs/OPERATIONS-SECRETS.md` (hiérarchie des secrets).

---

### S5 — Restore drill prod réel

**Effort** : 1 jour (rituel mensuel ensuite).

**Pré-requis côté humain** :
- VPS de prod accessible en SSH
- Vault (pour la passphrase GPG et DATABASE_URL_PROD)
- ~30 min de downtime de la base (à planifier hors heures de pointe)

**Procédure** (cf. `docs/BACKUP-RUNBOOK.md` pour le détail) :
```bash
# 1. Lister les backups disponibles
ssh prod ls -lt /var/backups/creche/daily/

# 2. Choisir le backup d'il y a 7 jours (le plus ancien du lot local)
BACKUP=$(ssh prod ls -t /var/backups/creche/daily/*.gpg | tail -1)

# 3. Décrypter + restaurer dans une base jetable
ssh prod gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" "$BACKUP" \
  | gunzip | psql "$DATABASE_URL_DRILL"

# 4. Vérifier la cohérence
DATABASE_URL="$DATABASE_URL_DRILL" node scripts/migrate.mjs --check
DATABASE_URL="$DATABASE_URL_DRILL" node scripts/test-production-roles.mjs

# 5. Mesurer : restaurer complète < 30 min en staging
echo "Durée mesurée : $(date)"

# 6. Nettoyer
psql "$DATABASE_URL_DRILL" -c "DROP DATABASE creche_drill;"
```

**Critère de validation** :
- Restauration complète (decrypt + gunzip + psql) en < 30 min
- `migrate.mjs --check` vert (schéma cohérent avec la prod au moment du backup)
- `test-production-roles.mjs` vert (rôles DB corrects)
- Données applicatives cohérentes (au moins 1 facture, 1 enfant, 1 pointage
  par crèche pilote retrouvé)

**À automatiser** : configurer un cron mensuel sur le VPS qui notifie
oncall@creche.example.dz si le drill n'a pas eu lieu depuis 30 jours.

---

## Résumé exécutif

| ID | Statut | À faire |
|---|---|---|
| S1 — E2E UI | Squelette commité | Exécuter les 7 specs sur staging |
| S2 — Flutter pin | ✅ Auto | — |
| S3 — Alerting SMTP | Doc seulement | Configurer + tester une alerte |
| S4 — k6 sanity | ✅ Auto | (Exécution réelle : VPS, pas sandbox) |
| S5 — Restore drill VPS | Doc seulement | Drill mensuel + cron de rappel |
| S6 — Audit PII seeds | ✅ Auto | (`--strict` en CI future) |
| S7 — Index runbooks | ✅ Auto | — |

**Porte G-beyond** (cf. `docs/PLAN_REMEDIATION_FINAL.md` §5) : S1–S7 verts
+ go-live signé via la checklist §4 du `RUNBOOKS-INDEX.md`.

---

*Mainteneur* : ce fichier sert de passation entre l'agent de remédiation
(sandbox) et l'opérateur qui hold les secrets prod. Mettre à jour après
chaque drill / chaque alerte validée.
