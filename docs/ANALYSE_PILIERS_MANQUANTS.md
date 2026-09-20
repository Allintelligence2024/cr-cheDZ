# Analyse des piliers manquants — Crèche DZ

_Date : 2026-09-19 — Branche `arena/01a0b81d-cr-chedz` (PR #46, 11/11 CI verte)._
_Objectif : identifier ce qui manque **essentiellement** à l'application pour tenir la
route comme produit, par rapport aux logiciels de crèche matures du marché —
piliers structurels d'abord, suggestions métier ensuite, classés par priorité._

## 1. Méthodologie

1. **Recherche marché** : analyse des piliers fonctionnels et opérationnels des
   logiciels de gestion de crèche/multi-accueil (marché francophone et
   international) — CrechePilot, Belami, Logiciel L&A, iNoé/Hélios/Leia, Kidizz,
   Brightwheel, Lillio (ex-HiMama), Procare, Famly.
2. **Audit du dépôt fichier par fichier** (pas de confiance aux rapports) :
   `apps/api`, `apps/worker`, `apps/admin-web`, `infrastructure/`, `scripts/`,
   `.github/workflows/`, `tests/`.

## 2. Ce que le marché considère comme piliers non négociables

Synthèse des sources ([CrechePilot](https://crechepilot.fr/),
[Belami](https://www.logiciel-belami.com/logiciel-micro-creche/),
[L&A Défi-Enfance](https://www.defi-enfance.fr/logiciel-de-gestion-des-structures-de-multi-accueil-creche/),
[comparatif Alcuin](https://alcuinfonds.be/blog/logiciel-micro-creche/),
[Kidizz](https://kidizz.com/en/logiciel-creche-gestion-communication/),
[Brightwheel](https://daycarepath.com/blog/brightwheel-childcare-software-2026-review),
[comparatif 2026](https://mybrightwheel.com/blog/childcare-management-software-comparison),
[illumine](https://illumine.app/blog/brightwheel-vs-himama-vs-procare-whats-the-right-software-for-your-childcare-center)) :

| Pilier | Détail |
|---|---|
| **Inscriptions & contrats** | Pré-inscription, liste d'attente, contrat d'accueil (semaines types, annualisation), signature |
| **Présences & ratios** | Pointage, contrôle des ratios d'encadrement en temps réel, alertes capacité |
| **Facturation** | Génération depuis les contrats/présences, paiements en ligne, **impayés & relances**, attestations fiscales |
| **Communication parents** | Journal quotidien, photos, messagerie, portail famille |
| **RH** | Planning équipe, heures, paie |
| **Conformité** | RGPD/loi locale : audit trail, consentements, droit à l'oubli, durées de conservation |
| **Socle SaaS** | Email transactionnel réel, sauvegardes + restauration testée, supervision/alerting, déploiement reproductible, applications mobiles publiables, montée en charge démontrée |

Le point le plus répété par toutes les sources : **l'intégration** — la présence
d'un enfant doit alimenter automatiquement la facturation et la communication
parents. C'est exactement ce que notre isolation multi-locataire (Gate D) et le
pipeline export/paie commencent à garantir.

## 3. Ce que nous avons déjà (vérifié dans le dépôt)

| Pilier | État | Preuve |
|---|---|---|
| Multi-tenancy RLS + rôles prod NOBYPASSRLS | ✅ SOLIDE | 57 suites d'isolation (Gate D), `scripts/test-production-roles.mjs` |
| Auth : JWT rotation, TOTP MFA, OTP SMS | ✅ | `identity/`, SMS OTP **Twilio réel** (`shared/sms/sms.service.ts`) |
| Journal, photos/vidéos, messagerie, espace parent | ✅ | modules `journal`, `media`, `video`, `messaging`, `parents` |
| Facturation, PDF, encaissements, paie | ✅ | `billing/`, `payroll/`, webhook HMAC vérifié |
| Sync mobile offline-first | ✅ | module `sync` + phases F |
| i18n français + arabe (RTL) | ✅ | `packages/i18n` |
| Conformité loi 25-11 : DPIA, consentements, purge, acteur privacy | ✅ | `privacy/`, `compliance/`, lots G |
| Déploiement : Dockerfiles × 4, compose prod/staging/dev, nginx TLS Let's Encrypt, MinIO | ✅ | `infrastructure/docker/` |
| Observabilité : Sentry (api/worker/web), Prometheus + Alertmanager + Grafana | ✅ | `infrastructure/monitoring/` |
| Sauvegarde chiffrée GPG + rétention 7 j + runbook restauration | ✅ partiel | `scripts/backup.sh`, `docs/CI-RESTORE.md` |
| CI : unitaires, isolation, e2e Playwright, images Docker, analyse Flutter, audit sécurité | ✅ | 4 workflows |

## 4. Piliers manquants ou fragiles — classés par priorité

### 🔴 P0 — Bloquant pour une mise en production — ✅ IMPLÉMENTÉ (2026-09-19)

| # | Pilier | Constat vérifié | Correction livrée |
|---|---|---|---|
| P0-1 | **Email transactionnel réel** | `shared/email/email.service.ts` : simulation dev uniquement ; en production les invitations renvoient **503 INVITATION_DELIVERY_UNAVAILABLE** → l'onboarding d'une crèche est impossible hors dev. Le SMS OTP (Twilio) est réel, mais invitations, reçus de paiement, alertes impayés n'ont aucun canal. | `EMAIL_PROVIDER=smtp` livre réellement via nodemailer (pool, timeouts 5/10/15 s, 3 tentatives backoff 500 ms/2 s). Fail-closed : config incomplète → 503 avant écriture ; échec d'envoi → 502 `EMAIL_DELIVERY_FAILED` (jamais de jeton exposé). Templates bilingues FR/AR : invitation (lien `/accept-invitation`, validité 7 j) + reçu de paiement (envoyé best-effort au tuteur `is_primary`, jamais bloquant pour l'encaissement). 11 tests unitaires ; phase47 (G1c, 38 cas) rejouée verte avec rôles de production. |
| P0-2 | **Sauvegardes planifiées + hors site + restauration prouvée** | `backup.sh` existait (GPG, rétention 7 j) mais **manuel, local, sans planification ni copie hors site** ; la restauration n'était testée que par runbook. | `backup.sh` : empreinte SHA-256 + copie hors site `BACKUP_OFFSITE_DIR` + rétention alignée. Nouveau `scripts/restore-drill.mjs` : backup réel → sha256 → **preuve de chiffrement** (mauvaise passphrase refusée) → restauration pipeline runbook (gpg→gunzip→psql) dans une base dédiée → comparaison source/restauré (12 tables, politiques RLS, fonctions SECURITY DEFINER) → nettoyage ; garde-fou base `*_test`. Job CI **`backup-drill` sur chaque push**. Runbook enrichi (cron + hors site rclone/S3 + drill). |

### 🟠 P1 — Indispensables juste après la mise en prod

| # | Pilier | Constat vérifié | Recommandation | Effort |
|---|---|---|---|---|
| P1-1 | **Paiement en ligne effectif (SATIM CIB/Edahabia)** | `payment-provider.service.ts` : adaptateur SATIM propre (503 si non configuré, webhook HMAC) mais **jamais exercé contre la sandbox réelle du PSP** — cœur du marché DZ. | Compte marchand sandbox SATIM, scénarios complets (init → redirect → webhook → réconciliation), journal de rapprochement, doc d'enrôlement marchand. Dépendance externe (contrat SATIM). | **M** |
| P1-2 | **Applications mobiles publiablement compilées** | `flutter.yml` ne fait qu'analyser ; les apps Dart ne sont **jamais compilées** (Android/iOS), pas de keystore, pas de fiche Play Store. Tout le travail sync/OTP/médias est invérifiable sur appareil. | CI `flutter build apk/appbundle` (et ipa quand un compte Apple existe), gestion des signatures, smoke-test sur émulateur CI, fiche store + captures. | **M** |
| P1-3 ✅ (2026-09-20) | **Tests de charge / capacité** | Aucun test de charge exécutable (le `sync.k6.js` n'a jamais tourné : k6 absent, aucun outil de charge dans le dépôt). | Scénario réaliste reproductible, budgets p95, exécution pré-release. | **S-M** — **FAIT** (`npm run test:capacity`, `tests/load/capacity-bench.mjs`, Node pur sans k6) : 12 structures simultanées × 15 enfants × 2 appareils sync, 456 requêtes (login en rafale, check-in, `POST /sync/push` 20 ops, feed, dashboard), rôle applicatif NOBYPASSRLS, refus hors base `*_test`, rapport `capacity-report.json`, nettoyage complet. **Mesure (2 vCPU, PG local) : 0 erreur, 1920/1920 événements persistés ; p95 login 2,3 s · check-in 0,1 s · sync push 2,3 s · feed 1,2 s · dashboard 1,2 s.** Budgets = cliquet (+25 %), pas objectifs produit. **Goulot identifié : `bcryptjs` cost 12 = ~320 ms CPU par comparaison, bloque l'event loop** — 24 logins concurrents gonflent toutes les latences (feed 7 ms seul → 1,1 s sous rafale ; avec `NO_BURST_LOGIN=1` : feed 200 ms, dashboard 214 ms, push 1,16 s). Pistes (hors lot, aucune baisse du coût en prod) : hash natif hors event loop (`argon2` mesuré 96 ms/verif et 24 concurrents en 2,3 s vs 7,5 s bcryptjs) ou worker thread ; `sync push` traite ses ops séquentiellement, chacune dans sa connexion tenant (`sync.service.ts`) → batcher dans une transaction. Reste à faire : exports xlsx concurrents et worker sous backlog non couverts.
| P1-4 ✅ (2026-09-20) | **Couverture de tests mesurée** | Les suites sont fortes (Gate D, e2e) mais `jest --coverage`/seuils **absents de toute la config** — aucun garde-fou chiffré contre l'érosion. | Couverture + seuils par module dans le job `quality`, rapport publié en artifact. | **S** (1 j) — **FAIT** : `jest --coverage` sur tout `src/` (chiffre global honnête ~6,6 % : la vérification repose sur Gate D + e2e), seuils-cliquets par unité de sécurité/argent (tenant-context 95/90, principal-epoch 95/90, totp-crypto 95/80, email 80/60, payment-provider 90/60, receipt 100/100) + plancher global, rapport `api-coverage` en artifact du job `quality`. +20 tests (contrat RLS de `withTenantConnection`, contrat G4 d'époque). |

### 🟡 P2 — Lacunes structurelles du périmètre métier (vs marché)

Ce ne sont pas des gadgets : chaque point ci-dessous est un pilier facturé par
tous les concurrents étudiés. À planifier dans cet ordre :

| # | Pilier manquant | Pourquoi c'est un pilier | Effort |
|---|---|---|---|
| P2-1 ✅ (2026-09-20) | **Ratios d'encadrement & capacité en temps réel** | Sécurité des enfants + conformité d'agrément : argument de vente n°1 pour les directrices. | **FAIT** — `attendance/ratios.service.ts` : par salle active, enfants **présents** (`attendance_sessions.status='present'`, jour d'Alger) × éducateurs encadrants (`staff_assignments` actives × `staff_profiles.qualification` educator_qualified/director/nurse) ; si l'établissement pointe son personnel ce jour (`staff_attendance.check_in`), la base devient `on_duty` (éducateurs effectivement pointés, non sortis), sinon `assigned`. Seuils lus dans la règle **RATIO_EDUC** du jeu actif (≤ 10 enfants/éduc, ≥ 2 éduc — jamais codés en dur). Statuts `empty/ok/warning/breach` + `reasons` (CAPACITY_EXCEEDED, NO_EDUCATOR, RATIO_EXCEEDED, MIN_EDUCATORS, NEAR_LIMIT ≥ 90 %) + `headroom` (« combien puis-je encore accueillir ? »). `GET /attendance/ratios` (staff), `dashboard/summary` → `ratios[]` + `alerts.ratio_breaches`. Au **check-in**, le ratio de la salle est recalculé dans la même transaction et renvoyé (`ratio`) : l'accueil n'est **jamais bloqué** (l'enfant est physiquement là) mais un franchissement est tracé une seule fois par salle et par jour dans `compliance_checks` (`checked_by='realtime'`, `result='fail'`). Gate **phase58** (ratios + attestations, 40 cas). Hors périmètre : notifications push aux directrices (le canal P0 email existe, à brancher si demandé), ratios par tranche d'âge (règle RATIO_EDUC unique). | **M** |
| P2-2 | **Contrats d'accueil (semaines types, annualisation)** | Absents — la facturation chez les concurrents est **générée depuis le contrat + les présences** ; sans contrat, la facturation reste manuelle et l'offre n'est pas crédible face à L&A/Balami. | **L** |
| P2-3 ✅ (2026-09-20) | **Impayés & relances** | `invoice_status` avait `'overdue'` depuis 001 mais **aucun code ne l'écrivait** ; aucune facture ne sortait de `draft` par l'API (le tableau de bord n'affichait donc jamais d'impayé réel) ; aucune trace de relance. | **FAIT** — migration 068 : table `invoice_reminders` (1 ligne par niveau 1→3 et par facture, RLS forcée) + `invoices_mark_overdue(org)` (SECURITY INVOKER, transition `sent/partially_paid → overdue` à l'échéance, date d'Alger, appliquée **à la lecture** : aucun job planifié requis, `scheduler_ticks` inchangé). API : `POST /billing/invoices/:id/send` (draft→sent, 409 si déjà émise), `GET /billing/invoices/aged-balance` (balance âgée 0-30/31-60/61-90/90+, totaux, dernier niveau de relance), `POST/GET /billing/invoices/:id/reminders` (email **fail-closed** via P0-1 : 503 sans transport, 502 si échec, et la relance n'est enregistrée que si l'envoi a réussi — même transaction ; ou `manual` avec notes obligatoires ; séquence 1→2→3 stricte, destinataire = tuteur `can_receive_invoices` puis `is_primary`). Template bilingue FR/AR 3 niveaux. Gate **phase57** (38 cas, SMTP réel éphémère : transmission prouvée, panne SMTP → 0 ligne, isolation A/B, RLS, paiement soldant) + 6 tests unitaires. Hors périmètre : suspension automatique, pénalités de retard, relances planifiées (décision client : 3 traitements automatiques figés en 056). | **S-M** |
| P2-4 | **Pré-inscriptions & liste d'attente** | Pilier d'acquisition (L&A, LineLeader) ; très demandé par les collectivités. | **M** |
| P2-5 | **Planning du personnel** (`staff.service.ts` sans planning) | Pilier RH des concurrents ; complète notre module paie existant. | **M-L** |
| P2-6 ✅ (2026-09-20) | **Attestations (frais de garde / présence)** | Équivalent local des attestations fiscales CAF. | **FAIT** — migration 069 : table `attestations` (RLS forcée, `UNIQUE(org, attestation_number)`, **immuable** : trigger `ATTESTATION_IMMUTABLE` sur UPDATE/DELETE, `total_paid ≤ total_invoiced`). Photo figée à l'émission : factures de l'année (statut ≠ draft/cancelled), montants facturés/réglés, jours de présence (present/departed), période min/max, tuteur `can_receive_invoices` sinon primaire ; numéro `ATT-<année>-<séquence org>` ; 422 `ATTESTATION_EMPTY` si rien à attester ; ré-émission = nouveau numéro, l'ancienne conserve ses chiffres. PDF bilingue FR/AR généré côté API à la demande (pdfkit + Noto Naskh Arabic, même police que le worker ; bloc arabe avec valeurs latines sur colonnes séparées pour éviter l'inversion des chiffres), consultation journalisée dans `data_access_logs` (`attestation_pdf`). API : `POST/GET /attestations`, `GET /attestations/:id/pdf` (director/accountant) ; `GET /parent/attestations`, `GET /parent/attestations/:id/pdf` (parent facturable uniquement, 403 sinon). Décision : générée côté API plutôt que via le worker `exports` (document unitaire, immédiat, pas de job). Gate **phase58**. | **S** |

### 🟢 P3 — Durcissement & crédibilité produit (moyen terme)

| # | Pilier | Note | Effort |
|---|---|---|---|
| P3-1 | Accessibilité WCAG/RGAA de l'admin-web | Aucun audit ; les marchés publics (crèches municipales) l'exigent de plus en plus. | **M** |
| P3-2 | Sonde uptime externe → Alertmanager | La stack d'alerting existe mais la surveillance externe (qui surveille le moniteur ?) n'est pas matérialisée. | **S** |
| P3-3 | CGU / politique de confidentialité parents affichées | Le juridique loi 25-11 est traité côté données ; les textes contractuels utilisateurs restent à formaliser. | **S** |
| P3-4 | Signature électronique des contrats/autorisations | Mentionné par CrechePilot ; devient standard. À coupler à P2-2. | **M** |

## 5. Roadmap recommandée

1. ~~**Immédiat (P0)**~~ ✅ **Livré** : email transactionnel SMTP + drill de
   restauration automatisé en CI + copie hors site. La mise en production
   d'une vraie crèche est défendable sur ces deux volets.
2. **Fenêtre de lancement (P1, ≈ 2-4 semaines en parallèle des démarches
   SATIM/compte marchand)** : sandbox paiement, builds mobiles CI, charge,
   couverture.
3. **Trimestre 1 produit (P2)** : ratios d'encadrement (P2-1) puis contrats
   (P2-2) et impayés (P2-3) — c'est ce trio qui fait passer l'application du
   statut « portail parents + caisse » au statut « logiciel de gestion de
   crèche » comparable au marché.
4. **En continu (P3)** : accessibilité, uptime externe, textes légaux.

> Principe directeur conservé : chaque pilier ajouté doit respecter l'isolation
> RLS existante (nouvelle suite d'isolation par module) et la loi 25-11 —
> c'est l'avantage compétitif déjà démontré par le Gate D.
