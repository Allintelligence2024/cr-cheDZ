# HANDOFF — Agent Antigravity : items manuels Phase 4

> **Contexte** : tu es un agent Antigravity (accès VPN + secrets + navigateur).
> Tu exécutes les items restants du plan Phase 4 (`docs/PLAN_REMEDIATION_FINAL.md` §3)
> que la sandbox ne peut PAS automatiser. Tout le code est déjà commité sur
> la branche `arena/01a0c77a-cr-chedz` — ton job est **exécuter + valider**,
> pas de nouveau code sauf ce qui est explicitement demandé ci-dessous.
>
> **Branche** : `arena/01a0c77a-cr-chedz` (déjà pushed sur origin).
> **Repo** : `https://github.com/Allintelligence2024/cr-cheDZ.git`.
>
> **Règles** :
> - Pas de commit tant que la spec ne passe pas — tu pousses à la fin.
> - Les secrets viennent du vault, jamais dans le repo.
> - Chaque item = 1 commit séparé + 1 ligne dans la table de fin.
> - En cas de doute, lis `docs/RUNBOOKS-INDEX.md` (l'ordre de lecture est
>   HANDOFF → LOCAL-RUN → RUNBOOKS-INDEX → runbook thématique).

---

## Items déjà faits (ne pas y toucher)

| ID | Description | Commit |
|---|---|---|
| S2 | `flutter-version: 3.47.1` | `86fe42f` |
| S4 | `scripts/verify-load-tests.mjs` (sanity check) | `7a35756` |
| S6 | `scripts/audit-seeds-pii.mjs` | `aa8b3e6` |
| S7 | `docs/RUNBOOKS-INDEX.md` | `78857f2` |
| S1 (squelette) | `billing-overdue-flow.spec.ts` + `payroll-finalize-lock.spec.ts` | `f8ceb72` |
| Doc | `docs/PHASE4-MANUAL.md` | `f8ceb72` |

---

## ITEM 1 — S1 : compléter + exécuter les specs Playwright (3 jours)

### Pré-requis

```bash
# VPN + accès staging
ssh staging.example.dz "echo OK"

# Navigateur
cd apps/admin-web
npx playwright install --with-deps chromium

# Variables d'env (depuis le vault, cf. docs/OPERATIONS-SECRETS.md)
export E2E_DIRECTOR_EMAIL=pilot-01.directrice@pilote.dz
export E2E_DIRECTOR_PASSWORD=<du vault>
export E2E_BASE_URL=https://staging-admin.example.dz
export DATABASE_URL=postgres://staging-creche-app:<vault>@staging-db:5432/creche_staging

# Build API + worker (la config Playwright les lance en webServer)
npm run build --workspace @creche/api
npm run build --workspace @creche/worker
```

### Étape 1.1 — Exécuter les 5 specs existantes (déjà écrites)

```bash
cd apps/admin-web
npm run e2e
```

**Attendu** : 5 specs vertes. Si rouge :
- `login.spec.ts` : vérifie que `E2E_DIRECTOR_EMAIL` existe en base staging (sinon `scripts/pilot/seed-pilot.mjs 01`).
- `session-refresh.spec.ts` : si rouge, c'est probablement que R14 a régressé → ouvrir un ticket.
- `export-download.spec.ts` : worker doit tourner, vérifier `node apps/worker/dist/main.js`.
- `invitation-flow.spec.ts` : `EMAIL_PROVIDER=none` doit être dans la config Playwright (déjà le cas).

### Étape 1.2 — Compléter les 2 squelettes (`billing-overdue-flow.spec.ts` + `payroll-finalize-lock.spec.ts`)

**Pour `billing-overdue-flow.spec.ts`** :
- Enlever `test.skip(true, ...)` dans les 4 tests.
- Test 1 (`création facture`) : `request.post('/api/v1/billing/invoices', { ... 2 lignes ... })` → 201 + `body.total === sum(lines)`.
- Test 2 (`encaissement partiel`) : naviguer vers `/billing/invoices/:id`, cliquer « Encaisser », saisir 50 % du total, vérifier badge « Partiellement payé » + reliquat affiché.
- Test 3 (`partially_paid non éditable`) : vérifier que les boutons « Modifier » / « Supprimer » sont absents sur la ligne (R19 P3).
- Test 4 (`overdue`) : via `request.post('/api/v1/billing/invoices/:id/mark-overdue')` (director only), vérifier badge « En retard » + blocage édition.

**Pour `payroll-finalize-lock.spec.ts`** :
- Enlever `test.skip(true, ...)` dans les 3 tests.
- Test 1 : `POST /payroll/generate` puis `PATCH /payroll/entries/:id` → 200.
- Test 2 : `POST /payroll/runs/:id/finalize` → badge « Finalisé » + bouton « Éditer » absent.
- Test 3 : après finalisation, `PATCH /payroll/entries/:id/lines` → 422 avec code `PAYROLL_RUN_LOCKED` (déjà couvert par `phase62-payroll-finalized-lock.pg.test.mjs` côté DB ; cette spec valide juste l'UI).

### Étape 1.3 — Commit + push

```bash
cd apps/admin-web
npm run e2e                              # 7/7 vertes attendu
git add e2e/
git commit -m "test(s1): activer 7 specs Playwright (billing overdue + payroll finalize)"
git push origin arena/01a0c77a-cr-chedz
```

**Critère de validation** : 7/7 specs vertes en local ET dans le job `e2e` de la CI GitHub Actions.

---

## ITEM 2 — S3 : configurer l'alerting prod (2 heures)

### Pré-requis

- Accès vault (cf. `docs/OPERATIONS-SECRETS.md`)
- Compte SMTP : Mailgun / SES / Postmark — créer un sous-domaine `alerts.creche.example.dz`
- Optionnel mais recommandé : Twilio (SMS) pour les alertes critiques

### Étape 2.1 — Remplir `.env.prod` sur le VPS

```bash
ssh prod
sudo vim /etc/creche/.env.prod    # ajouter :

# Alerte e-mail (obligatoire)
ALERT_SMTP_HOST=smtp.mailgun.org
ALERT_SMTP_PORT=587
ALERT_SMTP_USER=alerts@creche.example.dz
ALERT_SMTP_PASSWORD=<du vault>
ALERT_EMAIL_FROM=Creche Alerts <alerts@creche.example.dz>
ALERT_EMAIL_TO=oncall@creche.example.dz

# Optionnels
ALERT_TWILIO_ACCOUNT_SID=<du vault>
ALERT_TWILIO_AUTH_TOKEN=<du vault>
ALERT_TWILIO_FROM=+213XXXXXXXXX
ALERT_TWILIO_TO=+213XXXXXXXXX

# Vérifier que le reste de la config alert-relay est OK
grep -E "^ALERT_" /etc/creche/.env.prod
```

Référence détaillée : `docs/PHASE_E2_ALERTING_RUNBOOK.md`.

### Étape 2.2 — Déployer + redémarrer

```bash
ssh prod
cd /opt/creche
git pull origin arena/01a0c77a-cr-chedz
docker compose -f infrastructure/docker/docker-compose.prod.yml up -d --build api worker
docker compose -f infrastructure/docker/docker-compose.prod.yml ps   # etat des services (healthcheck Docker : postgres uniquement — verif. F2)
```

### Étape 2.3 — Test synthétique (obligatoire)

**Méthode 1 — Bloquer le worker** :
```bash
ssh prod
docker compose -f infrastructure/docker/docker-compose.prod.yml stop worker
# Attendre 10 min : creche_jobs_pending doit dépasser le seuil d'alerte (50).
# Vérifier la boîte oncall@creche.example.dz → 1 email reçu en < 5 min.
docker compose -f infrastructure/docker/docker-compose.prod.yml start worker
```

**Méthode 2 — Déclenchement via API de test** (si elle existe dans la codebase) :
```bash
curl -X POST https://api.creche.example.dz/internal/test-alert \
  -H "Authorization: Bearer $TEST_ALERT_TOKEN" \
  -d '{"severity":"critical","channel":"email"}'
# Vérifier oncall@creche.example.dz en < 5 min.
```

### Étape 2.4 — Test du chemin backup-failure (déjà couvert par `phase8-backup-failure.alert.test.mjs` mais à re-vérifier en prod)

```bash
ssh prod
# Casser le backup volontairement (renommer /var/backups/creche en lecture seule)
sudo chmod 000 /var/backups/creche
sudo -u creche-backup /opt/creche/scripts/backup.sh
# → doit exit ≠ 0 + alerte email reçue.
sudo chmod 755 /var/backups/creche
```

### Étape 2.5 — Commit (juste la doc de validation)

Il n'y a pas de code à commiter (les secrets sont dans le vault). Mais il faut tracer la validation :

```bash
# Sur ta machine locale (PAS sur le VPS)
cd $REPO
cat >> docs/PHASE4-MANUAL.md << 'EOF'

## Validation S3 — alerting prod (JJ/MM/AAAA)

- [ ] SMTP configuré + testé : email reçu en _____ minutes (cible < 5 min)
- [ ] Twilio (si configuré) : SMS reçu en _____ minutes (cible < 1 min)
- [ ] Backup-failure alert testée : email reçu ✅
- [ ] `phase8-backup-failure.alert.test.mjs` : toujours vert ✅

Validé par : ____________
EOF
git add docs/PHASE4-MANUAL.md
git commit -m "docs(s3): validation alerting prod (JJ/MM/AAAA)"
git push origin arena/01a0c77a-cr-chedz
```

**Critère de validation** : alerte email reçue en < 5 min, SMS (si configuré) en < 1 min.

---

## ITEM 3 — S5 : restore drill prod (1 jour, puis mensuel)

### Pré-requis

- VPS prod accessible en SSH
- Vault (passphrase GPG + DATABASE_URL_PROD + DATABASE_URL_DRILL)
- ~30 min de downtime base — planifier hors heures de pointe (samedi matin ou dimanche soir)
- Prévenir l'équipe : canal Slack/email #incidents-prod

### Étape 3.1 — Créer la base jetable

```bash
ssh prod
sudo -u postgres psql -c "CREATE DATABASE creche_drill OWNER creche_migrator;"
export DATABASE_URL_DRILL="postgres://creche_migrator:<vault>@localhost:5432/creche_drill"
```

### Étape 3.2 — Lister les backups

```bash
ssh prod
ls -lt /var/backups/creche/daily/ | head -10
```

Référence : `docs/BACKUP-RUNBOOK.md`.

### Étape 3.3 — Restaurer le backup le plus ancien (rétention 7j)

```bash
ssh prod
BACKUP=$(ls -t /var/backups/creche/daily/*.gpg | tail -1)
echo "Restauration de $BACKUP..."
T0=$(date +%s)

gpg --batch --decrypt --passphrase "$BACKUP_PASSPHRASE" "$BACKUP" \
  | gunzip | psql "$DATABASE_URL_DRILL"

T1=$(date +%s)
echo "Durée : $((T1 - T0)) secondes"
```

### Étape 3.4 — Vérifier la cohérence

```bash
ssh prod
cd /opt/creche

# Schéma
DATABASE_URL="$DATABASE_URL_DRILL" node scripts/migrate.mjs --check
# Attendu : "✓ Aucune migration en attente" (ou au pire, migrations
# postérieures au backup listées explicitement)

# Rôles DB
DATABASE_URL="$DATABASE_URL_DRILL" node scripts/test-production-roles.mjs
# Attendu : tous les checks verts (creche_app NOSUPERUSER, NOBYPASSRLS=FALSE)

# Données applicatives minimales
psql "$DATABASE_URL_DRILL" -c "
  SELECT
    (SELECT count(*) FROM organizations) AS orgs,
    (SELECT count(*) FROM children) AS enfants,
    (SELECT count(*) FROM invoices) AS factures,
    (SELECT count(*) FROM attendance_events) AS pointages;
"
# Attendu : au moins 1 org / 5 enfants / 50 factures / 200 pointages
# (les 5 crèches pilotes sont les valeurs planchers).

# Smoke API
DATABASE_URL="$DATABASE_URL_DRILL" node -e "
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.connect().then(() => c.query('SELECT 1 AS ok')).then(r => {
    console.log('✓ DB drill joignable :', r.rows[0].ok);
    return c.end();
  });
"
```

### Étape 3.5 — Nettoyer

```bash
ssh prod
sudo -u postgres psql -c "DROP DATABASE creche_drill;"
```

### Étape 3.6 — Cron de rappel (pour les drills suivants)

```bash
ssh prod
sudo vim /etc/cron.d/creche-backup-drill
```

Ajouter :
```
# Rappel : faire un restore drill si pas eu lieu depuis 30 jours.
# Écrit un fichier /var/run/creche-last-drill quand un drill réussit
# (cf. scripts/restore-drill.sh qu'il faudra créer — voir ITEM 4).
0 9 1 * * root /opt/creche/scripts/check-restore-drill.sh
```

### Étape 3.7 — Documenter le résultat + commit

```bash
# Sur ta machine locale
cd $REPO
cat >> docs/PHASE4-MANUAL.md << 'EOF'

## Validation S5 — restore drill prod (JJ/MM/AAAA)

- [ ] Backup de référence : $BACKUP
- [ ] Durée restauration : _____ secondes (cible < 1800 s = 30 min)
- [ ] `migrate.mjs --check` : ✅ / ❌ (détail : _______)
- [ ] `test-production-roles.mjs` : ✅ / ❌
- [ ] Données applicatives : _____ orgs / _____ enfants / _____ factures / _____ pointages
- [ ] Cron de rappel installé : ✅

Validé par : ____________
Prochain drill : <JJ/MM/AAAA + 30 jours>
EOF
git add docs/PHASE4-MANUAL.md
git commit -m "docs(s5): validation restore drill prod (JJ/MM/AAAA)"
git push origin arena/01a0c77a-cr-chedz
```

**Critère de validation** :
- Restauration complète < 30 min ✅
- `migrate.mjs --check` vert ✅
- `test-production-roles.mjs` vert ✅
- Données applicatives cohérentes ✅
- Cron de rappel installé ✅

---

## Récapitulatif à renvoyer à l'opérateur principal

Une fois les 3 items validés, tu commits **un dernier patch** avec le tableau
final dans `docs/PHASE4-MANUAL.md` :

```bash
cd $REPO
# Éditer docs/PHASE4-MANUAL.md : remplacer la table « Résumé exécutif »
# par la version FINALE avec les ✅ partout + les dates de validation.
git add docs/PHASE4-MANUAL.md
git commit -m "docs(phase4): validation finale S1+S3+S5 (porte G-beyond atteinte)"
git push origin arena/01a0c77a-cr-chedz
```

**Porte G-beyond atteinte** (cf. `docs/PLAN_REMEDIATION_FINAL.md` §5) :
- ✅ S1 (E2E UI 7/7 vertes)
- ✅ S2 (Flutter épinglé, déjà auto)
- ✅ S3 (alerting prod testé)
- ✅ S4 (k6 sanity, déjà auto)
- ✅ S5 (restore drill + cron)
- ✅ S6 (audit PII, déjà auto)
- ✅ S7 (index runbooks, déjà auto)

→ **Go-live signé** : ouvrir la checklist §4 de `docs/RUNBOOKS-INDEX.md`
et cocher dans l'ordre.

---

## En cas de blocage

1. **Spec Playwright rouge** : ouvre un ticket `test:e2e-blocage` et continue avec les autres specs. L'invariant DB est déjà couvert par `tests/tenant-isolation/phase*`.
2. **SMTP non reçu** : vérifie les logs `docker logs creche-api | grep -i alert` + le runbook `PHASE_E2_ALERTING_RUNBOOK.md`.
3. **Backup restauré mais incohérent** : c'est un incident — escalade via `docs/RUNBOOK.md` §3 (« jobs bloqués » + « 5xx »).
4. **Vault inaccessible** : contacte l'OPS principal. NE PAS hardcoder de secrets dans le repo (déjà vérifié par `tests/tenant-isolation/check-secrets-leaked.test.mjs`).

---

*Ce fichier a été généré le 2026-09-22 par l'agent Arena (sandbox sans accès
prod). Il sert de passation vers l'agent Antigravity qui a les accès.*
