# RUNBOOKS-INDEX — Ordre de lecture & porte d'entrée (Phase 4 / S7)

> **G-beyond / S7 (remédiation 2026-09-21, Phase 4)** — index des 31 runbooks
> existants (`docs/PHASE_*_RUNBOOK.md`, `BACKUP-RUNBOOK`, `PRIVACY_ERASURE`).
> **Ce qu'il ne faut PAS faire** : créer un nouveau runbook. Il y en a déjà 31
> (cf. §6 du `PLAN_REMEDIATION_FINAL.md`) — le manque est une **page d'index**,
> pas un doublon.
>
> **Pourquoi cette page existe** : un nouvel opérateur qui ouvre `docs/` voit
> 50+ fichiers `.md` sans hiérarchie. Ce fichier est son plan de lecture.

---

## 1. Ordre de lecture (le « happy path » d'un opérateur)

```
HANDOFF                          (vision + portes G-*)
  └→ LOCAL-RUN                   (clone → testable en < 30 min, G-local)
       └→ CI-RESTORE             (si le CI échoue à cause de la DB)
            └→ RUNBOOKS-INDEX    (cette page)
                 └→ [Phase]      (D, E, F, G, H — voir §3 ci-dessous)
                      └→ RUNBOOK (runbook générique Phase 11 — alertes, deploy, restore)
                           └→ OPERATIONS-BACKUP (rétention 7j/30j, R9)
                                └→ OPERATIONS-FIREWALL (allowlist /support, R8)
                                     └→ PRIVACY_ERASURE_RUNBOOK (loi 25-11)
                                          └→ BACKUP-RUNBOOK (drill mensuel)
```

**Lecture rapide** : si tu n'as que 10 minutes, lis **HANDOFF** + ce fichier.
Si tu as 1 heure : ajoute **LOCAL-RUN** + **RUNBOOK**.
Si tu as 1 jour : ajoute la phase correspondant à ton incident.

---

## 2. Qui est qui — qui ouvre quoi

| Rôle | Lis d'abord | Lis en cas d'incident |
|---|---|---|
| **Nouvel opérateur on-call** | HANDOFF → LOCAL-RUN → ce fichier | RUNBOOK §3 (incidents connus) |
| **Dev qui prend une alerte 5xx** | RUNBOOK §3 | PHASE_E2_ALERTING_RUNBOOK |
| **Dev qui touche la DB / migrations** | PHASE_D_ROLES_RUNBOOK | CI-RESTORE |
| **Dev qui touche le worker / scheduler** | PHASE_E_WORKER_RUNBOOK | PHASE_H2J_METRICS_RUNBOOK |
| **DPO / conformité loi 25-11** | PRIVACY_ERASURE_RUNBOOK | PHASE_G3_DPIA_RUNBOOK |
| **Securité (revoke principal, MFA)** | PHASE_G4_PRINCIPAL_REVOCATION_RUNBOOK | PHASE_G5_MFA_RUNBOOK |
| **Pilote (suivi 5 crèches démo)** | PILOT-PROTOCOL | CHECKLIST_PILOTE |

---

## 3. Catalogue par phase (ordre numérique D → H)

### PHASE_D — Rôles DB (1 runbook)

| Runbook | Quand l'ouvrir |
|---|---|
| [PHASE_D_ROLES_RUNBOOK](./PHASE_D_ROLES_RUNBOOK.md) | Création/audit des rôles `creche_app`/`creche_migrator` (ADR-011) — gate obligatoire avant tout test avec données réalistes. |

### PHASE_E — Worker + Alerting (2 runbooks)

| Runbook | Quand l'ouvrir |
|---|---|
| [PHASE_E_WORKER_RUNBOOK](./PHASE_E_WORKER_RUNBOOK.md) | Job bloqué en `pending`, scheduler HS, lease expirée, FOR UPDATE SKIP LOCKED (R12). |
| [PHASE_E2_ALERTING_RUNBOOK](./PHASE_E2_ALERTING_RUNBOOK.md) | Configurer `ALERT_SMTP_*` / Twilio / webhook (S3 Phase 4) ; tester une alerte synthétique. |

### PHASE_F — Sync & API (5 runbooks)

| Runbook | Quand l'ouvrir |
|---|---|
| [PHASE_F2_CLIENT_RUNBOOK](./PHASE_F2_CLIENT_RUNBOOK.md) | Client API Flutter (généré vs. manuel, gate F4 — R16) |
| [PHASE_F3A_OUTCOMES_RUNBOOK](./PHASE_F3A_OUTCOMES_RUNBOOK.md) | Endpoint outcomes (pointages) |
| [PHASE_F3B_CHILDREN_RUNBOOK](./PHASE_F3B_CHILDREN_RUNBOOK.md) | Endpoint enfants + RLS |
| [PHASE_F3C_F4_RUNBOOK](./PHASE_F3C_F4_RUNBOOK.md) | Sync engine, curseurs, ADR-008 |
| [PHASE_F_COMPLETION_H1_RUNBOOK](./PHASE_F_COMPLETION_H1_RUNBOOK.md) | Synthèse Phase F → H1 |
| [PHASE_F_SYNC_DIAGNOSTIC](./PHASE_F_SYNC_DIAGNOSTIC.md) | Diagnostic quand le sync dérive (devices en retard, replay) |

### PHASE_G — Auth & Sécurité (8 runbooks)

| Runbook | Quand l'ouvrir |
|---|---|
| [PHASE_G1_AUTH_RUNBOOK](./PHASE_G1_AUTH_RUNBOOK.md) | Vue d'ensemble auth (JWT, login, refresh, cookies httpOnly — R14) |
| [PHASE_G1B_REFRESH_RUNBOOK](./PHASE_G1B_REFRESH_RUNBOOK.md) | Refresh tokens, rotation, révocation |
| [PHASE_G1C_INVITATIONS_RUNBOOK](./PHASE_G1C_INVITATIONS_RUNBOOK.md) | Invitations email + token signé |
| [PHASE_G1D_TOTP_RUNBOOK](./PHASE_G1D_TOTP_RUNBOOK.md) | TOTP MFA (R2) |
| [PHASE_G2_RLS_INTEGRITY_RUNBOOK](./PHASE_G2_RLS_INTEGRITY_RUNBOOK.md) | Audit RLS par catalogue, `db:check-rls`, `db:check-rls-usage` |
| [PHASE_G3_DPIA_RUNBOOK](./PHASE_G3_DPIA_RUNBOOK.md) | DPIA vidéosurveillance |
| [PHASE_G4_PRINCIPAL_REVOCATION_RUNBOOK](./PHASE_G4_PRINCIPAL_REVOCATION_RUNBOOK.md) | Révoquer un principal (epoch token, garde G4) |
| [PHASE_G5_MFA_RUNBOOK](./PHASE_G5_MFA_RUNBOOK.md) | Politique MFA (qui/quand/combien), exemptions |

### PHASE_H — Métier & conformité (12 runbooks)

| Runbook | Quand l'ouvrir |
|---|---|
| [PHASE_H1_DEV_RUNBOOK](./PHASE_H1_DEV_RUNBOOK.md) | Onboarding dev (env local, secrets, outils) |
| [PHASE_H2_CONFIDENTIALITY_RUNBOOK](./PHASE_H2_CONFIDENTIALITY_RUNBOOK.md) | Vue d'ensemble conformité 25-11 |
| [PHASE_H2B_NOTIFICATION_RUNBOOK](./PHASE_H2B_NOTIFICATION_RUNBOOK.md) | Notifications (FCM/APNs/email/SMS), échec PUSH_NOT_CONFIGURED |
| [PHASE_H2C_PARENT_ACCESS_RUNBOOK](./PHASE_H2C_PARENT_ACCESS_RUNBOOK.md) | Espace parent (auth séparée, R5) |
| [PHASE_H2D_FINANCIAL_PROJECTION_RUNBOOK](./PHASE_H2D_FINANCIAL_PROJECTION_RUNBOOK.md) | Projections financières, facturation |
| [PHASE_H2E_JOURNAL_HEALTH_RUNBOOK](./PHASE_H2E_JOURNAL_HEALTH_RUNBOOK.md) | Santé du journal de bord (entrées/photos) |
| [PHASE_H2F_PRIVACY_ACTOR_RUNBOOK](./PHASE_H2F_PRIVACY_ACTOR_RUNBOOK.md) | Acteurs de la confidentialité (DPO, RT, etc.) |
| [PHASE_H2G_PHOTO_CONSENT_RUNBOOK](./PHASE_H2G_PHOTO_CONSENT_RUNBOOK.md) | Consentement photos (mineurs, retrait) |
| [PHASE_H2H_STAFF_DOCUMENT_RUNBOOK](./PHASE_H2H_STAFF_DOCUMENT_RUNBOOK.md) | Documents staff (contrats, visites médicales) |
| [PHASE_H2I_STORAGE_SELECTION_RUNBOOK](./PHASE_H2I_STORAGE_SELECTION_RUNBOOK.md) | Choix du backend stockage (local / S3 / MinIO — R3) |
| [PHASE_H2J_METRICS_RUNBOOK](./PHASE_H2J_METRICS_RUNBOOK.md) | Endpoint `/api/v1/metrics` Prometheus |
| [PHASE_H2L_ANONYMIZATION_RUNBOOK](./PHASE_H2L_ANONYMIZATION_RUNBOOK.md) | Anonymisation R6 (`fn_anonymize_child` remplacement) |

### Transverse

| Runbook | Quand l'ouvrir |
|---|---|
| [HANDOFF](./HANDOFF.md) | **Point d'entrée n°1** — vision globale + portes G-* |
| [LOCAL-RUN](./LOCAL-RUN.md) | Clone frais → testable en < 30 min (G-local) |
| [RUNBOOK](./RUNBOOK.md) | Procédures génériques (deploy, restore, incidents) |
| [BACKUP-RUNBOOK](./BACKUP-RUNBOOK.md) | Sauvegardes chiffrées + drill mensuel (R9) |
| [CI-RESTORE](./CI-RESTORE.md) | Restaurer un dump de prod en CI (test de cohérence) |
| [PRIVACY_ERASURE_RUNBOOK](./PRIVACY_ERASURE_RUNBOOK.md) | Droit à l'effacement (loi 25-11) |
| [OPERATIONS-BACKUP](./OPERATIONS-BACKUP.md) | Rétention 7j local / 30j offsite + coût S3 (R9) |
| [OPERATIONS-FIREWALL](./OPERATIONS-FIREWALL.md) | Allowlist `/support/` (R8) |
| [OPERATIONS-SECRETS](./OPERATIONS-SECRETS.md) | Hiérarchie des secrets (vault, `.env`, prod) |
| [PILOT-PROTOCOL](./PILOT-PROTOCOL.md) | Suivi des 5 crèches pilotes |

---

## 4. Ordre de go-live (la checklist du premier deploy)

À exécuter dans l'ordre — toute inversion crée un trou de sécurité ou une
erreur de schéma difficile à diagnostiquer.

```
 1. infra        — VPS, DNS, nginx, SSL, firewall (cf. OPERATIONS-FIREWALL)
 2. roles DB     — creche_migrator + creche_app (cf. PHASE_D_ROLES_RUNBOOK)
 3. migrate      — node scripts/migrate.mjs (75 migrations)
 4. seed         — node scripts/seed.mjs (14 seeds, idempotent)
 5. secrets      — .env.prod depuis .env.prod.example (cf. OPERATIONS-SECRETS)
 6. api/worker   — docker compose up (build des images)
 7. nginx        — recharger la conf + tester /health
 8. smoke        — un login, un pointage, une photo (cf. LOCAL-RUN §7)
 9. backup       — premier backup GPG + push offsite (cf. OPERATIONS-BACKUP)
10. alerting     — alerte synthétique testée (cf. PHASE_E2_ALERTING_RUNBOOK)
11. pilot        — 5 crèches de démo (cf. PILOT-PROTOCOL)
```

> **Piège classique** : appliquer `seed` avant `migrate` (échoue avec
> « relation does not exist ») ou lancer l'API avant les rôles DB (échoue
> avec « MIGRATION_ROLE_UNSAFE »).

---

## 5. Conventions de nommage des runbooks

| Préfixe | Signification |
|---|---|
| `PHASE_D_*` | Rôles DB (création, audit) |
| `PHASE_E_*` | Worker + alerting |
| `PHASE_F_*` | Sync engine, API Flutter |
| `PHASE_G*` | Authentification, autorisation, sécurité |
| `PHASE_H1_*` | Onboarding dev |
| `PHASE_H2[letter]_*` | Métier & conformité (B=notif, C=parent, D=finance, etc.) |
| `OPERATIONS-*` | Procédures transverses (backup, firewall, secrets) |
| `BACKUP-RUNBOOK` | Procédure de restauration complète |
| `CI-RESTORE` | Restauration pour les tests CI |
| `PILOT-*` | Suivi des 5 crèches pilotes |

Les fichiers **sans** préfixe (`HANDOFF`, `LOCAL-RUN`, `RUNBOOK`, `ROADMAP_V2`,
`PRIVACY_ERASURE_RUNBOOK`) sont des **documents chapeau** — à lire en premier.

---

## 6. Quand AJOUTER un nouveau runbook (et quand NON)

**Ajouter un runbook** quand :
- Une nouvelle catégorie émerge (ex. nouveau module métier « cantine »).
- Une procédure externe change (ex. migration d'un fournisseur SMS).
- Un incident se reproduit 3 fois sans procédure écrite.

**NE PAS ajouter** quand :
- C'est un one-shot (un commit suffit avec un message détaillé).
- Le contenu tient en 5 lignes → intégrer au runbook chapeau `RUNBOOK`.
- Ça fait doublon avec un runbook existant → ajouter une section dans le
  runbook concerné + une ligne dans ce fichier.

> **Garde-fou** : chaque runbook ajouté DOIT avoir une entrée dans ce fichier.
> Sans entrée ici, il est invisible — autant ne pas l'écrire.

---

## 7. Statistiques (2026-09-22)

| Catégorie | Nombre |
|---|---|
| PHASE_D | 1 |
| PHASE_E | 2 |
| PHASE_F | 5 (+ 1 diagnostic, 1 synthèse = 7 fichiers) |
| PHASE_G | 8 |
| PHASE_H | 12 |
| Transverse (HANDOFF, RUNBOOK, etc.) | 10 |
| **Total référencé** | **~38 fichiers `*RUNBOOK*` + 5 chapeau** |

Vérification automatique : `ls docs/PHASE_*_RUNBOOK.md docs/*RUNBOOK*.md docs/HANDOFF.md docs/LOCAL-RUN.md docs/RUNBOOK.md docs/PILOT-PROTOCOL.md | wc -l`
doit retourner le même ordre de grandeur (±2) que la table §3.

---

*Mainteneur* : ce fichier évolue avec chaque nouveau runbook. PR qui ajoute un
runbook sans toucher ce fichier = rejetée en review.
