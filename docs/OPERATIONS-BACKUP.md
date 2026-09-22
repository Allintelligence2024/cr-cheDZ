# OPERATIONS-BACKUP — Politique de sauvegarde (R9, remédiation 2026-09-21)

> Sauvegarder n'est pas restaurer. Ce runbook fixe la politique et l'horloge
> de l'exercice drill, indispensable avant pilote et avant chaque mise en prod.

## 1. Pipeline (déjà en place)

`scripts/backup.sh` (69 lignes) couvre tout le flux :

```
DATABASE_URL=... BACKUP_PASSPHRASE=... ./scripts/backup.sh
```

Étapes :
1. `pg_dump --no-owner --no-privileges | gzip -9 | gpg --symmetric AES256`
2. Somme SHA-256 dans `$OUT.sha256`
3. **Copie hors site** si `BACKUP_OFFSITE_DIR` est défini (rclone/s3fs/NFS
   vers stockage distant — incendie VPS = perte des deux à la fois)
4. Rétention `KEEP_DAYS` (défaut 7) sur local + offsite

Codes de sortie : `set -euo pipefail` → toute étape qui échoue stoppe le
script avec code ≠ 0. Docker compose (cf. `infrastructure/docker/docker-compose.prod.yml`,
service `backup`) intercepte le code de sortie du conteneur et l'expose
via `docker inspect`. L'alerte se branche via `alert-relay` (cf. PHASE_E2)
en surveillant l'âge du dernier artefact.

## 2. Rétention (R9)

| Couche | Durée | Justification |
|---|---|---|
| Local (`BACKUP_DIR/daily/`) | 7 jours | Couvre une mauvaise manip + rétention hebdomadaire |
| Offsite (`BACKUP_OFFSITE_DIR/daily/`) | **30 jours** | Loi 25-11 art. 17 : preuve opposable pendant la durée du litige (typ. 5 ans pour les données financières, mais une fenêtre 30 j permet la détection tardive d'un sinistre silencieux type ransomware) |

Justification 7j/30j séparés : on garde **plus longtemps** hors site car
le coût de stockage y est marginal (object storage S3/B2 ≈ 0,02 €/Go/mois)
alors que le coût opérationnel local (EBS, monitoring) est plus élevé.

## 3. Exercice restore (R9 / S5)

`scripts/restore-drill.mjs` (194 lignes) joue la chaîne complète :

```
1. backup.sh            → archive chiffrée + SHA-256
2. Vérif SHA-256        → intégrité avant tout
3. gpg --decrypt | gunzip | psql   → restauration sur cluster jetable
4. SELECT COUNT(*)      → preuve que les tables sont non vides
5. pg_dump --schema-only → comparaison source/restaure (lignes, RLS, fonctions)
6. Refus si passphrase incorrecte   → preuve que le chiffrement est réel
```

**Cadence** :
- **CI** : à chaque push (job `backup-drill` sur PG18). Vrai signal, pas
  un feu vert de complaisance — le drill échoue si la moindre migration
  n'est pas compatible avec la restauration.
- **VPS production** : **mensuel** (rituel à automatiser via cron +
  `alert-relay`). C'est le S5 du plan de remédiation finale.

## 4. Vérification pré-pilote (porte G-local, gate go/no-go)

Checklist avant d'ouvrir un premier tenant pilote :

- [ ] `scripts/backup.sh` s'exécute sans erreur en < 5 min sur la cible
- [ ] `BACKUP_OFFSITE_DIR` est défini ET monté (test `ls` quotidien)
- [ ] `scripts/restore-drill.mjs` vert **2 fois consécutives** (la 2e par
      une personne différente de l'auteur du backup — critère
      `BACKUP-RUNBOOK.md`)
- [ ] Alerte `BACKUP_STALE` (artifact > 25 h) câblée dans `alert-relay`
- [ ] Runbook lu + signé par l'opérateur d'astreinte

## 5. Rotation des secrets

`BACKUP_PASSPHRASE` est **indépendant** de `JWT_SECRET`, `PAYMENT_WEBHOOK_SECRET`,
`TOTP_ENCRYPTION_KEY`, etc. — un secret par usage. Rotation annuelle OU
immédiate sur suspicion de compromission (même procédure que pour les autres
secrets : `OPERATIONS-SECRETS.md`).

## 6. Liens

- `scripts/backup.sh` : pipeline principal.
- `scripts/restore-drill.mjs` : preuve d'exploitabilité (CI + VPS).
- `docs/BACKUP-RUNBOOK.md` : restauration réelle + Upgrade PG16→18.
- `docs/PHASE_E2_ALERTING_RUNBOOK.md` : branchement `BACKUP_STALE`.
- `infrastructure/docker/docker-compose.prod.yml` : service `backup`.
