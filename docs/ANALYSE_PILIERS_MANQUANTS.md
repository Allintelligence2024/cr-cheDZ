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

### 🔴 P0 — Bloquant pour une mise en production

| # | Pilier | Constat vérifié | Recommandation | Effort |
|---|---|---|---|---|
| P0-1 | **Email transactionnel réel** | `shared/email/email.service.ts` : simulation dev uniquement ; en production les invitations renvoient **503 INVITATION_DELIVERY_UNAVAILABLE** → l'onboarding d'une crèche est impossible hors dev. Le SMS OTP (Twilio) est réel, mais invitations, reçus de paiement, alertes impayés n'ont aucun canal. | Fournisseur SMTP transactionnel (nodemailer ou Resend/Postmark/Brevo) derrière le même `EmailService`, templates invitation/reçu/OTP email, flag `EMAIL_PROVIDER`, file de retries via le worker, tests d'intégration. | **S** (≈ 3-5 j) |
| P0-2 | **Sauvegardes planifiées + hors site + restauration prouvée** | `backup.sh` existe (GPG, rétention 7 j) mais **manuel, local, sans planification ni copie hors site** ; la restauration n'est testée que par runbook. | Cron/CI quotidien : dump chiffré → upload objet hors site (S3/MinIO distant), rétention 30 j, et **test de restauration automatique hebdomadaire** dans un conteneur jetable (le squelette `test-staging-stack.mjs` existe déjà). | **S** (≈ 2-3 j) |

### 🟠 P1 — Indispensables juste après la mise en prod

| # | Pilier | Constat vérifié | Recommandation | Effort |
|---|---|---|---|---|
| P1-1 | **Paiement en ligne effectif (SATIM CIB/Edahabia)** | `payment-provider.service.ts` : adaptateur SATIM propre (503 si non configuré, webhook HMAC) mais **jamais exercé contre la sandbox réelle du PSP** — cœur du marché DZ. | Compte marchand sandbox SATIM, scénarios complets (init → redirect → webhook → réconciliation), journal de rapprochement, doc d'enrôlement marchand. Dépendance externe (contrat SATIM). | **M** |
| P1-2 | **Applications mobiles publiablement compilées** | `flutter.yml` ne fait qu'analyser ; les apps Dart ne sont **jamais compilées** (Android/iOS), pas de keystore, pas de fiche Play Store. Tout le travail sync/OTP/médias est invérifiable sur appareil. | CI `flutter build apk/appbundle` (et ipa quand un compte Apple existe), gestion des signatures, smoke-test sur émulateur CI, fiche store + captures. | **M** |
| P1-3 | **Tests de charge / capacité** | Aucun test de charge nulle part ; comportement à 50-500 structures inconnu (sync bulk, exports xlsx, worker unique). | k6 ou Artillery : scénario réaliste (login × N, sync, exports concurrents, worker sous backlog), budgets p95, exécution nocturne ou pré-release. Identifier si le worker doit passer multi-instance. | **S-M** |
| P1-4 | **Couverture de tests mesurée** | Les suites sont fortes (Gate D, e2e) mais `jest --coverage`/seuils **absents de toute la config** — aucun garde-fou chiffré contre l'érosion. | Couverture + seuils par module dans le job `quality`, rapport publié en artifact. | **S** (1 j) |

### 🟡 P2 — Lacunes structurelles du périmètre métier (vs marché)

Ce ne sont pas des gadgets : chaque point ci-dessous est un pilier facturé par
tous les concurrents étudiés. À planifier dans cet ordre :

| # | Pilier manquant | Pourquoi c'est un pilier | Effort |
|---|---|---|---|
| P2-1 | **Ratios d'encadrement & capacité en temps réel** (`attendance.service.ts` n'en contient aucun) | Sécurité des enfants + conformité d'agrément : CrechePilot vérifie les ratios PMI à chaque déplacement de créneau ; Brightwheel affiche les ratios temps réel avec alertes. Alerting si ratio franchi = argument de vente n°1 pour les directrices. | **M** |
| P2-2 | **Contrats d'accueil (semaines types, annualisation)** | Absents — la facturation chez les concurrents est **générée depuis le contrat + les présences** ; sans contrat, la facturation reste manuelle et l'offre n'est pas crédible face à L&A/Balami. | **L** |
| P2-3 | **Impayés & relances automatiques** (rien dans `billing.service.ts`) | Journal des impayés + relances = module central chez Belami/L&A/Procare ; se branche directement sur P0-1 (email). | **S-M** |
| P2-4 | **Pré-inscriptions & liste d'attente** | Pilier d'acquisition (L&A, LineLeader) ; très demandé par les collectivités. | **M** |
| P2-5 | **Planning du personnel** (`staff.service.ts` sans planning) | Pilier RH des concurrents ; complète notre module paie existant. | **M-L** |
| P2-6 | **Attestations (frais de garde / présence)** | Équivalent local des attestations fiscales CAF ; le module `exports` peut les porter à moindre coût. | **S** |

### 🟢 P3 — Durcissement & crédibilité produit (moyen terme)

| # | Pilier | Note | Effort |
|---|---|---|---|
| P3-1 | Accessibilité WCAG/RGAA de l'admin-web | Aucun audit ; les marchés publics (crèches municipales) l'exigent de plus en plus. | **M** |
| P3-2 | Sonde uptime externe → Alertmanager | La stack d'alerting existe mais la surveillance externe (qui surveille le moniteur ?) n'est pas matérialisée. | **S** |
| P3-3 | CGU / politique de confidentialité parents affichées | Le juridique loi 25-11 est traité côté données ; les textes contractuels utilisateurs restent à formaliser. | **S** |
| P3-4 | Signature électronique des contrats/autorisations | Mentionné par CrechePilot ; devient standard. À coupler à P2-2. | **M** |

## 5. Roadmap recommandée

1. **Immédiat (P0, ≈ 1 semaine)** : email transactionnel + sauvegardes
   planifiées hors site avec restauration testée. Sans ces deux-là, la mise en
   production d'une vraie crèche n'est pas défendable.
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
