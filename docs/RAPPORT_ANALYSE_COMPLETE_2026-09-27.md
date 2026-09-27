# RAPPORT D'ANALYSE COMPLÈTE — cr-cheDZ

**Logiciel de gestion de crèche — Algérie**

| | |
|---|---|
| **Dépôt** | `Allintelligence2024/cr-cheDZ` |
| **Branche analysée** | `arena/01a0e39f-cr-chedz` (base `main` @ `65f8ffd`, PR #50) |
| **Date de l'analyse** | 2026-09-27 |
| **Méthode** | Lecture intégrale de l'arborescence (722 fichiers), du code source, des 76 migrations SQL, des 4 workflows CI, des 58 documents et de 73 suites de tests. Aucune exécution de la stack (Docker/Flutter indisponibles dans l'environnement d'analyse) : tous les chiffres sont **statiques**, sauf mention « exécuté » extraite des documents du dépôt. |
| **Découpage** | Une radiographie préliminaire (analyse 0) puis **10 analyses thématiques** (1 → 10), chacune auto-portante et traitée en profondeur, suivies d'une synthèse transversale, d'une matrice de risques consolidée et d'un plan d'action priorisé. |

---

## TABLE DES MATIÈRES

| # | Analyse | Objet |
|---|---|---|
| 0 | [Radiographie chiffrée du dépôt](#analyse-0--radiographie-chiffrée-du-dépôt) | Volume, répartition, métriques brutes |
| 1 | [Vision produit, périmètre métier et cadre réglementaire](#analyse-1--vision-produit-périmètre-métier-et-cadre-réglementaire-algérien) | Ce que le logiciel doit faire, pour qui, sous quelle loi |
| 2 | [Architecture générale, monorepo et décisions d'architecture](#analyse-2--architecture-générale-monorepo-et-décisions-darchitecture) | Forme du système, ADR, cohérence des choix |
| 3 | [Backend API NestJS — structure modulaire et patterns transverses](#analyse-3--backend-api-nestjs--structure-modulaire-et-patterns-transverses) | Le cœur applicatif |
| 4 | [Modèle de données, migrations et intégrité PostgreSQL](#analyse-4--modèle-de-données-migrations-et-intégrité-postgresql) | Le socle de vérité |
| 5 | [Sécurité, authentification et autorisation](#analyse-5--sécurité-authentification-et-autorisation) | Le périmètre de confiance |
| 6 | [Conformité loi 25-11, vie privée et protection des données](#analyse-6--conformité-loi-25-11-vie-privée-et-protection-des-données) | L'obligation légale |
| 7 | [Frontends web et design system](#analyse-7--frontends-web-admin-web-support-console-et-design-system) | L'interface métier |
| 8 | [Applications mobiles Flutter et synchronisation offline-first](#analyse-8--applications-mobiles-flutter-et-synchronisation-offline-first) | Le terrain, hors ligne |
| 9 | [Infrastructure, CI/CD, observabilité et exploitation](#analyse-9--infrastructure-cicd-observabilité-et-exploitation) | La mise en production |
| 10 | [Qualité, tests, dette technique, risques et feuille de route](#analyse-10--qualité-tests-dette-technique-risques-et-feuille-de-route) | Le bilan et l'après |
| — | [Synthèse transversale](#synthèse-transversale) | Verdict, matrice de risques, plan d'action |

---

# ANALYSE 0 — RADIOGRAPHIE CHIFFRÉE DU DÉPÔT

## 0.1 Volume et répartition

| Métrique | Valeur |
|---|---|
| Fichiers versionnés (hors `.git`) | **722** |
| Lignes de code/doc (hors lockfiles, `*.g.dart`) | **≈ 79 700** |
| Langues principales | TypeScript/TSX, SQL, Dart, Markdown, mjs |
| Migrations SQL | **76** (`001` → `076`) |
| Tables créées | **75** |
| Politiques RLS distinctes | **64** |
| Fonctions SQL | **63** |
| Triggers | **17** |
| Modules API NestJS | **24** |
| Contrôleurs | **29** |
| Routes HTTP décorées | **199** (inventoriées par `inventory-route-guards.mjs`, qui en recense 198 couvertes par `@Roles`/`@Public`) |
| Suites d'isolation enregistrées | **73** (+ garde anti-bypass RLS) |
| Workflows GitHub Actions | **4** (ci 425 L, flutter 212 L, docker 54 L, security-audit 35 L) |
| Documents Markdown | **58** (dont **28** runbooks `PHASE_*`) |
| Scripts d'exploitation / gardiens | **37** |

## 0.2 Poids relatif par couche

| Couche | LOC | Lecture |
|---|---|---|
| `tests/` | **20 048** | Le poste le plus lourd du dépôt — la preuve est le produit principal |
| `apps/api` | **18 354** | Monolithe modulaire NestJS |
| `docs/` | **14 813** | 58 documents, densité documentaire exceptionnelle |
| `infrastructure/database` | **6 696** | 76 migrations + seeds + rôles |
| `apps/admin-web` | **4 455** | SPA React 19 |
| `scripts/` | **3 856** | Gardiens, migrations, preuves |
| `apps/staff-mobile` | **3 131** | Flutter offline-first |
| `packages/` | **2 070** | api-contracts, i18n (718 L), design-system, prod-config, sync-contract |
| `apps/parent-mobile` | **1 952** | Flutter espace familles |
| `apps/worker` | **1 208** | Jobs + notifications push |
| `apps/support-console` | **489** | Console support (SPA minimale) |
| `infrastructure/docker` | **661** | 3 composes + images |
| `infrastructure/monitoring` | **114** | Prometheus, Alertmanager, Grafana |

## 0.3 Première lecture structurante

Trois faits saillants, avant toute analyse qualitative :

1. **Le rapport `tests / code applicatif` est de ~0,62** (20 048 lignes de tests pour ~32 400 lignes de code applicatif). C'est un ratio élevé — la plupart des projets de cette taille plafonnent à 0,2–0,3 — et il n'est pas accidentel : c'est le résultat d'une culture explicite de « preuve exécutée » (§10.2), où chaque correctif de sécurité ou d'argent doit apporter sa propre suite.
2. **La couche SQL est un actif de premier plan.** 6 696 lignes de migrations portant 63 fonctions et 17 triggers : une part significative de la logique métier (intégrité financière, idempotence, changelog de synchronisation, purge de rétention, séquences par organisation) est **implémentée en base**, pas en TypeScript. C'est un choix architectural délibéré (ADR-006, `pg` brut) et c'est l'une des forces du projet.
3. **La documentation est surabondante au point d'être elle-même un risque.** 58 documents, 28 runbooks, un index de lecture obligatoire, et un *contrat de vérité documentaire* (`claims-contract.test.mjs`, 10 contrôles) ajouté en CI **parce que la documentation avait menti**. Ce symptôme est analysé au §10.4.

---

# ANALYSE 1 — VISION PRODUIT, PÉRIMÈTRE MÉTIER ET CADRE RÉGLEMENTAIRE ALGÉRIEN

## 1.1 Ce qu'est cr-cheDZ

cr-cheDZ est un **SaaS multi-locataire de gestion d'établissements d'accueil de la petite enfance** destiné au marché algérien. Il couvre la chaîne complète d'une crèche : inscription, présence, journal quotidien, communication aux familles, facturation, paie, conformité réglementaire.

Le positionnement est explicite et défensif : il ne s'agit pas d'un « carnet de présence numérisé » mais d'un **système de gestion** où la donnée de terrain (pointage) alimente mécaniquement la facturation et la communication parents — c'est l'intégration, et non la juxtaposition de modules, que le document `ANALYSE_PILIERS_MANQUANTS.md` identifie comme l'attente n°1 du marché (étude de 9 concurrents francophones et anglophones : Belami, Kidizz, Brightwheel, illumine, Défi-Enfance…).

## 1.2 Les cinq populations d'utilisateurs

| Population | Surface | Rôle dans le système |
|---|---|---|
| **Personnel de crèche** (directrice, éducatrice, réceptionniste) | `admin-web` (web) + `staff-mobile` (tablette/téléphone, **offline-first**) | Saisit présences, journal, photos, consulter ratios |
| **Parents / tuteurs** | `parent-mobile` (OTP par téléphone, pas de mot de passe) | Consulte le fil du jour, les photos sous consentement, les absences, la situation financière |
| **Comptable / directrice** | `admin-web` | Facturation, encaissements, paie, exports |
| **Support plateforme / DPO** | `support-console` (derrière allowlist IP) | Recherche cross-tenant, jobs, vie privée, impersonation auditée |
| **Machine** | `worker` + `background_jobs` + `scheduler_ticks` | PDF, exports, notifications, purges de rétention |

Le modèle de rôle est : `super_admin` (plateforme), `director`, `accountant`, `educator`, `receptionist`, plus le `guardian` (parent, hors membership). La **contrainte historique ADR-001** (« un rôle par utilisateur et par organisation ») a été levée par la migration 040 (`role_assignments`, rétrocompatible : `memberships` = rôle principal).

## 1.3 Périmètre fonctionnel livré

| Domaine | Contenu | État |
|---|---|---|
| **Organisation** | organisations → sites → salles ; types d'établissement (crèche / jardin d'enfants / multi-accueil) ; capacité ; paramètres | ✅ |
| **Enfants & familles** | dossiers enfants, statuts (`pre_registered → active → on_leave → departed`), gardiens, personnes autorisées à récupérer, contacts d'urgence, allergies, vaccinations, historique des statuts et des changements de salle | ✅ |
| **Présences** | sessions (`expected → present → absent → departed → cancelled`), événements append-only, ratios d'encadrement, attestations de présence | ✅ |
| **Journal quotidien** | repas, siestes, changes, activités, température, notes, incidents ; événements **jamais supprimables** | ✅ |
| **Médias** | photos/documents, consentements photo par granularité, `media_access_logs`, service same-origin, upload par l'API | ✅ (partiellement, cf. §8.4) |
| **Santé** | dossiers santé, vaccinations, autorisations et administrations de médicaments | ✅ |
| **Facturation** | contrats, factures mensuelles, lignes, encaissements (espèces/virement/chèque), relances, reçus PDF, rapprochement SATIM, registre de caisse | ✅ (paiement en ligne = code prêt, **flag off**) |
| **Paie** | runs mensuels, lignes, finalisation **verrouillante** (migration 072) | ✅ |
| **Communication** | messagerie crèche ↔ parents, notifications (push/in-app/SMS/WhatsApp), préférences | ✅ |
| **Conformité** | contrôles de conformité, règles, DPIA, registre des traitements | ✅ |
| **Vidéosurveillance** | caméras, zones, visionnage journalisé, purge 30 j | ⚠️ **Module présent, acquisition des clips absente** (décision D5 = c) |
| **Marketplace** | annuaire public, opt-in par organisation | ✅ |
| **Vie privée** | demandes de droits, DPIA, violations (chrono 5 j), anonymisation | ✅ (partiel, cf. §6.5) |

## 1.4 Le cadre réglementaire : un acte fondateur, pas un vernis

C'est le point le plus distinctif du projet et il mérite d'être examiné en détail, car il **conditionne des choix techniques irréversibles**.

### 1.4.1 Loi n° 18-07 modifiée par la loi n° 25-11 (2025)

L'ADR-009 est sans ambiguïté et corrige une erreur initiale du projet : la documentation d'origine parlait de « RGPD ». La loi applicable en Algérie est la **loi n° 18-07 du 10 juin 2018**, modifiée et complétée par la **loi n° 25-11 du 24 juillet 2025**. Les conséquences produit sont substantielles et **diffèrent du RGPD** sur plusieurs points que le code reflète :

| Exigence 25-11 | Traduction dans le code / le produit | Écart avec le RGPD |
|---|---|---|
| **DPO obligatoire** | Module « Vie privée », rôles de gestion des demandes | Similaire |
| **Notification de violation sous 5 jours** (ANPDP) | Table `privacy_violations` + workflow avec chrono ; envoi SMTP fail-closed (jamais de faux « notifié ») | RGPD : 72 h |
| **DPIA (AIPD)** pour traitements à risque | Tables `privacy_dpias` ; la vidéosurveillance exige une DPIA **approuvée par l'organisation** (migration 046, inactif par défaut) | Similaire |
| **Registre des traitements** | `processing_registry`, pré-rempli au seed 015 | Similaire |
| **Pas de droit à l'effacement automatique** | Le soft delete est la règle ; l'anonymisation est l'alternative reconnue (`scripts/anonymize.sql`) | **Différence majeure** : pas d'effacement à la demande |
| **Transferts transfrontaliers** soumis à autorisation ANPDP | Aucun transfert implicite ; stockage objet local (MinIO / S3 régional) | Contrainte forte |

Le dépôt applique cette discipline jusqu'à la terminologie : aucun écran, aucun document, aucun message d'erreur ne mentionne « RGPD ». Les messages d'erreur sont systématiquement bilingues français / arabe (`AppError` porte `messageFr` + `messageAr`).

### 1.4.2 Décret exécutif n° 19-253 (2019)

Le décret fixe les conditions de création, d'organisation, de fonctionnement et de contrôle des établissements d'accueil de la petite enfance. Ses contraintes sont encodées :

| Disposition | Encodage |
|---|---|
| Crèche : 3 mois → 3 ans ; jardin d'enfants : 3 → 6 ans ; multi-accueil : 3 mois → < 6 ans | `organizations.establishment_type` + bornes d'âge par défaut des salles (`min_age_months` 3, `max_age_months` 71) |
| **Capacité maximale 150 enfants** | `organizations.max_children INTEGER NOT NULL DEFAULT 150` |
| Affichage obligatoire des prestations et tarifs | Module conformité (`compliance_checks`) |
| Programmes pédagogiques par tranche d'âge | Salles avec bornes d'âge ; ratios éducateur/enfant |
| Personnel qualifié | `staff_profiles`, `staff_documents` |

### 1.4.3 Lecture critique

La conformité n'est pas ici un document à part : elle est **structurante**. Le fait que l'absence de droit à l'effacement automatique (propre à la loi algérienne) ait été traduite par une architecture en soft-delete + anonymisation, plutôt que par un bouton « supprimer mes données », est la preuve que la loi a été lue et non paraphrasée. C'est rare et c'est un avantage compétitif réel sur un marché où les concurrents francophones raisonnent RGPD.

**Risque identifié** : cette conformité est **codée en dur dans le schéma** (valeurs par défaut, contraintes). Toute évolution du décret 19-253 (capacité, tranches d'âge) exige une migration, alors qu'un paramétrage par type d'établissement serait plus souple (§10.6, recommandation R4).

## 1.5 Le bilinguisme comme contrainte de conception

Le français et l'arabe ne sont pas une traduction appliquée après coup :

- **Base de données** : colonnes dupliquées `name_fr` / `name_ar` sur la plupart des entités de référence (organisations, sites, salles, lignes de facture, notifications).
- **API** : `AppError` porte `messageFr` et `messageAr` ; le filtre global sérialise les deux ; le corps d'erreur est `{ statusCode, code, message_fr, message_ar, timestamp, path, correlation_id }`.
- **Web** : `packages/i18n` (718 lignes de messages FR/AR), bascule `dir=ltr|rtl` sur `<html>`, `localStorage` de la locale.
- **Mobile** : `MaterialApp` avec `supportedLocales: [fr, ar]` + délégations de localisation.
- **PDF** : pdfkit avec **police Noto Naskh Arabic embarquée** et table GSUB vérifiée en test (phase8) — ce détail est significatif : l'arabe n'est pas rendable sans shaping, et le projet l'a traité explicitement.

**Risque identifié** : la duplication `*_fr` / `*_ar` au niveau colonne est rigide. Une troisième langue ou une variation régionale exigerait une migration par table. Un modèle i18n en JSONB serait plus extensible (§10.6, R5).

---

# ANALYSE 2 — ARCHITECTURE GÉNÉRALE, MONOREPO ET DÉCISIONS D'ARCHITECTURE

## 2.1 Forme générale

```
                    ┌────────────────────────────────────────┐
   navigateurs ────▶│ nginx (TLS, CSP, rate-limit, allowlist)│
   téléphones  ────▶│  /  → admin-web      /support/ → console│
                    │  /api/ → api:3000                       │
                    └──────────────────┬─────────────────────┘
                                       │
                    ┌──────────────────▼─────────────────────┐
                    │  API NestJS 11 (monolithe modulaire)    │
                    │  24 modules · 29 contrôleurs · 199 routes│
                    │  gardes : JWT → Rôles → Rate-limit       │
                    └───┬───────────────────┬────────────────┘
                        │                   │
        ┌───────────────▼──────┐   ┌────────▼─────────────────┐
        │ PostgreSQL 18        │   │ MinIO / S3 (objets)       │
        │ RLS multi-tenant     │   │ clés préfixées par tenant │
        │ rôles séparés        │   └───────────────────────────┘
        └───────────▲──────────┘
                    │
        ┌───────────┴──────────┐
        │ Worker NestJS        │──▶ FCM / APNs / SMTP / Twilio / WhatsApp
        │ jobs + notifications │
        └──────────────────────┘
```

Le choix central est le **monolithe modulaire** : un seul déploiement, des modules NestJS découplés. Pour une équipe de 3 personnes (dimension annoncée dans le plan d'implémentation), c'est le bon arbitrage — il évite la taxe de coordination des microservices sans renoncer à la séparation logique.

## 2.2 Le monorepo

- **Workspaces npm** (`packages/*`, `apps/*`) ; `package.json` racine avec `workspaces` (et non pnpm/Turborepo, alors qu'ADR-000 annonçait « pnpm + Turborepo » — **divergence documentaire**, cf. §2.5).
- Les **apps Flutter ne sont pas dans les workspaces** : leur cycle de build est séparé (workflow `flutter.yml` dédié). Bonne décision : les toolchains ne se mélangent pas.
- **5 packages partagés** :
  - `api-contracts` — OpenAPI 3.1
  - `design-system` — tokens + thème Sérénité (web) + parité Flutter testée
  - `i18n` — messages FR/AR + `dirOf()`
  - `shared-config` — ESLint / Prettier / tsconfig
  - `prod-config` — garde de configuration de production, rôles DB, calendrier métier, stockage, TOTP, accès notifications
  - `sync-contract` — schéma JSON, protocole, corpus de conformité, template client Dart

`prod-config` mérite une mention : c'est le **point de contrôle unique** de la configuration de production, partagé par l'API et le worker. Un secret par défaut ou une configuration partielle **empêche le démarrage** (`assertProductionConfig()` dans les deux `main.ts`). C'est une défense contre la classe d'incidents la plus coûteuse : « ça marchait en staging ».

## 2.3 Les 14 ADR : qualité et cohérence

| ADR | Décision | Évaluation |
|---|---|---|
| **000** | Monorepo | ✅ Cohérent (mais pnpm/Turborepo annoncés, npm workspaces implémentés) |
| **001** | Un seul rôle par utilisateur (MVP) | ✅ Acté, puis **évolué** par la migration 040 (multi-rôles) — l'ADR a été revisité, signe de vitalité |
| **002** | DZD uniquement | ✅ Pragmatique ; colonnes `currency` présentes pour activation ultérieure sans migration |
| **003** | Paiement en ligne désactivé jusqu'aux pilotes | ✅ Excellent arbitrage : zéro dépendance à un PSP pendant 8 semaines ; schéma prêt (`external_reference`, `payment_gateway`, `gateway_response`) |
| **004** | Clients API : TS généré à la demande, Dart écrit à la main | ✅ Décision documentée et assumée ; le client Dart est en outre *généré* pour la sync et *écrit* pour le reste |
| **005** | Worker = application NestJS standalone | ✅ Partage les modules métier, pas de duplication de logique |
| **006** | `pg` brut, pas d'ORM | ✅ Cohérent avec l'usage intensif du SQL (fonctions, triggers, RLS) ; un ORM aurait combattu le schéma |
| **007** | Migrations immuables | ✅ **La règle la plus structurante du dépôt** ; vérifiée par checksums SHA-256 + détection de drift |
| **008** | Curseur de sync = séquence monotone | ✅ Correction d'un défaut d'architecture initial (horloge → `BIGSERIAL` + verrou par tenant en 060) |
| **009** | Loi 18-07 / 25-11, pas RGPD | ✅ Décision juridique fondatrice, appliquée partout |
| **010** | Audit : rétention + masquage | ✅ `shared/redact.ts` + rétention 5 ans |
| **011** | Rôles PostgreSQL séparés | ✅ Décision de sécurité majeure, très détaillée (cf. §5.6) |
| **012** | Worker : baux de jobs | ✅ Garantie at-least-once, reprise après crash |
| **013** | Worker : ordonnanceur | ✅ `scheduler_ticks` + `scheduler_health()` |

**Lecture :** ce corpus d'ADR est d'une qualité nettement supérieure à la moyenne des projets de cette taille. Chaque ADR porte un contexte, une décision, des conséquences et — pour les plus récentes (009, 011) — une section **« Conséquences et limites »** qui assume ce qui n'est pas résolu. C'est le signe d'une architecture *pratiquée*, pas *décorée*.

## 2.4 Le plan d'implémentation : une analyse critique préalable

`docs/PLAN_IMPLEMENTATION.md` (709 lignes) est un document remarquable : il commence par une **analyse critique de l'architecture fournie**, identifie **12 corrections obligatoires (C01–C12)** dont 6 bloquantes, et refuse d'écrire du code métier avant de les avoir traitées.

Les 6 bloquantes et leur résolution effective :

| # | Correction | Résolution constatée |
|---|---|---|
| C01 | RLS `WITH CHECK` manquante, RLS absente sur ~20 tables | ✅ `schema-check.mjs` contrôle les invariants structurels (RLS activée/FORCÉE, `WITH CHECK`, politique présente et ancrée, contraintes financières, changelog, drift) ; 64 politiques |
| C02 | Curseur de sync basé sur l'horloge | ✅ `sync_changelog` + `BIGSERIAL` + verrou par tenant (060) |
| C03 | Incohérence TypeORM vs `pg` | ✅ Tout en `pg` (ADR-006) |
| C04 | Immutabilité factures/paiements non garantie en base | ✅ Triggers + contraintes ; **durcie ensuite** par 064 (audit externe) |
| C05 | Pas de runner de migrations avec checksums | ✅ `scripts/migrate.mjs` : SHA-256, drift detection, `--status`, `--check`, `--reset` refusé en prod/staging |
| C06 | Rôle applicatif non défini | ✅ `creche_app` / `creche_migrator` (ADR-011) |

Cette discipline — **critiquer l'architecture avant de l'implémenter** — est la meilleure explication de la solidité observée ensuite.

## 2.5 Divergences constatées entre documents et code

L'honnêteté intellectuelle du dépôt est telle qu'il a fini par **automatiser la détection de ses propres mensonges** (`claims-contract.test.mjs`). L'analyse en a relevé plusieurs :

| Document | Affirmation | Réalité |
|---|---|---|
| ADR-000 | « pnpm workspaces + Turborepo » | `npm workspaces` (racine) ; ni pnpm ni Turborepo dans les dépendances |
| README | OpenAPI « 13 paths » | Exact (vérifié) ✅ |
| Ancien `SECURITY.md` | « CodeQL configuré » | ❌ Réfuté et **corrigé** — aucun job CodeQL n'existe |
| Ancienne CI | « Suites d'isolation phase3 → phase24 » | 73 suites, `phase3 → phase77` — libellé corrigé |
| Ancienne CI | « 75 migrations » puis « 63 » | 76 — commentaire corrigé au lot L4 |
| Ancien rapport | « HEALTHCHECK sur les services » | 1 seul (Postgres) puis API + worker ajoutés (lot 6.1) |

**Lecture :** le dépôt a connu une **crise de vérité documentaire** documentée publiquement (lot L5 du plan de réparation, `VERIFICATION_ANALYSE_2026-09-24.md` : 60 affirmations contrôlées, 4 fausses). La réponse — un contrat de vérité exécuté en CI qui confronte les phrases des documents au disque — est une solution élégante et probablement unique. Mais le symptôme révèle un **rythme de production très élevé** où la documentation dérive plus vite que la relecture (§10.4).

---

# ANALYSE 3 — BACKEND API NestJS : STRUCTURE MODULAIRE ET PATTERNS TRANSVERSES

## 3.1 L'assemblage racine

`app.module.ts` enregistre 24 modules métier + `ConfigModule` (global) + `DatabaseModule` (global), et déclare **trois gardes globaux dans un ordre signifiant** :

```
JwtAuthGuard  →  RolesGuard  →  RateLimitGuard
```

L'ordre n'est pas anodin et les commentaires le disent : l'identité doit être établie avant l'autorisation, et la limitation de débit s'applique **en dernier** (donc après authentification, ce qui permet un rate-limit par IP **et** par route). Un `HttpExceptionFilter` global ferme la chaîne.

`app.factory.ts` (utilisée par `main.ts` **et** par les tests d'intégration) configure :
- `rawBody: true` — nécessaire à la vérification HMAC du webhook de paiement sur le corps brut
- `trust proxy: 1` — **exactement un saut d'ingress**, l'API devant rester privée derrière nginx qui réécrit `X-Forwarded-For` ; ne jamais faire confiance à une chaîne arbitraire
- préfixe global `api` + versioning URI (`/api/v1`, défaut `1`)
- CORS sur liste blanche avec `credentials: true` (nécessaire au cookie httpOnly cross-origin)
- `cookie-parser` (sans secret : le cookie n'est pas signé, il est httpOnly + Secure + SameSite=Lax)
- `ValidationPipe` avec `whitelist: true`, `transform: true`, **`forbidNonWhitelisted: true`** — ce dernier point est important : un client qui envoie un champ inattendu est rejeté plutôt qu'ignoré silencieusement
- métriques HTTP sans PII

## 3.2 Le contexte de requête : AsyncLocalStorage plutôt que scope REQUEST

C'est un choix technique fin, explicitement commenté :

```ts
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();
```

Le middleware `request-context.middleware` crée un contexte par requête (tenant `null`, corrélation ID généré ou repris du client, renvoyé en en-tête `X-Correlation-Id`). Le `JwtAuthGuard` y écrit le tenant ; `TenantContextService` le lit.

**Pourquoi c'est important** : la portée `REQUEST` de NestJS **casse l'injection de dépendances dans les gardes globaux** (`APP_GUARD`). L'usage d'`AsyncLocalStorage` permet à un garde global d'écrire dans un contexte que les services *singleton* lisent ensuite. C'est le pattern officiel NestJS et il est correctement appliqué — y compris la déclaration de type globale augmentant `Express.Request`.

## 3.3 Le cœur de l'isolation : `withTenantConnection`

```ts
async withTenantConnection<T>(callback): Promise<T> {
  const client = await this.pool.connect();
  try {
    await client.query('BEGIN');
    if (store?.tenantId) await client.query('SELECT set_config($1,$2,true)', ['app.tenant_id', store.tenantId]);
    if (store?.userId)   await client.query('SELECT set_config($1,$2,true)', ['app.user_id',  store.userId]);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (e) { await client.query('ROLLBACK').catch(()=>undefined); throw e; }
  finally { client.release(); }
}
```

Trois propriétés remarquables :

1. **`set_config(..., true)` = `SET LOCAL`** : la GUC est posée pour la transaction, jamais pour la session. Aucun risque de fuite entre deux requêtes partageant une connexion du pool.
2. **Safe-by-default** : sans tenant posé, `app_tenant_id()` retourne `NULL`, toutes les politiques RLS sont fausses, **0 ligne est retournée**. Le mode de défaillance est l'absence de données, jamais la fuite.
3. **`app_tenant_id()` plutôt que `current_setting()` direct** : la migration 018 a remplacé toutes les politiques après la découverte d'un bug réel — après `SET LOCAL` + `COMMIT`, la GUC **restait créée avec la valeur `''`** sur la connexion poolée, et `''::uuid` levait « invalid input syntax for type uuid ». Le helper `NULLIF(btrim(...),'')::uuid` est robuste à `NULL` **et** à `''`. La migration **échoue volontairement** (`RAISE EXCEPTION`) si une expression de politique est inattendue, plutôt que de laisser une politique non migrée.

## 3.4 Le garde anti-bypass RLS : la défense contre soi-même

`scripts/check-rls-usage.mjs` est le gardien le plus original du dépôt. Son principe :

> Dans `apps/api/src`, tout `pool.query` **brut** (hors `withTenantConnection`) ne peut porter que sur (1) une fonction `SECURITY DEFINER` ou (2) une table système sans RLS.

La subtilité : la liste des fonctions `SECURITY DEFINER` **n'est pas codée en dur** — elle est **dérivée du catalogue réel** (`pg_proc WHERE prosecdef`) au moment du contrôle. Une fonction listée qui n'est plus `SECURITY DEFINER`, ou une table système qui a désormais la RLS active, est une **divergence explicite = échec**. Sans base, le script passe en mode *fallback* avec listes figées **et avertissement explicite** (jamais un vert silencieux).

Le commentaire d'en-tête est révélateur de la culture du projet : *« Le bug P0 (UPDATE payments via pool brute : 0 ligne silencieuse sous NOBYPASSRLS) serait mort né si ce contrôle avait existé. »* — le gardien est né d'un incident, et il est exécuté **avant toutes les suites** par `run-isolation-suites.sh`.

## 3.5 Les modules : 24 domaines, 199 routes

| Module | LOC | Rôle |
|---|---|---|
| `billing` | 1 460 | Contrats, factures, lignes, encaissements, webhook HMAC, reçus, rapprochement SATIM |
| `identity` | 1 439 | Login, OTP parent, TOTP, sessions, appareils, invitations |
| `children` | 1 203 | Dossiers, gardiens, import |
| `privacy` | 954 | Droits, DPIA, violations, registre, audit |
| `media` | 933 | Upload par l'API, service same-origin, consentements |
| `organizations` | 870 | Organisations, sites, salles, invitations, feature flags |
| `staff` | 759 | Profils, documents, plannings |
| `attendance` | 658 | Sessions, événements, ratios |
| `parents` | 574 | Fil du jour, photos, projection financière |
| `video` | 497 | DPIA + caméras + clips (acquisition absente) |
| `sync` | 433 | Push/pull, curseur, idempotence |
| `health` | 379 | Santé, allergies, vaccins, médicaments |
| `journal` | 331 | Événements de journal append-only |
| `metrics` | 310 | Compteurs Prometheus, collecteur à credential limité |
| `attestations` | 310 | Attestations de présence (PDF) |
| `enrollment` | 251 | Pré-inscriptions, liste d'attente |
| `compliance` | 226 | Contrôles, règles |
| `users`, `payroll`, `notifications`, `exports`, `messaging`, `dashboard`, `marketplace` | 76–223 | — |

### Patterns transverses observés

**DTO + class-validator.** Chaque module a son dossier `dto/`. Le `ValidationPipe` global avec `forbidNonWhitelisted` garantit qu'un champ non déclaré est rejeté. Les DTO sont en outre **réutilisés comme validateurs du contrat de synchronisation** — le générateur vérifie que le schéma JSON et les vrais DTO sont cohérents.

**Erreurs métier typées.** `AppError(code, messageFr, messageAr, status, details)` + un catalogue `Errors` (21 erreurs communes : `notFound`, `unauthorized`, `accountLocked`, `totpInvalid`, `sessionReuseDetected`, `invoiceImmutable`…). Le filtre global les transforme en corps HTTP bilingue. Cas notable traité explicitement : les erreurs d'infrastructure HTTP **non-`HttpException`** (ex. `PayloadTooLargeError` de body-parser, status 413) sont détectées par une borne 4xx dédiée (`clientHttpStatus`) pour **ne pas** être présentées comme « erreur interne — réessayez », alors que le remède est de réduire l'envoi.

**Feature flags.** `FeatureFlagGuard` bloque une route avec **503 `FEATURE_DISABLED`** (et non 404, pour que le mobile affiche « module désactivé par votre administrateur » plutôt qu'un « endpoint introuvable » trompeur). Le lookup est par `flag_key` + `organization_id` (NULL = global). **Fail-open assumé et commenté** : un flag non trouvé autorise, pour ne pas casser une migration oubliée.

**Rate limiting.** `RateLimitGuard` + `RateLimitService`, clé `ip:route`, activé par décorateur `@RateLimit({points, windowMs})`. Désactivable par `RATE_LIMIT_DISABLED` — **mais** en production cette variable **bloque le démarrage** via `@creche/prod-config` (lot L1.1), avec une correspondance stricte à la sémantique du garde (`true`/`1` refusés ; `false`/absent admis). Nginx applique en outre ses propres limites (auth 5 r/m, api 30 r/m, sync 60 r/m).

## 3.6 Le worker : jobs, baux et notifications

`apps/worker` (1 208 LOC) est une application NestJS **standalone** (ADR-005) — `runWorker(pool, handlers, drainNotifications, reportError)`.

Qualité de conception observée :

- **Baux de jobs** (ADR-012) : `jobs_claim_leased()` / `jobs_finish_leased()` en `SECURITY DEFINER` ; `jobs_reap_stale(interval)` reprend les jobs dont le bail a expiré (worker mort). Garantie **at-least-once**.
- **Pool de contrôle séparé** (`max: 2`) pour la maintenance et le heartbeat, afin qu'un handler métier long ne bloque jamais le reaper.
- **Invariant de configuration validé au démarrage** : `heartbeat × 3 < timeout`, sinon `WORKER_CONFIG_INVALID`. Neuf variables bornées et typées.
- **Arrêt propre** : `SIGTERM/SIGINT` → plus de nouveaux claims, travail en cours conservé, `WORKER_SHUTDOWN_TIMEOUT_MS` (45 s) avant sortie forcée ; `stop_grace_period: 60s` côté Docker.
- **Ordonnanceur** : `scheduler_ticks` + `scheduler_enqueue_due()` + `scheduler_health()` avec alerte `SCHEDULER_OVERDUE` (déduplication par `overdueReported` Set).
- **Purge vidéo « jamais de fausse purge »** : le stockage est supprimé **avant** la ligne de chaque clip ; un échec de stockage laisse la ligne en base et **fait échouer le job** (`VIDEO_PURGE_PARTIAL`).
- **File de notifications** : `notif_queue_claim` / `notif_queue_finish` avec `notif_queue_reclaim(interval)` (audit O4 : un crash entre claim et finish laissait la ligne `processing` pour toujours).
- **Sondes de vivacité** (lot 6.1) : `startLiveness()` réécrit un marqueur toutes les 10 s, lu par le `HEALTHCHECK` Docker ; démarré **après** les gardes de boot (un conteneur mal configuré ne doit pas paraître sain).

## 3.7 Ce que l'analyse retient

**Forces.**
- L'isolation multi-tenant est **structurelle** (RLS) et non conventionnelle (un `WHERE` qu'on oublie) — et un gardien automatique interdit de la contourner.
- L'usage d'`AsyncLocalStorage`, de `SET LOCAL`, du `safe-by-default` et du `fail-closed` témoigne d'une comprehension fine des modes de défaillance.
- Le worker est traité avec le même sérieux que l'API (baux, reprise, arrêt propre, sondes) — c'est la partie habituellement sacrifiée.

**Faiblesses.**
- **Pas de pagination systématique** : plusieurs services retournent des listes non bornées (`staff`, `children`, `organizations`). Sur un tenant de 150 enfants c'est acceptable ; sur une consolidation multi-sites ce ne le sera pas.
- **Logique métier dupliquée SQL/TS** : la facturation mensuelle existe côté worker (cent entiers, `ON CONFLICT DO NOTHING`) et des calculs analogues côté service. Deux vérités pour un même calcul d'argent est un risque (cf. §4.6).
- **Couverture unitaire faible** : `jest --coverage` affiche ~6,6 % de couverture globale (chiffre assumé et publié). La sécurité repose sur les 73 suites d'isolation et l'e2e, ce qui est défendable mais fragile pour la logique métier pure.

---

# ANALYSE 4 — MODÈLE DE DONNÉES, MIGRATIONS ET INTÉGRITÉ POSTGRESQL

## 4.1 Le socle

| Élément | Valeur |
|---|---|
| Migrations | 76 (`001_extensions_and_types` → `076_messaging_retention`) |
| Tables | 75 |
| Politiques RLS | 64 |
| Fonctions SQL | 63 (dont de nombreuses `SECURITY DEFINER`) |
| Triggers | 17 |
| Extensions | `uuid-ossp`, `pgcrypto`, `pg_trgm` |
| Types énumérés | **14** (`user_status`, `child_status`, `attendance_status`, `meal_quantity`, `invoice_status`, `payment_method`, `payment_status`, `notification_channel`, `media_type`, `consent_type`, `document_type`, `job_status`, `sync_command`, `audit_action`) |

La migration 001 pose d'emblée les invariants de domaine sous forme de types énumérés plutôt que de chaînes libres : c'est un schéma **qui refuse les états impossibles**.

## 4.2 La discipline des migrations (ADR-007)

> **Une migration appliquée ne se modifie jamais.**

`scripts/migrate.mjs` fait respecter cette règle :
- table `schema_migrations(filename, checksum, applied_at)` ;
- **checksum SHA-256** de chaque fichier ;
- refus de rejouer un fichier dont le checksum a changé → message **« DRIFT DÉTECTÉ »** et code de sortie 2 ;
- `--reset` **refusé en production et en staging** ;
- `MIGRATION_DATABASE_URL` **obligatoire** en prod/staging, distinct de `DATABASE_URL` ;
- grants réappliqués dans la transaction de chaque migration.

Conséquence observable : 25 des 76 migrations sont des **`fix_*`** (`026_fix_jobs_claim_next`, `027`, `028`, `037_fix_support_pilot_summary`, `039_fix_webhook_confirm_pending`, `041_fix_auth_user_roles`, `043_fix_notif_queue_claim`, `048_fix_jobs_finish_cast`, `052`, `054`…). C'est le coût assumé de l'immuabilité : on ne corrige pas, on ajoute. Deux de ces correctifs sont instructifs :

- **`048_fix_jobs_finish_cast`** : le chemin d'échec des jobs était **cassé depuis la migration 024**. Découvert uniquement parce que la CI exécute une **vraie** PostgreSQL 18 — l'en-tête du workflow le dit explicitement : *« un moteur différent de celui validé masquerait des bugs de compatibilité »*.
- **`055_rls_and_race_fixes`** : réservée à la phase G, elle corrige des politiques et des courses.

## 4.3 L'isolation multi-tenant : 64 politiques

**Modèle canonique** (migration 002) :

```sql
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;
CREATE POLICY sites_tenant_isolation ON sites
  USING (organization_id = app_tenant_id())
  WITH CHECK (organization_id = app_tenant_id());
```

`FORCE` est crucial : **être propriétaire de la table n'exempte pas des politiques**. Sans `FORCE`, le propriétaire (le migrateur) verrait tout.

**Tables système exemptées** (listées et justifiées dans `schema-check.mjs`) : `users` (compte global, l'appartenance passe par `memberships`), `roles`, `sessions`, `audit_logs`, `data_access_logs` (accès DPO / super_admin).

**`schema-check.mjs` — les invariants structurels contrôlés en CI :**
1. Aucune table avec `organization_id` sans RLS (hors système) ;
2. Toutes les tables RLS sont `FORCE` ;
3. Toute table RLS a **au moins une politique** (pas de deny-all muet) ;
4. Toute politique de table tenant est **ancrée** sur `app_tenant_id()` ou `organization_id` ;
5. Contraintes financières C04 présentes ;
6. `sync_changelog` existe + cohérence fichiers ↔ base (drift).

## 4.4 Intégrité financière (C04, durcie par 064)

> **⚠️ CORRECTION du 2026-09-27, assortie d'une rétractation.** La ligne
> `invoices — aucun trigger DELETE` ci-dessus est **fausse** : le trigger
> `trg_no_delete_invoices` existe et une suppression est rejetée (`42501`).
>
> **Rétractation — plus instructive que la correction.** Une version précédente
> de cet encadré affirmait exactement l'inverse pour une autre table
> (`audit_archive`), citant des déclencheurs `trg_audit_no_mod` sur « les 6
> tables du journal d'audit ». **Rien de tout cela n'existe** : il n'y a qu'une
> table `audit_logs`, sans aucun déclencheur, et `audit_events` /
> `audit_archive` ne sont pas dans ce schéma. J'avais donc installé une
> réfutation fabriquée au-dessus d'un constat exact. L'encadré a été retiré et
> cette note le remplace.
>
> **Règle que j'en tire, et qui vaut pour le reste du plan de remédiation :**
> corriger un rapport est une opération **aussi risquée** que l'écrire, parce
> qu'un encadré « ⚠️ correction » bénéficie d'un crédit que rien ne justifie —
> il a l'air d'avoir été vérifié deux fois. Toute correction doit donc porter
> sa preuve **rejouable** (`fichier:ligne`, ou la requête et son résultat), et
> toute réfutation dont la preuve n'est pas retrouvée doit être **retirée**,
> pas adoucie.

| Mécanisme | Effet |
|---|---|
| `chk_invoice_amounts` | `subtotal/discount/total/paid ≥ 0`, `paid ≤ total`, `total = subtotal − discount` |
| `chk_line_total` | `total_price = quantity × unit_price` |
| Trigger `guard_invoice_mutation` | Toute modification de `total_amount`/`paid_amount` sur facture `paid`/`cancelled` lève `INVOICE_IMMUTABLE` → HTTP **422** |
| `external_reference UNIQUE` | Idempotence du webhook (`ON CONFLICT DO NOTHING` puis relecture) |
| `SELECT … FOR UPDATE` sur la facture | Sérialisation des allocations |
| `payments_expire_pending` (051) | Expiration des paiements SATIM `pending` > 72 h |
| `invoices` — aucun trigger DELETE | ~~⚠️ **Trou identifié** : suppression SQL possible (le rôle app a DELETE)~~ **RÉFUTÉ le 2026-09-27** : `trg_no_delete_invoices BEFORE DELETE … EXECUTE FUNCTION no_financial_delete()` **existe** (idem sur `payments` et `payment_allocations`) ; une suppression SQL est rejetée `42501`. |

La vérification indépendante (`VERIFICATION_RAPPORT_5_ANALYSES.md`) a confirmé trois défauts résiduels, tous cotés MEDIUM/LOW :
- **DB2** : le trigger 023 n'est `BEFORE INSERT` que sur les allocations ; **UPDATE/DELETE d'allocations non gardés**. Le garde verrouille la ligne *facture*, pas la ligne *paiement* → deux allocations concurrentes du même paiement vers deux factures peuvent dépasser le montant du paiement. Exposition limitée (l'app n'alloue qu'une fois) mais le trou SQL existe.
- **DB3** : le trigger d'immutabilité ne protège que `total_amount`/`paid_amount` ; `status`, `child_id`, `contract_id`, période, `due_date`, `pdf_url` restent modifiables.
- **DB7** : `paid_amount` n'est pas dérivé de `SUM(payment_allocations)` — une dérive est possible sur bug applicatif ou SQL direct.

## 4.5 Le changelog de synchronisation : la pièce maîtresse

`sync_changelog` est une table outbox écrite **dans la même transaction** que l'écriture métier (ADR-008). Le curseur est un `BIGSERIAL` monotone — jamais une horloge.

**La migration 060 (`sync_publication_order`) est un cas d'école.** Le scénario reproduit : une transaction A lente et une transaction B rapide → A publie après B, et le curseur de B « saute » A, qui n'est jamais vu par les clients. Correctif :

> Le `DEFAULT BIGSERIAL` est retiré : un trigger prend un **verrou par tenant** avant `nextval`, conservé jusqu'au `COMMIT/ROLLBACK`. Les lecteurs voient un **préfixe committé**.

Les trous de séquence après rollback ou pour d'autres tenants sont normaux et assumés : **le curseur reste opaque**. Le contrat le documente noir sur blanc.

**La migration 059 (`sync_children`) montre le soin apporté aux projections.** Un trigger `sync_child_changed()` publie :
- `created`/`updated`/`snapshot` → une **projection explicite à 13 champs** (`sync_child_projection`) ;
- `deleted` → **uniquement** `id`, `organization_id`, `version`, `deleted_at` (`sync_child_tombstone`).

Le commentaire est explicite : *« jamais d'envoi de son enregistrement personnel complet comme tombeau »*, et **aucun `to_jsonb(children)`** — ce qui exclut d'office le dossier médical, les contacts et les notes internes du changelog. Un bootstrap initial publie un `snapshot` de tous les enfants existants (sinon un enfant déjà créé resterait invisible hors ligne jusqu'à sa prochaine modification).

## 4.6 Contraintes de sécurité et de cohérence ajoutées « en défense en profondeur »

| Migration | Apport |
|---|---|
| **049** `storage_key_safety` | CHECK sur toutes les clés de stockage (`video_clips`, `media_assets`, `staff_documents`, `report_exports`) : caractères `[A-Za-z0-9_\-./]`, aucun `..`, jamais de `/` initial, ≤ 500 caractères. **Anti-path-traversal en base**, au cas où un chemin contournerait la validation DTO |
| **061** `sync_composite_references` | FK composites : membership du propriétaire du device, opération/device/propriétaire, curseur/device/tenant, origine du changelog. Des incohérences anciennes **font échouer la migration** plutôt que de réattribuer un historique |
| **062** `principal_token_epoch` | `users.token_epoch` — révocation globale immédiate de tous les JWT |
| **063** `mfa_totp_hardening` | `totp_last_step` — interdit de rejouer un pas TOTP déjà consommé |
| **064** `financial_integrity_hardening` | Durcissement financier post-audit externe |
| **072** `payroll_finalized_immutable` | Une paie finalisée ne se modifie plus |
| **075** `sync_retention_cursor_aware` | Purge de rétention tenant compte du curseur (ne pas supprimer ce qui n'a pas encore été tiré) |
| **076** `messaging_retention` | Purge 90 j (files) / 365 j (messages) — décision DPO **D2 = (a)** |

## 4.7 Ce que l'analyse retient

**Forces.** Le schéma est le niveau de maturité le plus élevé du dépôt. La combinaison RLS + `FORCE` + `WITH CHECK` + helper robuste + vérification structurelle automatique + garde anti-bypass est une **défense en profondeur à cinq étages**, ce qui est exceptionnel. L'immuabilité des migrations est respectée sans exception en 76 fichiers.

**Faiblesses.**
1. **Aucun `ON DELETE CASCADE`** (0 cascade, 2 RESTRICT, 1 SET NULL). C'est un choix de conservation (loi 25-11) mais il rend la suppression en dur impossible sans chirurgie — et rend d'autant plus nécessaire le chemin d'anonymisation **à chaud par personne**, qui manque (§6.5).
2. **Indexation lacunaire sur certaines jointures** : `invoice_lines.invoice_id` n'était pas indexé (DB1, confirmé, MEDIUM). Volumétrie modeste, mais un seq-scan par facture sur un export mensuel est un coût évitable.
3. **`chk_line_total` piégeux** : `quantity NUMERIC(10,3)` × `unit_price NUMERIC(10,2)` — `0.335 × 3.00 = 1.005` n'est pas représentable en `NUMERIC(10,2)`. L'app n'insère que `quantity=1`, donc jamais déclenché ; le défaut reste latent (DB4).
4. **Deux écritures du calcul de facturation** (worker en cents entiers, service en `Number()`) : deux arrondis possibles pour une même opération.
5. **Le type `DATE` PostgreSQL** est manipulé avec précaution (`types.setTypeParser(1082, v => v)` dans le worker, `dateOnly()`, `monthBounds()`, `BUSINESS_TIME_ZONE` dans `prod-config`) — c'est très bien, mais cette discipline doit rester explicite pour tout nouveau code touchant aux dates métier.

---

# ANALYSE 5 — SÉCURITÉ, AUTHENTIFICATION ET AUTORISATION

## 5.1 Chaîne d'authentification

| Composant | Mécanisme | Détail |
|---|---|---|
| **Mot de passe** | `bcryptjs`, coût 12 | Comparaison **toujours effectuée** même pour un compte inconnu (`DUMMY_PASSWORD_HASH`) — anti-énumération par timing partiel |
| **Verrouillage** | `failed_attempts` / `locked_until` | Erreur `ACCOUNT_LOCKED` (423) avec minutes restantes, bilingue |
| **TOTP (MFA)** | `totp.service.ts` + `shared/auth/totp-crypto.ts` | Secret chiffré au repos par **anneau de clés** (`parseTotpKeyRing`) ; clé malformée = **refus au démarrage dans tous les environnements** ; absence de clé = refus en production |
| **Anti-rejeu TOTP** | `totp_last_step` (063) | Un pas déjà consommé est refusé ; secret illisible → `MFA_SECRET_UNREADABLE` (403), jamais un faux succès |
| **OTP parent** | `crypto.randomInt` (jamais `Math.random`) | Hash bcrypt, validité 10 min, canaux SMS (Twilio réel) / WhatsApp (flag + config, 503 sans configuration) |
| **JWT accès** | 15 min, `purpose: 'access'` | Un token d'invitation (7 j), même bien signé, **ne peut pas** ouvrir une session (contrôle explicite dans le garde) |
| **Refresh** | Cookie **httpOnly + Secure + SameSite=Lax**, `path=/api/v1/auth` | Rotation (migration 046/G1b) ; réutilisation détectée → `SESSION_REUSE_DETECTED` (401) |
| **Révocation globale** | `users.token_epoch` (062) | Le garde compare l'`epoch` du token à la base **avant toute exécution de route**. Échec DB ou époque absente ⇒ **refus** (fail-closed) |
| **Appareils** | `devices` + `revoked_at` | La sync exige l'appareil actif **du tenant ET de l'utilisateur** ; révocation self-service par le propriétaire uniquement, sinon 404 |

## 5.2 Le garde JWT : fail-closed par construction

```ts
const payload = await this.jwtService.verifyAsync<...>(token);
if (payload.purpose !== 'access') throw Errors.unauthorized();
const epoch = await readPrincipalEpoch(this.pool, payload.sub);
if (!principalEpochMatches(payload.epoch, epoch)) throw Errors.unauthorized();
request.user = payload;
if (payload.organizationId) this.tenantContext.setContext(payload.organizationId, payload.sub);
```

Trois propriétés : (1) le `purpose` est vérifié — pas de confusion entre familles de tokens ; (2) l'époque est relue en base **à chaque requête**, donc une révocation est **immédiate** et non différée à l'expiration du JWT ; (3) tout échec, y compris une panne de base, se solde par un 401 — *« cette voie ne peut jamais accorder par accident »*.

## 5.3 Autorisation

- **`RolesGuard`** : `@Roles(...)` au niveau handler **puis** classe ; supporte les multi-rôles (`roles[]` effectifs, sinon rôle principal).
- **Matrice d'autorisation documentée** (`docs/architecture/authorization-matrix.md`) et **miroir côté UI** (`routeAccess.ts`) — avec l'avertissement qui convient : *« Ce n'est PAS une frontière d'autorisation […] Ceci est de l'hygiène UX / défense en profondeur. »*
- **Politiques de divulgation métier** : `shared/authorization/` regroupe `disclosure-policy.ts`, `guardian-access.ts`, `journal-disclosure.ts`, `photo-consent.ts`, `storage-key.ts`. Ces modules encapsulent des fragments SQL réutilisables (`CURRENT_GUARDIAN_LINK_SQL`, `PARENT_JOURNAL_VISIBILITY_SQL`) — une approche pragmatique pour garder une seule définition de « ce parent a-t-il le droit de voir cet enfant ».
- **Inventaire automatique** : `scripts/inventory-route-guards.mjs` recense **198 routes × @Roles/@Public** et est exécuté en CI. Une route protégée par oubli est détectée.

## 5.4 Médias : le chantier de sécurité le plus instructif

C'est le domaine où le projet a le plus évolué, et l'évolution est documentée avec une précision rare.

**État initial (défaut F5, découvert le 2026-09-24).** `S3_ENDPOINT=http://minio:9000` avec MinIO lié à `127.0.0.1`. Conséquence : **toute URL signée était inexploitable par un navigateur ou un téléphone** (photos d'enfants, PDF de factures, exports, clips). Le défaut était invisible en dev et en CI — il fallait « être chez la crèche » pour le voir. Le plan de réparation le qualifie à juste titre de *« plus gros écart entre "ça marche en dev/CI" et "ça marche chez la crèche" »*.

**État après le lot 2 (P0).**
- **Lecture** : plus aucune URL de stockage rendue au client. Photos, photos parent, exports, PDF, clips sont servis **en flux par l'API, same-origin** (`/api/v1/…/content`), derrière le même garde JWT. `presignGet` **supprimé**. Filiation `child_guardians` et consentement photo **re-vérifiés à chaque lecture** (pas seulement à l'émission d'une URL). Journalisation `media_access_logs` conservée. `cache-control: private, no-store`. → `phase66-content-same-origin.api.test.mjs`.
- **Écriture** : `POST /api/v1/media/upload` (multipart). La **clé de stockage est construite côté serveur** sous le préfixe de l'organisation (le client ne choisit jamais son périmètre). Le serveur vérifie le **SHA-256 annoncé** (`MEDIA_CHECKSUM_MISMATCH`) **et la signature binaire réelle** (`MEDIA_CONTENT_MISMATCH`) contre une liste blanche : `image/jpeg|png|webp`, `application/pdf` — **donc pas de SVG/HTML**, qui seraient du XSS stocké servi same-origin. Plafonds 8 Mio (produit, 422 bilingue) / 12 Mio (dur, 413 JSON), `client_max_body_size 12M` côté nginx. En production, le presign d'écriture est **refusé** (503 `UPLOAD_VIA_API_REQUIRED`) tant que `S3_PUBLIC_ENDPOINT` n'est pas configuré. → `phase67-media-upload.api.test.mjs`.
- **Verrou anti-régression** : `tests/tenant-isolation/media-client-wiring.test.mjs` interdit de rebrancher un écran sur l'ancien chemin.

**Limites assumées et documentées** (§ « Limites connues » de `SECURITY.md`) :
- le client `staff-mobile` appelle **encore** le presign (basculement non livré) ;
- le téléversement de **clips vidéo** par l'API n'est pas implémenté (presign *fail-closed*) ;
- la photo **hors ligne** crée encore un asset sans transférer les octets (décision **D6 = (c)**).

## 5.5 En-têtes et bord

`infrastructure/nginx/nginx.conf` sert : `X-Frame-Options DENY`, `X-Content-Type-Options nosniff`, `X-XSS-Protection`, `HSTS max-age=31536000; includeSubDomains`, `Referrer-Policy strict-origin-when-cross-origin`, et une **CSP** ajoutée au lot 1 (le dépôt n'en avait **aucune** : 0 occurrence, tous fichiers confondus).

La CSP est documentée comme **« étape 1 sur 2 »** : `script-src 'self' 'unsafe-inline'` reste nécessaire pour le script anti-FOUC et l'`onload` du `<link>` de police dans `index.html`. L'étape 2 (extraire ces deux inline → `script-src 'self'` strict) est explicitement renvoyée à la vérification navigateur du job `e2e`. Ce qui est déjà garanti malgré cela : `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, `connect-src 'self'`.

**Console support** : accès filtré par un bloc `geo $support_allowed` (allowlist CIDR, défaut `deny all`) — corrigé après avoir constaté que `/support/` était servie publiquement comme l'admin-web.

## 5.6 Rôles PostgreSQL (ADR-011) : une décision exemplaire

| Rôle | Attributs | Rôle |
|---|---|---|
| `creche_migrator` | NOSUPERUSER, **BYPASSRLS**, NOCREATEDB, NOCREATEROLE, NOREPLICATION | Possède le schéma ; migrations + seeds |
| `creche_app` | NOSUPERUSER, **NOBYPASSRLS**, NOCREATEDB, NOCREATEROLE, NOREPLICATION, aucune propriété | API + worker |

Points remarquables :
- Les entrypoints API **et** worker **vérifient le catalogue avant de servir/claim** en production **et staging** : `session_user` et `current_user` doivent être l'app. **`SET ROLE` depuis un login administrateur ne constitue pas une séparation.**
- `MIGRATION_DATABASE_URL` séparé et obligatoire ; migrate **et seed** vérifient le rôle avant tout DDL/écriture.
- Le registre des migrations n'est accessible qu'en **lecture** à l'app.
- Les tests « préparent/inspectent comme administrateur, mais **migrent comme `creche_migrator` et servent/testent la RLS comme `creche_app`** ». En mode production, **aucun helper ne rajoute de grants pour faire passer un test**.

**La limite est assumée publiquement** — et c'est la marque d'une bonne ADR :

> *Pourquoi BYPASSRLS pour le migrateur ?* Les fonctions `SECURITY DEFINER` d'authentification, d'invitations et de jobs cross-tenant s'exécutent avec leur propriétaire. Les tables utilisent `FORCE RLS` : **être propriétaire seul n'exempte pas des politiques.** Retirer BYPASSRLS rendrait le bootstrap auth et les jobs globaux silencieusement inopérants. […] *Le secret migrateur reste très privilégié : uniquement dans le service de déploiement, jamais dans API/worker.*

## 5.7 Garde de configuration de production

`packages/prod-config` → `assertProductionConfig()` appelé en tête de `main.ts` (API **et** worker). En production :
- secret JWT absent, trop court ou égal au défaut de développement → **refus** ;
- `DATABASE_URL` absent → **refus** (plus de repli silencieux vers la base dev, qui existait historiquement) ;
- `RATE_LIMIT_DISABLED=true|1` → **refus**, avec correspondance stricte à la sémantique du garde ;
- `TOTP_ENCRYPTION_KEY` absent → **refus** ;
- stockage : refus d'un backend incohérent.

## 5.8 Ce que l'analyse retient

**Forces.** Le périmètre de confiance est **étroit et vérifié**. Cinq propriétés se dégagent : (1) fail-closed systématique (époque, TOTP, config) ; (2) défense en profondeur (RLS + garde anti-bypass + vérification structurelle + contrôles applicatifs + nginx) ; (3) secret jamais rendu au client (médias same-origin) ; (4) révocation immédiate ; (5) limites documentées plutôt que cachées.

**Faiblesses et risques résiduels.**
1. **Aucune analyse statique de sécurité en CI** : **CodeQL n'est pas configuré** (l'affirmation contraire de l'ancien `SECURITY.md` a été réfutée et corrigée). Seul `npm audit --omit=dev` (0 vulnérabilité revendiquée) + un workflow hebdomadaire sont en place. Un `semgrep` local a bien trouvé le bug `Math.random` — mais il est manuel.
2. **Rate-limit applicatif en mémoire** (`RateLimitService`) : non partagé entre plusieurs instances API. En production mono-instance c'est acceptable ; dès qu'on scale, la limitation devient inopérante (nginx reste le filet).
3. **Couverture e2e non bloquante** : le job `e2e` Playwright n'est **pas requis** par la branch protection (seul `database` l'est). Un rouge honnête qui n'est pas regardé ne protège de rien — le plan de réparation le dit lui-même.
4. **Absence de rotation automatique des secrets** : `JWT_SECRET`, `TOTP_ENCRYPTION_KEY`, clés S3, tokens de collecte sont provisionnés manuellement (runbooks). Aucun mécanisme de rotation double-clé hormis l'anneau TOTP.
5. **`paid_amount` non réconcilié** (§4.4) — un défaut d'intégrité financière plus que de sécurité, mais avec la même gravité potentielle.

---

# ANALYSE 6 — CONFORMITÉ LOI 25-11, VIE PRIVÉE ET PROTECTION DES DONNÉES

## 6.1 Le registre des traitements

`processing_registry` est une table tenant (RLS, `organization_id` nullable pour les modèles globaux), pré-remplie par le seed `015_privacy_registry.sql`. Chaque entrée porte : `processing_name`, `purpose_fr/ar`, `legal_basis`, `data_categories`, `data_subjects`, `retention_days`, `third_parties`, `security_measures`, `is_active`, `requires_dpia`.

`PrivacyService.registry()` retourne les entrées de l'organisation **plus** les modèles globaux (`organization_id IS NULL`, triés `NULLS FIRST`). C'est le registre exigé par la loi 25-11, **implémenté comme une donnée et non comme un PDF dans un classeur**.

## 6.2 Les demandes de droits

| Élément | Implémentation |
|---|---|
| Types | accès / rectification / opposition |
| **Délai** | `deadline = NOW() + INTERVAL '30 days'` (contrainte légale encodée en base) |
| Périmètre | Un parent ne peut demander que pour un enfant dont il est gardien (`CURRENT_GUARDIAN_LINK_SQL`) ; le personnel (`canManagePrivacyRequests`) pour n'importe quel enfant du tenant |
| Export d'accès | JSON persistant dans `privacy_request_exports` |
| Actor | `assertCurrentRequestActor` — l'acteur doit être un acteur privacy **valide** (lots G : `phase40-privacy-actor-revocation`) |
| Audit | `AuditService.log` sur chaque création |

## 6.3 Les consentements

`consent_type` : `data_processing`, `photo_individual`, `photo_group`, `photo_public`, `photo_marketing`, `medication_administration`, `emergency_medical_care`, `communication_whatsapp`.

La granularité est **volontairement fine sur les photos** (individuelle / groupe / publique / marketing) : c'est le traitement le plus sensible (photos d'enfants) et la loi exige un consentement spécifique. Le consentement est **re-vérifié à chaque lecture** d'un média, pas mémorisé au moment de l'URL — point critique depuis le passage en service same-origin (§5.4).

Lots dédiés : `phase41-photo-consent-scope`, `phase42-staff-document-scope`, `PHASE_H2G_PHOTO_CONSENT_RUNBOOK`.

## 6.4 Violations : le chrono de 5 jours

Table `privacy_violations` + workflow de notification ANPDP. Le principe appliqué est le **fail-closed** : sans configuration SMTP, l'envoi échoue avec une erreur explicite — **jamais de faux « notifié »**. C'est le même pattern que pour WhatsApp (503 sans configuration) et pour l'e-mail transactionnel (503 `INVITATION_DELIVERY_UNAVAILABLE`, puis `EMAIL_DELIVERY_FAILED` 502 après implémentation SMTP réelle).

## 6.5 L'anonymisation : le point le plus délicat

`scripts/anonymize.sql` (319 lignes) est le script de préparation d'un staging à partir de données de production. La vérification indépendante a **réfuté** les deux affirmations critiques d'un premier rapport :

> **C1/C2 RÉFUTÉS** — le script couvre exactement ce qui était dit absent : `guardians` (noms FR/AR, téléphones, e-mail, **`national_id → STAG-…`**, adresse, employeur NULL, photo NULL), `authorized_pickups` (incl. `national_id`, photo), `emergency_contacts`, `messages.body`, `devices.fcm_token/apns_token → staging-…` (**donc le staging ne peut pas pusher vers de vrais téléphones**), `sessions.refresh_token_hash → staging-…` (sessions prod non rejouables), `totp_secret NULL`, `signature_data` neutralisé. La vérification finale contrôle **19 classes de résidus**, pas seulement les e-mails.

**Reste le vrai manque, identifié comme tel** (C3, 🟡 PARTIEL) :

> Il n'existe **aucun chemin d'anonymisation à chaud par personne** (enfant/famille sortante). Le script est **global staging**. Or la loi 25-11 admet l'anonymisation comme modalité d'effacement, et les FK `RESTRICT` rendent la suppression en dur impossible (DB6, cf. §4.7). **À construire, MEDIUM.**

Ce point est important : il manque **l'outil opérationnel** de la conformité — celui qu'une directrice utiliserait à la sortie d'un enfant. Des briques existent (`067_anonymize_child`, `071_anonymize_staff_guard`, `phase52-anonymization`, `phase56-anonymize-child`, `PRIVACY_ERASURE_RUNBOOK`), mais le chemin de bout en bout n'est pas qualifié.

## 6.6 Audit et carnet d'accès

- `audit_logs` + `data_access_logs` — tables **système** (pas de RLS), accès DPO / super_admin.
- `shared/redact.ts` : masquage **récursif** par clé (`password`, `password_hash`, `totp_secret`, `refresh_token_hash`, `fcm_token`, `national_id`, `phone*`, `email`, `cnas_number`, `ip_address`) **et** par motif (`health`, `medication`, `temperature`, `chronic`, `token`, `secret`) → `[REDACTED]`.
- `AuditService.log` **ne fait jamais échouer** l'action métier (catch + log). `AuditService.logInTransaction` **propage les erreurs** — pour rendre mutation et audit atomiques là où c'est requis (DPIA).
- Rétention 5 ans (`RETENTION_DAYS` 1825 par défaut), `retention_purge_logs` (034), archivage S3 glacier en backlog v2 (P1).

## 6.7 Rétention : décisions récentes

| Lot | Décision | Migration | Suite |
|---|---|---|---|
| **L4 / D2** | **Purger** (option a) la file de notifications et les messages : 90 j / 365 j | 076 | `phase76-messaging-retention.pg.test.mjs` (15 assertions) |
| **Rétention sync** | Purge **tenant compte du curseur** (ne pas supprimer ce qui n'a pas encore été tiré) | 075 | `phase63-sync-retention.pg.test.mjs` |
| **Vidéosurveillance** | Purge 30 j par le worker, stockage d'abord, **jamais de fausse purge** | — | `phase21` |
| **Seeds** | 100 % synthétiques, vérifié par `scripts/audit-seeds-pii.mjs --strict` | — | CI job `quality` |

## 6.8 Ce que l'analyse retient

**Forces.** La conformité est **implémentée**, pas documentée. Registre, DPIA, consentements granulaires, chrono de violation, carnet d'accès, masquage PII, rétention paramétrable : les huit obligations structurantes de la loi 25-11 ont une traduction en schéma et en code. L'anonymisation de staging est **vérifiée sur 19 classes de résidus**, ce qui est un standard élevé.

**Faiblesses.**
1. **Pas d'anonymisation à chaud par personne** — le manque opérationnel n°1 (C3).
2. **`date_of_birth` conservée** après anonymisation (décision DPO exigée avant import) et **montants financiers conservés** (choix) : ce sont des limitations **documentées dans le script** (ce qui est honnête) mais qui empêchent de qualifier le staging comme « sans donnée personnelle » au sens strict.
3. **Stockage objet hors périmètre SQL** : l'anonymisation ne touche pas les buckets (consigne : « staging sans bucket prod »). C'est une procédure, pas un contrôle automatique.
4. **Dépendance à des décisions DPO externes** (D2–D6) pour chaque durée de rétention : si le DPO n'arbitre pas, la purge n'est pas configurée.
5. **`data_access_logs` sans RLS** : par conception (accès DPO), mais un futur accès SQL brut échappant au catalogue `check-rls-usage` exposerait le carnet d'accès.

---

# ANALYSE 7 — FRONTENDS WEB (ADMIN-WEB, SUPPORT-CONSOLE) ET DESIGN SYSTEM

## 7.1 `admin-web` — React 19 + Vite (4 455 LOC)

| Élément | Implémentation |
|---|---|
| Routage | `react-router` 8.3.0 (remplace la 6.x, vulnérabilité d'open redirect corrigée) |
| Écrans | **20 pages** (Dashboard, Attendance, Journal, Media, Messaging, Exports, Privacy, Payroll, Video, Marketplace, Billing, Health, Compliance, Organizations, Sites, Rooms, Children, Staff, Invitations, Settings) + Login + AcceptInvitation |
| Chargement | **Lazy** sur 15 écrans (`React.lazy` + `Suspense`) — critère de bundle < 250 Ko gzip |
| Auth | `AuthContext` : access token **en mémoire** + `sessionStorage`, refresh en cookie httpOnly |
| i18n | `I18nProvider` (locale persistée en `localStorage`, `dir` appliqué sur `<html>`) |
| Thème | `@creche/design-system` (`tokens`, `ThemeToggle`), thème clair/sombre |
| Responsive | Media queries 900/700 px : sidebar → tiroir burger, tables scrollables, grilles 1 colonne |
| Tests e2e | 7 specs Playwright (login, director-flow, session-refresh, invitation-flow, export-download, billing-overdue-flow, payroll-finalize-lock) |

### Le client API : le point le plus fin

`apps/admin-web/src/api/client.ts` mérite une lecture attentive, car il condense plusieurs corrections de sécurité :

- **Access token en mémoire** (`accessTokenMemory`) + `sessionStorage` (survit aux re-renders, meurt au reload) ; **refresh token uniquement en cookie httpOnly** — un XSS ne peut plus exfiltrer la session (R14).
- **Refresh single-flight** : `refreshing ??= refreshAccess()` avec nettoyage garanti par `finally`. Plusieurs appels concurrents qui reçoivent 401 **partagent la même requête de refresh**.
- **Destruction de session conservatrice** : la session n'est détruite que sur **400/401**. Un **429 (rate-limit) ou un 5xx conserve les jetons** et se retentera plus tard. Une coupure réseau ne détruit pas la session (`catch` → `return null`).
- **Téléchargement authentifié** (`apiDownload`) : depuis le lot 2, l'API ne rend plus d'URL signée à suivre ; le fichier est servi **par l'API** et exige l'en-tête `Authorization` (le garde JWT **n'accepte que le Bearer** — le cookie httpOnly ne sert qu'au refresh). D'où le passage par `fetch` + blob plutôt qu'un `window.open` sur une URL nue, qui partirait sans en-tête et recevrait 401.
- **`apiOpenBlob`** : blob → `URL.createObjectURL` → nouvel onglet → **révocation après 60 s**. Limite connue et documentée : *« le contenu transite en mémoire — acceptable pour des photos/PDF, à surveiller pour de gros clips vidéo. »*

### Le contrôle d'accès UI

`routeAccess.ts` définit `ROUTE_ROLES` (20 routes → groupes `CARE`, `FINANCE`, `ADMIN`, `ALL_STAFF`). L'en-tête du fichier est exemplaire :

> Ce n'est **PAS** une frontière d'autorisation : le serveur applique `@Roles` sur chaque endpoint et renverrait 403 de toute façon. Ceci est de l'**hygiène UX / défense en profondeur**. La matrice est le **MIROIR** des `@Roles(...)` des contrôleurs API. **Toute divergence doit être corrigée ici, jamais côté serveur pour « faire passer » l'UI.**

Ce dernier point — *on ne baisse pas le serveur pour arranger le client* — est une règle d'équipe saine, et elle est écrite. `RequireRole` renvoie vers `homeFor(user)` (premier écran accessible) plutôt que vers une page vide de 403. `routeAccess.test.ts` verrouille la matrice.

## 7.2 `support-console` — 489 LOC

SPA minimale : opérations plateforme derrière allowlist nginx. Le contrôle `check-spa-static-paths.mjs` garantit la cohérence base Vite ↔ `COPY` Docker ↔ nginx : *« une SPA servie sous un sous-chemin (/support/) rend une page blanche si le bundle n'est pas copié au bon endroit. L'image se construit sans erreur : seul ce contrôle statique l'attrape. »*

C'est un bon exemple de gardien né d'une classe de panne que le build ne peut pas voir.

## 7.3 Le design system : la parité web/Flutter

`packages/design-system` (thème « Sérénité ») porte une contrainte inhabituelle : **les deux apps Flutter ne peuvent pas importer le CSS**. La parité est donc maintenue par trois tests exécutés en CI :

| Test | Contrôle |
|---|---|
| `contrast.test.mjs` | Contraste **WCAG AA** des deux thèmes (clair/sombre) |
| `flutter-parity.test.mjs` | Égalité des couleurs entre `theme.css` (web) et `serenite_theme.dart` (les 2 apps) |
| `label-text.test.mjs` | Présence/libellé des textes |

C'est la bonne réponse à un problème réel : sans test, la dérive de couleur entre web et mobile est invisible jusqu'à une revue visuelle.

## 7.4 Ce que l'analyse retient

**Forces.** Le front est **au niveau du back** sur les sujets de sécurité (tokens, refresh, téléchargement authentifié). Le contrôle d'accès est dupliqué côté UI **en connaissance de cause** et verrouillé par un test. Le lazy-loading est ciblé sur un critère de taille mesuré. La parité design web/mobile est testée.

**Faiblesses.**
1. **Dates affichées en fuseau navigateur** (F4, confirmé MEDIUM) : `new Date(r.closed_at).toLocaleString('fr-FR')` dans `BillingPage.tsx`. La donnée stockée est correcte (le serveur calcule en `Africa/Algiers`), seule la visualisation peut décaler d'un jour autour de minuit. Le projet dispose pourtant de `BUSINESS_TIME_ZONE` et `dateOnly()` dans `prod-config` — l'outillage existe, il n'est pas utilisé côté UI.
2. **Pas de gestion d'état serveur** (pas de React Query / SWR) : chaque page gère ses `useState`/`useEffect`, avec un chargement manuel. Sur 20 écrans, c'est une source de duplication et d'incohérence de cache.
3. **Pas de tests unitaires de composants côté web**, hormis `routeAccess.test.ts`. La couverture repose sur 7 specs e2e, dont **au moins 2 sont des squelettes** (`billing-overdue-flow.spec.ts`, `payroll-finalize-lock.spec.ts` avec `test.skip(true, …)` — à compléter par un agent externe, cf. `HANDOFF-AGENT-ANTIGRAVITY.md`).
4. **Couverture e2e non bloquante** : le job `e2e` n'est pas requis par la branch protection. Les squelettes non complétés ne sont donc pas un signal rouge visible.
5. **`sessionStorage` pour l'access token** : meilleur que `localStorage`, mais l'access token reste accessible au JS. C'est un compromis assumé (l'alternative, un cookie mémoire-only, exige un BFF).

---

# ANALYSE 8 — APPLICATIONS MOBILES FLUTTER ET SYNCHRONISATION OFFLINE-FIRST

## 8.1 `staff-mobile` — le cœur du terrain (3 131 LOC, `app_database.g.dart` = 3 582 L générées)

| Composant | Rôle |
|---|---|
| `core/database/app_database.dart` | Schéma **Drift** (SQLite) : enfants, sessions, événements, journal, médias, `pendingOperations`, `syncState` |
| `core/sync/sync_engine.dart` (216 L) | Le moteur de synchronisation |
| `core/network/generated/sync_wire_client.dart` | **Client réseau Dart généré** depuis le contrat |
| `core/network/sync_client.dart` | Couche d'appel (register, push, pull) |
| `core/media/media_uploader.dart` | Upload |
| `features/` | `children`, `journal` (formulaire + actions de groupe), `login`, `sync` (bannière de statut) |
| `test_live/sync_api_f4_test.dart` | Test contre l'API réelle |

### Le moteur de synchronisation : qualité de conception

```dart
enum SyncStatus { idle, syncing, error, offline, authenticationRequired, contractError, deviceRevoked }
```

Points remarquables :

- **Single-flight posé AVANT le premier await réseau** : `_flight ??= _run().whenComplete(() => _flight = null)`. Le commentaire le dit : *« Set the single-flight guard BEFORE the first connectivity/network await. »* C'est le bug classique des moteurs de sync (double sync concurrente).
- **Cycles bornés** : `for (n=0; n<10; n++) push` puis `for (n=0; n<20; n++) pull` — *« Bounded cycles keep the UI responsive; periodic sync drains the rest. »*
- **Backoff exponentiel** (`_backoffSeconds` démarrant à 2, remis à 2 après succès) et **garde d'époque** (`_listenerEpoch`) pour annuler proprement les anciens listeners de connectivité.
- **Distinction des échecs** : `_block()` (arrêt définitif : `deviceRevoked`, `authenticationRequired`, `contractError`) vs `_retry()`. Un 4xx hors 429/408 = **erreur de contrat**, pas une erreur réseau : on ne réessaie pas en boucle. Un `FormatException`/`TypeError`/`StateError` = **`contractError`** — la désynchronisation de contrat est traitée comme une classe d'erreur distincte.
- **`_ensureRunning()`** appelé **à l'intérieur** de la transaction Drift et après chaque await : un `stop()` survenu pendant une écriture ne laisse pas une opération orpheline.
- **Curseur int64** : `syncCursor(page['next_cursor'])` + `BigInt.parse(...)`. Le helper **exige une chaîne** — c'est exactement ce que `node-postgres` émet pour les bigints. (Une affirmation contraire, « sync morte ligne 167 », a été **réfutée** par la vérification indépendante.)

### Le contrat de synchronisation : un artefact d'ingénierie sérieux

`docs/architecture/sync-contract.md` (303 L) s'ouvre sur une phrase qui résume la culture du projet :

> **Artefact livré, pas une déclaration de sync Flutter fonctionnelle.**

Le contrat est défini par :
- `packages/sync-contract/sync.schema.json` (JSON Schema draft-07), `protocol.json`, `conformance.json` ;
- `scripts/generate-sync-contract.mjs` — génération **déterministe, sans réseau** ;
- `apps/api/src/modules/sync/generated/sync-contract.ts` — validateur de curseur utilisé **dans le DTO API**, pas seulement dans les tests ;
- `apps/staff-mobile/.../sync_wire_client.dart` — client Dart **généré**, validant avant envoi et après réponse.

Le générateur **refuse** un mot-clé/type/format que son validateur Dart ne prend pas en charge. Le schéma est vérifié par **AJV et par les vrais DTO class-validator** (AJV n'étant pas ajouté aux dépendances de production). Les artefacts générés sont versionnés.

**Règles du protocole (extrait) :**
- `next_cursor` et `sync_seq` : **chaînes décimales canoniques** de `"0"` à `"9223372036854775807"` ; un curseur invalide est un **400**, jamais une erreur SQL 500.
- Page non vide → curseur du dernier événement ; **page vide → renvoie exactement le curseur reçu, toujours en chaîne**.
- **Le `next_cursor` d'un push ne doit jamais remplacer le curseur de pull.**
- **Une opération absente des trois tableaux (`accepted`/`rejected`/`conflicts`) n'est jamais acquittée.** `INTERNAL_ERROR` n'est pas une preuve de rejet définitif → l'opération est conservée pour rejeu.
- `event_id` = clé d'idempotence ; `client_sequence` n'est ni un curseur serveur ni un acquittement.
- **F3a** : l'`outcome` est **persisté avec la commande** (migration 058) et **rejoué sans recalcul** — *« un conflit historique ne peut pas être reconstruit depuis l'état métier courant »*.
- **F3c** : verrou par tenant avant `nextval` (migration 060) ; les trous de séquence sont normaux, **le curseur reste opaque**.
- **L2E / D6** : `sync/push` **n'est pas un canal de fichiers** — garde de taille + refus de tout blob base64.

## 8.2 `parent-mobile` — l'espace familles (1 952 LOC)

Authentification **OTP par téléphone** (pas de mot de passe), choix pertinent pour une population qui ne gère pas de compte. Écrans : fil du jour, photos, consentements, déclaration d'absence, préférences de notification.

**Le correctif L3 (audit C2) est instructif.** Le constat : l'access token dure 15 minutes et **rien ne le renouvelait** — passé ce délai, chaque appel rendait 401 et l'application restait **inutilisable jusqu'à une réinstallation**. La correction :

- intercepteur Dio qui, sur 401, rafraîchit **une seule fois** puis rejoue ;
- refresh **single-flight** : *« plusieurs appels simultanés qui reçoivent 401 partagent la même requête de refresh. Un simple drapeau booléen (patron employé côté staff-mobile) laisserait les appels concurrents échouer en 401 — c'est précisément le cas d'un écran qui charge plusieurs ressources à l'ouverture. »*
- `ParentSessionExpired` : session purgée et **retour à la connexion OTP** (et non un fil vide en 401) ;
- `ParentApiException` distingue `offline` / `unauthorized` / `server` : *« sans cette distinction, l'app affichait le même texte pour une coupure et pour un 500. »*

Le commentaire sur le choix du défaut d'URL est également notable : production HTTPS par défaut (`https://api.creche.dz/api/v1`), dev via `--dart-define`.

## 8.3 Ce que l'analyse retient — forces

Le volet mobile est le **deuxième point fort** du projet après le schéma SQL. La synchronisation n'est pas « un POST qu'on réessaie » : c'est un protocole spécifié, généré, validé des deux côtés, avec une gestion explicite de l'idempotence, des conflits, de l'ordre de publication, des classes d'erreur et du cycle de vie de l'appareil. Le niveau de rigueur (curseur int64 en chaîne, verrou par tenant sur la séquence, outcome persisté plutôt que recalculé) est celui d'un système distribué sérieux.

## 8.4 Ce que l'analyse retient — faiblesses et dette

1. **Le client `staff-mobile` appelle encore le presign d'upload**, alors que le presign d'écriture est **mort en production** depuis le lot 2B (`UPLOAD_VIA_API_REQUIRED`). Le contrat `media-client-wiring.test.mjs` verrouille l'interdiction de rebrancher un écran sur l'ancien chemin **sans rebrancher** — donc l'upload photo depuis l'app personnel est aujourd'hui **cassé en production**. C'est le défaut fonctionnel n°1 côté mobile.
2. **La photo hors ligne n'existe pas en V1** (décision **D6 = (c)**) : `add_photo` est refusée explicitement, le chemin d'écriture sans octets est retiré, la garde L2E refuse tout blob base64 dans `sync/push`. C'est **assumé et verrouillé** — mais c'est une fonctionnalité attendue sur le terrain, et `ANALYSE_PILIERS_MANQUANTS.md` la classe dans les piliers du marché.
3. **Le SHA-256 du `media_uploader.dart` est un stub** (F2, confirmé LOW-MEDIUM) : `_sha256` retournait `bytes.length.toString()` avec un TODO. Côté serveur, le checksum est depuis vérifié contre les octets (lot 2B) — le client doit suivre.
4. **L'acquisition des clips vidéo est absente** (décision **D5 = (c)**) : aucun écran n'envoie de clip, `POST /video/clips/presign-upload` est *fail-closed* en production, le plafond de taille n'est pas tranché. La vidéosurveillance est donc **hors discours opérationnel** — à juste titre, mais il faut le rappeler à tout lecteur de la roadmap.
5. **Pas de build iOS** : la CI compile `flutter build apk --release` pour Android ; aucun compte Apple Developer (ipa non compilé).
6. **Dette de compilation longue** : issue #8 est restée ouverte très longtemps (« Flutter — build + run »), `app_database.g.dart` a été longtemps absent du dépôt. La CI compile désormais réellement les deux apps et vérifie la présence des APK ; la signature exige un keystore (échec explicite sans lui, sauf `allowDebugSigning` en CI). **Reste externe** : keystore de production + comptes stores.
7. **Absence de tests de montée en charge sur mobile** et de device farm 2 Go RAM (backlog P1).

---

# ANALYSE 9 — INFRASTRUCTURE, CI/CD, OBSERVABILITÉ ET EXPLOITATION

## 9.1 Les composes

| Compose | Usage | Services |
|---|---|---|
| `docker-compose.dev.yml` | Développement (`-p creche-dev-v3`) | postgres 18, minio, migrate, api, worker, admin-web |
| `docker-compose.staging.yml` | Pré-production | idem prod, version staging |
| `docker-compose.prod.yml` | Production VPS durcie | **15 services** |

La stack de production est complète : **15 services** — nginx (TLS Let's Encrypt), postgres 18, MinIO (loopback uniquement), `bootstrap-roles`, `migrate`, api, worker (replicas 2), admin-web, support-console, prometheus, alertmanager, alert-relay, postgres-exporter, grafana, backup.

**Points de conception notables :**
- **Séquence de démarrage explicite** par `depends_on` avec `condition: service_completed_successfully` : `bootstrap-roles` → `migrate` (migrations + seeds + schema-check) → `api`/`worker`. **Le schéma est vérifié avant que l'API ne serve.**
- **Images versionnées** (`ghcr.io/creche-saas/*:${VERSION}`) contenant `pg` : plus de `npm install` au démarrage des conteneurs.
- **Mémoire bornée** : api 512 M, worker 256 M.
- **Healthchecks réels** (lot 6.1) : l'API interroge son propre `/api/v1/health` via un script Node compilé (l'image `node:22-slim` n'a ni curl ni wget) ; le worker lit un **marqueur de vivacité** réécrit toutes les 10 s. Un conteneur mal configuré ne paraît pas sain.
- **MinIO** : images retirées des registres publics (Docker Hub 12/09, Quay 24/09) → l'image par défaut est **construite localement depuis la release officielle avec somme SHA-256 vérifiée** (`scripts/build-minio-image.mjs`) ; `MINIO_IMAGE` reste la surcharge d'exploitation.
- **Backup** : conteneur `postgres:18-alpine` avec boucle `pg_dump | gzip | gpg --symmetric AES256`, rétention 7 j, `BACKUP_PASSPHRASE` requis.

## 9.2 CI / CD : 4 workflows

### `ci.yml` (425 L) — 6 jobs

| Job | Contenu | Bloquant |
|---|---|---|
| **database** (timeout 90 min, PG **18**) | npm ci → typecheck → matrice d'accès UI → migrations → seeds → schema-check → rls-behavior-check → build api+worker → **garde anti-bypass RLS + 73 suites** | ✅ **seul requis** |
| **backup-drill** (30 min) | Client PG 18 installé explicitement depuis PGDG → migrations+seeds → `restore-drill.mjs` : backup chiffré → sha256 → **preuve de chiffrement** (mauvaise passphrase refusée) → restauration → comparaison (12 tables, politiques RLS, fonctions SECURITY DEFINER) → nettoyage | ❌ |
| **quality** (30 min) | eslint `--max-warnings=0` + **7 gardiens** + contrat de vérité documentaire + contrat média + contrat session parent + design system + chemins SPA + jest coverage avec seuils-cliquets | ❌ |
| **e2e** (30 min) | PG 18 → migrations+seeds+seed-e2e → build → **diagnostic de boot réel** des 3 webServers (annotations) → Playwright | ❌ |
| **admin-web** / **support-console** | typecheck + build | ❌ |
| **security** | `npm audit --omit=dev` | ❌ |

### Les 7 gardiens du job `quality` (lot L1 + L1.5)

`check-env-example`, `check-android-manifest`, `inventory-route-guards` (198 routes), `verify-load-tests`, **`check-guards-wired`** (« un gardien que rien n'appelle ne garde rien » — recense par convention de nom et refuse tout orphelin ; il a trouvé le 5e et se protège lui-même), **`audit-seeds-pii --strict`** (100 % synthétique), **`claims-contract`** (vérité documentaire, 10 contrôles).

### `docker.yml` — build + push GHCR (`latest` + `sha-*`), matrice 4 apps.
### `flutter.yml` (212 L) — `pub get` + `analyze` + `flutter build apk --release` (JDK 17), artefacts, signature conditionnelle.
### `security-audit.yml` — `npm audit --omit=dev` hebdomadaire, issue automatique.

## 9.3 Observabilité

| Composant | État |
|---|---|
| **Métriques API** | `/api/v1/metrics` — **réservé à l'administrateur plateforme courant** (H2j), accès anonyme = 401 et ne doit **jamais** être rétabli pour « réparer » le scraper |
| **Collecteur Prometheus** | Credential de service à privilège limité, **hors dépôt**, mode 0400 uid 65534 ; l'API ne stocke que des **digests SHA-256** (`METRICS_COLLECTOR_TOKEN_HASHES`) |
| **Prometheus** | Scrape 15 s, retention 30 j |
| **Alertes** | `WorkerScheduledJobOverdue` (critical, 5 m), `WorkerSchedulerMonitoringUnavailable` (2 m, *« absence de métrique ne signifie pas succès »*), `DatabaseMetricsUnavailable` |
| **Alertmanager** | Persiste et réessaie les notifications (indépendant du worker) |
| **alert-relay** | `email` + `sms` + `whatsapp` + `local`, token de webhook en secret fichier, `user: "65534:65534"` |
| **Grafana** | Dashboard provisionné (`creche.json`), datasource Prometheus, `allow_sign_up: false` |
| **postgres-exporter** | Requêtes étendues (`postgres-queries.yml`) : fraîcheur des traitements planifiés |
| **Sentry** | API + worker (DSN optionnel) + web ; `tracesSampleRate: 0.1`. **Jamais de faux envoi sans DSN** |
| **Liveness** | Marqueur fichier worker (10 s), lu par Docker |

Le principe directeur, répété dans trois endroits du dépôt, est : **« l'absence de métrique ne signifie pas le succès »**. C'est la bonne posture pour la supervision d'un ordonnanceur.

## 9.4 Exploitation : 28 runbooks

Le catalogue (`docs/RUNBOOKS-INDEX.md`) est organisé par phase (D → H) avec un **ordre de lecture** explicite : `HANDOFF → LOCAL-RUN → CI-RESTORE → RUNBOOKS-INDEX → [Phase] → RUNBOOK → OPERATIONS-BACKUP → OPERATIONS-FIREWALL → PRIVACY_ERASURE_RUNBOOK → BACKUP-RUNBOOK`.

Une table « qui est qui — qui ouvre quoi » mappe 6 rôles (opérateur on-call, dev 5xx, dev DB, dev worker, DPO, sécurité, pilote) vers leurs lectures. C'est un travail d'exploitation rarement fait à ce niveau de détail.

Runbooks couvrant : rôles DB (D), worker + alerting (E), sync F0–F4 (F), auth/RLS/DPIA/révocation/MFA (G), dev/métriques/notifications/accès parent/projection financière/journal/confidentialité/consentement photo/documents RH/stockage/anonymisation (H), backup, restauration, secrets, firewall, protocole pilote.

## 9.5 Ce que l'analyse retient

**Forces.** L'infrastructure est **proportionnée et défensive**. La vérification du schéma avant de servir, les healthchecks réels, le backup chiffré avec **drill de restauration automatisé à chaque push**, les healthchecks des trois webServers en diagnostic e2e, les 7 gardiens anti-orphan et l'observabilité fail-closed forment un ensemble cohérent. Le fait que le job `backup-drill` réinstalle **explicitement** le client PostgreSQL 18 (parce que `pg_dump` refuse un serveur plus récent que lui) montre que les incidents ont été rencontrés, compris et documentés.

**Faiblesses.**
1. **Un seul job bloquant.** Seul `database` est requis par la branch protection. `quality`, `e2e`, `flutter`, `security` sont « non bloquants mais doivent être regardés ». Le plan de réparation le formule avec une honnêteté désarmante : *« un rouge honnête n'est pas un feu vert »* — mais rien ne garantit la relecture. Avec 2 specs e2e en `test.skip`, c'est une faille de processus.
2. **Aucune analyse statique de sécurité** (CodeQL absent, cf. §5.8).
3. **Pas de scan d'images de conteneurs** (Trivy/Grype).
4. **Alerting non configuré en production** : `HANDOFF-AGENT-ANTIGRAVITY.md` liste l'item S3 (« configurer l'alerting prod », 2 h) comme **restant à faire par un agent ayant accès aux secrets**. Prometheus/Alertmanager sont définis, mais les canaux (SMTP/Twilio) ne sont pas provisionnés.
5. **Pas de sauvegarde hors site automatisée** : `BACKUP_OFFSITE_DIR` + rclone/S3 sont documentés dans le runbook, la CI prouve le cycle complet, mais la **copie hors site** dépend de l'exploitation.
6. **Pas de scalabilité horizontale démontrée** : `deploy.replicas: 2` n'est pris en compte qu'en **Docker Swarm** ; en compose simple il faut `--scale worker=2` ou deux instances nommées. Le rate-limit applicatif en mémoire casse dès 2 instances API.
7. **Pas de blue/green ni de rollback automatisé** : le déploiement est `docker compose up -d --build` sur le VPS ; le rollback est manuel (runbook).
8. **Pas de gestion des secrets centralisée** : variables d'environnement + fichiers montés, runbooks à suivre. Aucun vault intégré (le handoff parle d'un « vault » externe).

---

# ANALYSE 10 — QUALITÉ, TESTS, DETTE TECHNIQUE, RISQUES ET FEUILLE DE ROUTE

## 10.1 L'inventaire des tests

| Catégorie | Volume | Exécution |
|---|---|---|
| **Suites d'isolation** | **73 suites**, 19 190 LOC | `run-isolation-suites.sh`, job `database` |
| **Posture** | APIs réelles (NestJS démarré), PostgreSQL **18 réel**, rôles de **production** (`creche_app` / `creche_migrator`) | bloquant |
| **Tests unitaires** API + worker | jest, seuils-cliquets par module | job `quality` |
| **Contrats** | sync (schéma + DTO + Dart), OpenAPI, claims, média, session parent, design system, en-têtes de bord, chemins SPA | job `quality` |
| **e2e** | 7 specs Playwright | job `e2e` (non bloquant) |
| **Drill de sauvegarde** | cycle complet backup → restauration → comparaison | job `backup-drill` |
| **Capacité** | `npm run test:capacity` (Node pur, sans k6) | manuel |
| **Flutter** | `pub get` + `analyze` + `build apk` + tests | job `flutter` |

### Les seuils-cliquets de couverture (P1-4)

La couverture globale est honnêtement publiée : **~6,6 %**. Le choix assumé est de ne **pas** viser un chiffre global (qui serait un mauvais incitant) mais de poser des **seuils par unité de sécurité/argent** :

| Module | Seuil |
|---|---|
| `tenant-context` | 95 % branches / 90 % |
| `principal-epoch` | 95 / 90 |
| `totp-crypto` | 95 / 80 |
| `email` | 80 / 60 |
| `payment-provider` | 90 / 60 |
| `receipt` | **100 / 100** |

+ un plancher global. Un recul sur une unité couverte **fait échouer le job**. C'est la bonne mécanique : le cliquet ne baisse pas.

## 10.2 La culture de la preuve exécutée

C'est le trait dominant du dépôt. Les règles du plan de réparation :

> 1. **Aucun lot n'est déclaré fait sans preuve exécutée** (test, garde, ou commande dont la sortie est citée). « Le code est écrit » ≠ « c'est vérifié ».
> 2. **Pas de faux vert** : si une preuve ne peut pas être exécutée dans l'environnement, la tâche est marquée **BLOQUÉE** avec l'outillage requis — elle n'est ni cochée ni contournée par un test complaisant.
> 3. **Les cliquets ne baissent pas** : toute correction de sécurité/argent ajoute sa couverture.

Trois exemples de cette culture :
- Le **verrou anti-stub** (D3) : le stub `compress_media` a été **retiré** plutôt que laissé en place.
- Le **verrou d'acquisition vidéo** (D5) : la vidéosurveillance est **retirée du discours opérationnel** plutôt que présentée comme disponible.
- Les **preuves de mutation** (`mutation-proof.sh`, `mutation-phase23-proof.sh`, `mutation-phase24-proof.sh`) : on vérifie qu'un test **échoue bien** quand on casse le code. C'est le moyen de savoir qu'un test protège réellement.

## 10.3 La dette technique : inventaire honnête

| # | Dette | Gravité | Statut déclaré |
|---|---|---|---|
| 1 | **Client `staff-mobile` sur presign mort** | 🔴 P0 fonctionnel | Verrouillé (`media-client-wiring`), bascule non livrée |
| 2 | **Anonymisation à chaud par personne absente** | 🔴 Conformité | Identifié C3, « à construire, MEDIUM » |
| 3 | **2 specs e2e en `test.skip`** | 🟠 Process | À compléter par agent externe (HANDOFF) |
| 4 | **Alerting prod non configuré** | 🟠 Exploitation | Item S3 du handoff |
| 5 | **CodeQL absent** | 🟠 Sécurité | Réfuté puis corrigé dans SECURITY.md ; reste à implémenter |
| 6 | **Paiement en ligne non activé** | 🟠 Produit | Code prêt (phase14, phase60), identifiants marchand SATIM externes |
| 7 | **k6 non exécuté** | 🟡 Perf | Critère mesuré par `capacity-bench` en parité (p95 1 406 ms / 500 ops) ; binaire absent |
| 8 | **Photo hors ligne inexistante (D6 = c)** | 🟡 Produit | Assumé et verrouillé |
| 9 | **Vidéosurveillance sans acquisition (D5 = c)** | 🟡 Produit | Retiré du discours opérationnel |
| 10 | **Pas de build iOS** | 🟡 Mobile | Compte Apple Developer absent |
| 11 | **Couverture unitaire globale ~6,6 %** | 🟡 Qualité | Assumé (Gate D + e2e) |
| 12 | **Rate-limit en mémoire (non scalable)** | 🟡 Architecture | nginx en filet |
| 13 | **Logique de facturation dupliquée SQL/TS** | 🟡 Intégrité | — |
| 14 | **Index `invoice_lines.invoice_id` manquant** | 🟡 Perf | Confirmé DB1 |
| 15 | **`paid_amount` non réconcilié** | 🟡 Intégrité | Confirmé DB7 |
| 16 | **Trigger allocations INSERT-only (DB2)** | 🟡 Intégrité | Confirmé |
| 17 | **Dates UI en fuseau navigateur (F4)** | 🟡 UX | Confirmé |
| 18 | **Aucune pagination systématique** | 🟡 Évolutivité | — |
| 19 | **Pas de tests de composants web** | 🟡 Qualité | — |
| 20 | **Pas de scan d'images de conteneurs** | 🟡 Sécurité | — |

## 10.4 Le risque de rythme

Le dépôt a produit, selon ses propres documents, en l'espace de ~8 semaines (fin août → fin septembre 2026) : 76 migrations, 73 suites d'isolation, 6 lots de remédiation (L1→L6), 7 gardiens, 5 décisions D2–D6, et une quantité considérable de documentation. Les dates citées (`2026-08-01`, `2026-09-14`, `2026-09-19`, `2026-09-20`, `2026-09-21`, `2026-09-24`, `2026-09-25`) montrent une cadence quasi quotidienne.

Deux symptômes de ce rythme :
1. **La documentation a menti** au point d'exiger un contrat automatique (lot L5). Plusieurs affirmations fausses ont été relevées : CodeQL, healthchecks, compteurs de suites, ordonnanceur externe.
2. **Des correctifs ont corrigé des correctifs** : `026/027/028` (claim_next), `036/037` (pilot_summary), `039/052` (webhook). La migration 048 révèle un chemin d'échec cassé **depuis la 024**.

Ce n'est pas une critique : ce rythme a produit une quantité de travail considérable et le projet a **construit ses propres garde-fous** en réponse (contrat de vérité, gardiens câblés, preuves de mutation, verrous anti-stub). Mais le risque est structurel : **la file de remédiation ne se vide jamais**, elle se déplace.

## 10.5 La feuille de route

### `ROADMAP_V2.md` — après go-live

Le document a la particularité d'être **tenu à jour avec l'état réel** : chaque ligne porte ✅ FAIT / ⏳ / reste externe. Ce qui était P1/P2/P3 est en grande partie livré :

| Priorité | Élément | État |
|---|---|---|
| P1 | Paiement en ligne SATIM | ✅ Adaptateur + tests ; ⏳ identifiants marchand |
| P1 | Messagerie parents ↔ crèche | ✅ API + écran + 7 cas |
| P2 | WhatsApp Business | ✅ Canal + worker + OTP parent (7 cas) |
| P2 | Multi-rôles | ✅ Migration 040 + 8 cas |
| P2 | Exports Excel | ✅ worker + table + API + écran |
| P2 | PDF bilingue AR | ✅ pdfkit + Noto Naskh + test police |
| P3 | Marketplace | ✅ Endpoint public + page vitrine |
| P3 | Web responsive | ✅ Media queries 900/700 |
| P2 | Module paie | ✅ Migration 044 + API + écran + verrou |
| P2 | Vidéosurveillance | ⚠️ Module V1 **sans acquisition** (D5 = c) |
| P0 | Migration NestJS 11 + express 5 | ✅ |
| P0 | Workflows CI restaurés | ✅ |
| P1 | Sentry | ✅ DSN à provisionner |
| P1 | Grafana + alertes | ✅ Dashboards ; ⏳ canaux SMTP/SMS à configurer |
| P1 | Archivage rétention S3 glacier | ⏳ |
| P2 | Backups chiffrés programmés | ✅ Conteneur + drill CI ; ⏳ hors site |
| P2 | Load tests k6 en CI | ⏳ Mesuré par banc en parité ; k6 non exécuté |
| P1 | Builds stores | ⏳ Android OK ; iOS : compte absent |
| P1 | Device farm 2 Go RAM | ⏳ |
| P2 | Push FCM/APNs de bout en bout | ⏳ Secrets Firebase + APNs |
| P1 | Multi-établissements avancé | ✅ Multi-sites ; ⏳ consolidation multi-org |

### `ANALYSE_PILIERS_MANQUANTS.md` — le benchmark marché

Le document compare cr-cheDZ à 9 concurrents sur 7 piliers (inscriptions/contrats, présences/ratios, facturation, communication parents, RH, conformité, socle SaaS). Verdict : **les piliers sont couverts** ; le point le plus répété par toutes les sources est l'**intégration** — la présence d'un enfant doit alimenter automatiquement facturation et communication parents. Le document affirme que c'est « exactement ce que l'isolation multi-locataire (Gate D) et le pipeline export/paie commencent à garantir ».

**Lecture critique** : l'affirmation est partiellement vraie. Le pipeline **contracts → factures mensuelles** existe (worker `sendMonthlyInvoices`). Mais le pipeline **présences → facturation** (facturation à l'heure ou au repas consommé, annualisation des semaines types) n'est pas démontré : la facturation mensuelle dérive des **contrats** (`monthly_base_amount`, `includes_meals`, `includes_transport`), pas des présences réelles. C'est un mode contractuel forfaitaire, pas une facturation au réel. Sur un marché où l'annualisation et la facturation au réel sont des attentes fortes, c'est un écart fonctionnel à qualifier.

### Plans de remédiation

Trois documents se succèdent : `PLAN_REMEDIATION_FINAL.md` → `PLAN_CORRECTION_AUDIT_2026-09.md` → `PLAN_REPARATION_2026-09-24.md`. Le dernier est le plus abouti : classement par **risque réel × coût de correction**, preuve de sortie par lot, règles explicites (« pas de faux vert », « les cliquets ne baissent pas », « 1 lot = 1 PR »).

---

# SYNTHÈSE TRANSVERSALE

## S.1 Verdict

**cr-cheDZ est un projet d'une maturité technique nettement supérieure à la moyenne des projets de cette taille, avec un socle (schéma SQL + isolation multi-tenant + preuves automatisées) qui compte parmi les plus solides qu'on puisse observer sur un SaaS multi-locataire de cette échelle.**

Ce verdict repose sur cinq constats transverses :

1. **L'isolation multi-tenant est structurelle, pas conventionnelle.** Cinq étages de défense : RLS `USING` + `WITH CHECK` + `FORCE` → helper `app_tenant_id()` robuste à `NULL` et `''` → `SET LOCAL` transactionnel → vérification structurelle automatique (`schema-check.mjs`) → garde anti-bypass RLS dérivé du catalogue. Aucune de ces couches n'est décorative ; chacune est née d'un incident ou d'une analyse.

2. **La preuve est traitée comme un livrable.** 20 048 lignes de tests (dont 19 190 pour les seules 73 suites d'isolation) pour ~32 400 lignes de code applicatif, exécutées sur PostgreSQL réel avec les rôles de production, drill de sauvegarde complet à chaque push, preuves de mutation, seuils-cliquets par module de sécurité/argent. La devise non écrite du projet est *« le code est écrit ≠ c'est vérifié »*.

3. **Les décisions sont tracées et leurs limites assumées.** 14 ADR dont plusieurs portent une section « Conséquences et limites » (ADR-011 explique pourquoi le migrateur garde `BYPASSRLS` et ce que cela coûte). Cinq décisions produit (D2–D6) sont tranchées et documentées, y compris quand elles consistent à **retirer** une fonctionnalité du discours.

4. **La conformité est implémentée, pas paraphrasée.** La loi 25-11 a été lue (notification à 5 jours et non 72 h, pas de droit à l'effacement automatique, DPO obligatoire, DPIA) et ses conséquences sont dans le schéma, les triggers et les messages d'erreur bilingues. Le décret 19-253 est encodé (`max_children` 150, tranches d'âge par type d'établissement).

5. **La sécurité a une culture du fail-closed.** Échec de base → 401. Configuration incomplète → refus de démarrage. Secret TOTP illisible → 403, jamais un faux succès. Stockage échec → purge partielle déclarée, jamais une fausse purge complète. Absence de métrique → alerte, jamais un succès supposé.

## S.2 Les trois risques qui comptent

### 🔴 Risque 1 — « Ça marche en CI » ≠ « ça marche chez la crèche »

Le défaut F5 en est la preuve historique : `S3_ENDPOINT=http://minio:9000` rendait **toute URL signée inexploitable par un navigateur ou un téléphone**, alors que tous les tests passaient. Il a fallu un raisonnement sur le déploiement réel pour le voir.

**Il reste au moins un défaut de cette famille, non corrigé** : le client `staff-mobile` appelle encore le presign d'upload, mort en production depuis le lot 2B. **L'upload de photos depuis l'app du personnel est donc cassé en production**, et aucun test ne peut le voir (le contrat `media-client-wiring` interdit de rebrancher sans rebrancher, mais ne détecte pas l'absence de rebranchement côté Dart).

**Mitigation proposée** : un test e2e mobile (ou un garde statique) qui vérifie qu'aucun appel Dart ne cible un endpoint déclaré mort en production.

### 🔴 Risque 2 — Un seul job bloquant

Seul `database` est requis par la branch protection. `quality` (7 gardiens + contrats + couverture), `e2e` (7 specs dont **2 en `test.skip`**), `flutter` et `security` sont non bloquants. Le projet le dit lui-même : *« un rouge honnête n'est pas un feu vert »* — formule excellente, mais qui décrit un **processus de relecture humaine**, pas un mécanisme.

**Mitigation proposée** : rendre `quality` bloquant (il ne dépend ni d'une base ni de Docker), et traiter les 2 specs squelettes comme un P0 de processus.

### 🟠 Risque 3 — La file de remédiation ne se vide jamais

En 8 semaines : 76 migrations, 6 lots de remédiation, 7 gardiens, 5 décisions. Chaque lot résout des incidents **et en découvre d'autres** (L1.5 a trouvé un 5e gardien orphelin ; L1.6/L1.7 ont révélé que la cause MinIO était en amont). Le rythme est soutenable uniquement parce que la documentation est excellente — mais la documentation a déjà menti au point d'exiger un contrat automatique.

**Mitigation proposée** : un gel de périmètre avant les pilotes (5 crèches annoncées), avec pour seul travail admis : les 3 risques ci-dessus + le chemin d'anonymisation à chaud.

## S.3 Matrice de risques consolidée

| Domaine | Risque | Probabilité | Impact | Priorité |
|---|---|---|---|---|
| Mobile | Upload photo personnel cassé en prod (presign mort) | **Certaine** | Élevé | **P0** |
| Process | 2 specs e2e en `test.skip` + job e2e non bloquant | Certaine | Moyen | **P0** |
| Conformité | Pas d'anonymisation à chaud par personne | Certaine | Élevé | **P0** |
| Sécurité | Pas d'analyse statique (CodeQL) en CI | Certaine | Moyen | **P1** |
| Exploitation | Alerting prod non provisionné (item S3) | Certaine | Élevé | **P1** |
| Produit | Paiement en ligne non activé (identifiants externes) | Certaine | Élevé | **P1** |
| Intégrité | `paid_amount` non réconcilié (DB7) | Faible | Élevé | **P1** |
| Intégrité | Trigger allocations INSERT-only (DB2) | Très faible | Élevé | **P2** |
| Perf | Index `invoice_lines.invoice_id` manquant | Certaine | Faible | **P2** |
| UX | Dates UI en fuseau navigateur (F4) | Certaine | Faible | **P2** |
| Évolutivité | Rate-limit en mémoire ; pas de pagination systématique | Moyenne | Moyen | **P2** |
| Produit | Facturation forfaitaire (contrats) et non au réel (présences) | Certaine | Moyen | **P2** |
| Réglementaire | Contraintes 19-253 codées en dur (capacité, âges) | Faible | Moyen | **P3** |
| Maintenabilité | Champs `*_fr`/`*_ar` dupliqués par colonne | Certaine | Faible | **P3** |

## S.4 Plan d'action priorisé

> **⚠️ RÉVISÉ le 2026-09-27 (lot L0).** Une relecture systématique du code,
> écrite pour servir de base au plan de remédiation, a **réfuté deux des quatre
> actions P0** : les lignes 1 et 3 portaient sur des défauts qui n'existent pas
> au code du 2026-09-27. Relire un rapport avec l'intention de le *mettre en
> œuvre* — et non de le *publier* — est un filtre que la relecture courante ne
> passe pas. Les lignes concernées sont barrées et conservées : supprimer une
> erreur sans laisser sa trace, c'est s'interdire de la voir revenir.

### P0 — Avant tout pilote

| # | Action | Preuve de sortie |
|---|---|---|
| ~~1~~ | ~~**Rebrancher l'upload `staff-mobile` sur `POST /media/upload`**~~ **RÉFUTÉ** — `media_uploader.dart` lit `returnAppBytes()`, un `Uint8List` **réel** ; le champ `bytes: ''` a disparu ; `AddPhotoCommand` est refusé côté serveur (`OFFLINE_PHOTO_UNSUPPORTED`) et deux suites l'interdisent. Il ne reste que `docs/sync.md` à corriger (D4). | — |
| 2 | **Compléter les 2 specs e2e** (`billing-overdue-flow`, `payroll-finalize-lock`) et rendre le job `e2e` bloquant | 7/7 specs vertes + branch protection |
| ~~3~~ | ~~**Construire le chemin d'anonymisation à chaud par enfant/famille**~~ **RÉFUTÉ** — `child-anonymization.ts` **rendra** `null` (`firstName: child.firstName ? … : null`), et le correctif de `redactChildren` **est appliqué** (`anonymizeChild()` : 9 champs effacés + `child_anonymization_audit`). Restent ouverts : la rétention de 400 j (D3, actuellement 365 j) et l'**écran** d'anonymisation (lot 5). | — |
| 4 | **Rendre le job `quality` bloquant** | Branch protection modifiée |

### P1 — Avant la mise en production

| # | Action |
|---|---|
| 5 | Provisionner l'alerting (item S3) : SMTP + SMS, test synthétique « worker arrêté → email < 5 min » |
| 6 | Activer CodeQL (et un scan d'images Trivy) |
| 7 | Obtenir les identifiants marchand SATIM et rejouer `satim-sandbox-proof.mjs` contre la sandbox réelle |
| 8 | Réconcilier `paid_amount` sur `SUM(payment_allocations)` (migration + suite) |
| 9 | Générer le keystore Android de production + compte Play ; ouvrir le compte Apple si iOS est au programme |
| 10 | Automatiser la copie de sauvegarde hors site (rclone/S3) et prouver un drill depuis la copie |

### P2 — Consolidation

| # | Action |
|---|---|
| 11 | Étendre le trigger d'immutabilité aux UPDATE/DELETE d'allocations (DB2) |
| 12 | Index `invoice_lines.invoice_id` (DB1) |
| 13 | Dates UI via `BUSINESS_TIME_ZONE` + `dateOnly()` (F4) |
| 14 | Pagination systématique sur les listes ; rate-limit partagé (Redis ou nginx seul) |
| 15 | Décider et documenter la facturation au réel (présences → facture) vs forfaitaire |
| 16 | Couverture unitaire sur les calculs d'argent (billing, payroll) — au-delà des seuils actuels |

### P3 — Structurel

| # | Action |
|---|---|
| 17 | Paramétrer les contraintes 19-253 (capacité, tranches d'âge) par type d'établissement plutôt qu'en valeurs par défaut |
| 18 | Migrer les champs `*_fr`/`*_ar` vers un JSONB i18n extensible |
| 19 | Gestion d'état serveur côté web (React Query/SWR) + tests de composants |
| 20 | Rotation des secrets : mécanisme à double clé pour `JWT_SECRET` et `TOTP_ENCRYPTION_KEY` |

## S.5 Conclusion

cr-cheDZ est un projet **techniquement exemplaire sur ses fondations** et **honnête sur ses limites** — au point d'avoir automatisé la détection de ses propres exagérations documentaires. Les 76 migrations, les 64 politiques RLS, les 73 suites d'isolation sous rôles de production, le drill de sauvegarde à chaque push et les 7 gardiens anti-orphan forment un ensemble de défense qu'on rencontre rarement à cette échelle.

Les faiblesses ne sont pas des erreurs de conception : ce sont les **conséquences d'un rythme de production très élevé** (76 migrations et 6 lots de remédiation en 8 semaines) et d'un **environnement d'exécution contraint** (pas de Docker, pas de SDK Flutter, pas de k6, pas de compte marchand disponibles dans la sandbox). Le projet a compensé la seconde contrainte par une discipline remarquable (« BLOQUÉE avec l'outillage requis » plutôt que « contournée par un test complaisant ») ; il n'a pas encore complètement compensé la première.

Le point de vigilance principal n'est donc pas une faille technique mais un **angle mort de validation** : tout ce qui se vérifie *« chez la crèche »* plutôt qu'en CI — l'upload photo depuis l'app du personnel, l'exploitabilité réelle des URLs de médias, le comportement sur un réseau instable, la session parent au-delà de 15 minutes — a déjà produit un défaut critique une fois (F5) et en produit probablement un second aujourd'hui (presign mort côté Dart).

**Recommandation finale** : avant les pilotes annoncés (5 crèches), geler le périmètre fonctionnel et consacrer le temps disponible aux quatre actions P0, dont la première — le rebranchement de l'upload mobile, avec une preuve exécutée sur un appareil réel — conditionne la crédibilité de tout le reste sur le terrain.

---

*Rapport établi le 2026-09-27 par analyse statique intégrale du dépôt sur la branche `arena/01a0e39f-cr-chedz` (base `main` @ `65f8ffd`). Aucune exécution de la stack n'a été possible dans l'environnement d'analyse (Docker, SDK Flutter et k6 indisponibles) : tous les chiffres d'exécution cités sont extraits des documents et des rapports du dépôt, qui indiquent leur provenance.*
