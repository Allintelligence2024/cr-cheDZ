# PLAN D'IMPLEMENTATION — Logiciel de Gestion de Crèche (Algérie)

> **Document de pilotage** — basé sur l'architecture finale fournie (Parties 1 à 10).
> **Portée** : analyse critique de l'architecture + plan d'implémentation phase par phase, avec corrections techniques obligatoires, jalons, critères d'acceptation, estimations et registre des risques.
> **Version** : 1.0 — 2026-08-01
> **Équipe cible** : 3 personnes (1 backend NestJS/DB, 1 Flutter, 1 web React) — calendrier adapté pour 1 personne seule (×2 en durée).

---

## 0. Synthèse exécutive

**Verdict** : l'architecture est **excellente dans ses fondations** — monolithe modulaire, RLS PostgreSQL pour l'isolation multi-tenant, offline-first avec modèle événementiel append-only, audit conforme loi 25-11, outbox et jobs. Elle est **viable à ~90 % telle quelle**.

**Mais il y a 12 corrections obligatoires avant d'écrire la première ligne de code métier**, dont 6 bloquantes :

| # | Correction bloquante | Impact si ignorée |
|---|---|---|
| C01 | Politiques RLS `WITH CHECK` manquantes + RLS absente sur ~20 tables tenant | **Les INSERT échouent** sur les tables avec RLS (défaut deny) ; les autres tables n'ont aucune isolation |
| C02 | Curseur de synchronisation basé sur l'horloge (`EXTRACT(EPOCH…)`) | Événements perdus ou dupliqués (horloges, millisecondes, concurrence) |
| C03 | Incohérence TypeORM dans les tests alors que le code est en `pg` brut | Suite de tests inutilisable |
| C04 | Immutabilité factures/paiements non garantie en base | Facture payée modifiable, paiement webhook dupliqué |
| C05 | Pas de runner de migrations avec checksums | Schémas divergents entre dev/staging/prod, migrations modifiées rétroactivement |
| C06 | Rôle applicatif non défini (superuser implicite) | RLS contournable, risques de sécurité |

**Planning** : MVP (présences offline + journal + app parent + facturation simple, bilingue AR/FR) **fin de semaine 8** avec 3 personnes ; produit durci + console support + conformité **semaine 12** ; pilotes (5 crèches) et go-live **semaines 13–16**.

**Règle d'or** (reprise de la conclusion de l'architecture, non négociable) : avant toute fonctionnalité métier —
1. un utilisateur se connecte et reçoit un JWT portant son `organization_id` ;
2. le tenant est injecté dans PostgreSQL via `SET LOCAL app.tenant_id` ;
3. un test automatisé prouve qu'aucune donnée ne fuit entre deux tenants.

---

## 1. Analyse de l'architecture fournie

### 1.1 Forces à préserver (ne rien casser)

1. **Monolithe modulaire NestJS** — un seul déploiement, modules découplés. Bon choix pour une équipe de 3 ; évite la complexité des microservices sans bénéfice ici.
2. **Une seule base PostgreSQL + RLS** — l'isolation par `current_setting('app.tenant_id')` est le bon mécanisme. Économie d'infrastructure majeure.
3. **Offline-first avec modèle événementiel** — `attendance_events` et `daily_log_events` append-only, `sync_operations` avec `event_id UNIQUE` (idempotence), `sync_cursors` par appareil. C'est la bonne architecture pour la réalité terrain algérienne (connexion instable, salles sans Wi-Fi).
4. **Schéma riche et cohérent** — 14 migrations couvrant identité, enfants/familles, présences, journal, médias, notifications, facturation, santé, personnel, conformité, jobs/outbox. Les enums, le soft delete, `version` (optimiste) et `created_by/updated_by` sont systématiques.
5. **Conformité loi 25-11 intégrée dès le départ** — `audit_logs`, `data_access_logs` (carnet automatisé), `consent_records`, `processing_registry`, `privacy_requests`. C'est rare et précieux.
6. **Machine à états de présence explicite** — `expected → present → departed`, transitions validées côté serveur.
7. **Stockage objet séparé** (MinIO/S3) avec URLs signées — photos et documents hors PostgreSQL.
8. **Déploiement Docker Compose + nginx avec rate limiting + CI GitHub Actions** — proportionné et maintenable.
9. **Critères de validation concrets par phase** (Partie 9) — mesurables, terrain (2 Go RAM, 8 h offline, 3 min pour pointer une section).

### 1.2 Faiblesses et incohérences

| # | Constat | Impact | Correction |
|---|---|---|---|
| 1 | RLS activée seulement sur ~10 tables (enfants, présences, journal, médias, notifs, factures, allergies) ; `WITH CHECK` absent partout | Tables tenant sans isolation ; INSERT refusé sur tables avec RLS | **C01** |
| 2 | Curseur sync = horloge (`EXTRACT(EPOCH)*1000`) | Perte/duplication d'événements | **C02** |
| 3 | Tests importent TypeORM ; le code utilise `pg` | Tests non exécutables | **C03** |
| 4 | Immutabilité financière non garantie en base | Intégrité financière à la merci d'un bug applicatif | **C04** |
| 5 | Migrations SQL « fichiers numérotés » sans outil ni checksums | Dérive des schémas | **C05** |
| 6 | Aucun rôle DB défini pour l'app | RLS contournable (superuser) | **C06** |
| 7 | `consent_records.guardian_id` sans FK ; `media_assets.child_id` nullable sans garde ; `child_guardians` sans `version` ni `deleted_at` | Intégrité référentielle et traçabilité incomplètes | C07, C08 |
| 8 | `LocalChildren` (Drift) n'a pas de colonne `siteId` alors que le code Flutter l'utilise (`child.siteId` dans `checkIn`) | **Erreur de compilation Flutter** | C09 |
| 9 | Widget `Banner` du code Flutter entre en conflit avec le `Banner` de Material | Erreur de compilation | C09 |
| 10 | `result['nextcursor']` (clé inexistante) vs `next_cursor` côté serveur | Curseur jamais sauvegardé → re-téléchargement infini | C09 |
| 11 | Console support et worker annoncés dans le monorepo mais absents du plan hebdomadaire | Périmètre oublié | Intégrés aux phases P10/P11 |
| 12 | « RGPD » utilisé à tort ; la loi applicable est la **loi 18-07 modifiée par la loi 25-11** (pas de droit à l'effacement automatique, DPO obligatoire, notification ANPDP sous 5 jours, DPIA) | Non-conformité juridique | §1.4 |
| 13 | Pas de politique de rétention ni de masquage des champs sensibles dans l'audit | Violation 25-11 (photos, santé, pièces d'identité dans `old_values`/`new_values`) | C10 |
| 14 | Pas de stratégie de mise à jour du mobile (`schema_version` existe mais pas de mécanisme) | App installée en vieille version + nouveau schéma | C11 |
| 15 | `memberships UNIQUE(organization_id, user_id)` interdit les multi-rôles | Limitation assumée, mais à acter (ADR) | C12 |
| 16 | Aucun historique des changements de chambre ni des statuts enfant | Impossibilité de reconstituer le parcours | P6 |

### 1.3 Corrections obligatoires (C01 → C12)

#### C01 — RLS systématique : `USING` + `WITH CHECK` sur toutes les tables tenant

**Règle** : toute table avec `organization_id` = table tenant → `ENABLE ROW LEVEL SECURITY` + `FORCE` + politique `USING` **et** `WITH CHECK`. Les tables sans `organization_id` (`users`, `roles`, `permissions`, `organizations`, `otp_codes`, `compliance_rule_sets`, `sessions`, `audit_logs`, `data_access_logs`) sont « système » : pas de RLS, accès contrôlé par les guards applicatifs (rôles `super_admin`, DPO).

```sql
-- Modèle à appliquer à TOUTES les tables tenant
ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE children FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS children_tenant_isolation ON children;
CREATE POLICY children_tenant_isolation ON children
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);
```

Liste complète des tables tenant (RLS à ajouter) : `sites`, `rooms`, `memberships`, `devices`, `consent_records`, `privacy_requests`, `processing_registry`, `child_guardians` ✅, `authorized_pickups` ✅, `emergency_contacts`, `attendance_sessions` ✅, `attendance_events` ✅, `sync_operations`, `sync_cursors`, `daily_log_events` ✅, `daily_summaries`, `media_assets` ✅, `media_access_logs`, `notification_preferences`, `notification_queue`, `notification_inbox` ✅, `conversations` ✅, `conversation_participants`, `messages`, `contracts`, `invoice_lines`, `payment_allocations`, `daily_cash_registers`, `health_records`, `vaccinations`, `medication_authorizations`, `medication_administrations`, `staff_profiles`, `staff_documents`, `staff_assignments`, `staff_attendance`, `compliance_checks`, `background_jobs`, `outbox_events`, `feature_flags` (org nullable → politique `org_id IS NULL OR org_id = tenant`).

**Test SQL automatisé (CI, doit retourner 0 ligne)** :

```sql
-- 1) Aucune table avec organization_id ne doit être sans RLS
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname = 'public'
  AND EXISTS (SELECT 1 FROM information_schema.columns col
              WHERE col.table_schema = 'public'
                AND col.table_name = c.relname
                AND col.column_name = 'organization_id')
  AND NOT c.relrowsecurity;

-- 2) Toute politique tenant doit avoir une clause WITH CHECK (INSERT)
SELECT policyname, tablename
FROM pg_policies
WHERE schemaname = 'public'
  AND cmd IN ('ALL', 'INSERT')
  AND (with_check IS NULL OR with_check = '');
```

#### C02 — Curseur de synchronisation : horloge → séquence monotone

Le `EXTRACT(EPOCH FROM server_time) * 1000` est fragile (horloges des nœuds, deux événements dans la même milliseconde, correction d'heure). Remplacer par une **table de changements** avec `BIGSERIAL`, écrite **dans la même transaction** que l'écriture métier (pattern outbox) :

```sql
CREATE TABLE sync_changelog (
  sync_seq        BIGSERIAL PRIMARY KEY,
  organization_id UUID NOT NULL,
  aggregate_type  TEXT NOT NULL,      -- attendance_event | daily_log | child | media ...
  aggregate_id    UUID NOT NULL,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,     -- delta suffisant pour la mise à jour locale
  origin_device_id UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_changelog_org_seq
  ON sync_changelog(organization_id, sync_seq);
```

`pull(cursor)` devient : `SELECT … WHERE organization_id = $1 AND sync_seq > $2 ORDER BY sync_seq LIMIT 500`, `next_cursor = max(sync_seq)`. Le curseur est stocké côté serveur (`sync_cursors`) **et** côté appareil (le serveur fait autorité, l'appareil ne fait que le mémoriser). L'écriture du changelog remplace le `UNION ALL` de la Partie 3.5 et couvre **tous** les types d'entités (enfants, médias, corrections…), pas seulement présence/journal.

#### C03 — Unifier la pile de tests sur `pg` (pas TypeORM)

Les tests de la Partie 6 importent `typeorm` ; le code applicatif utilise `pg` brut. Décision : **tout en `pg`** (éventuellement surcouche légère type Kysely pour les requêtes complexes, sans ORM). Les tests d'isolation s'exécutent contre une **vraie base PostgreSQL** dans CI (service container `postgres:16`), pas des stubs.

#### C04 — Intégrité financière en base

```sql
-- Contraintes
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_amounts CHECK (
  subtotal >= 0 AND discount_amount >= 0 AND total_amount >= 0
  AND paid_amount >= 0 AND paid_amount <= total_amount
  AND total_amount = subtotal - discount_amount
);
ALTER TABLE invoice_lines ADD CONSTRAINT chk_line_total CHECK (total_price = quantity * unit_price);

-- Immuabilité : trigger sur facture payée/annulée
CREATE OR REPLACE FUNCTION guard_invoice_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('paid', 'cancelled')
     AND (NEW.total_amount IS DISTINCT FROM OLD.total_amount
          OR NEW.paid_amount   IS DISTINCT FROM OLD.paid_amount) THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_immutable BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_mutation();
```

- Idempotence webhook : `external_reference UNIQUE` existe ✅ — l'insertion se fait en `INSERT … ON CONFLICT (external_reference) DO NOTHING` puis relecture, dans la même transaction que l'allocation.
- Allocation : `SELECT … FROM invoices WHERE id = $1 FOR UPDATE` avant d'insérer une allocation, + `CHECK (amount_allocated > 0)`.
- L'API mappe `INVOICE_IMMUTABLE` → HTTP **422** avec le code métier (test de la Partie 6.2 conservé).

#### C05 — Runner de migrations avec checksums

Adopter un runner simple sur les fichiers SQL numérotés existants (ex. `node-pg-migrate` ou un script maison de ~100 lignes) avec :
- table `schema_migrations(filename, checksum, applied_at)`;
- refus de rejouer un fichier dont le checksum a changé;
- **une migration appliquée ne se modifie jamais** → toute évolution = nouvelle migration numérotée (ADR obligatoire);
- les migrations s'exécutent dans CI (base fraîche) et avant chaque déploiement staging/prod;
- un job CI régénère une base de test et vérifie que le schéma est identique à celui de staging (**drift detection**).

#### C06 — Rôles PostgreSQL séparés

```sql
-- Migrations/DDL exécutées par un rôle privilégié (creche_migrator)
-- L'application se connecte avec un rôle limité :
CREATE ROLE creche_app LOGIN NOBYPASSRLS;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO creche_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO creche_app;
```

- `creche_app` ne peut **jamais** exécuter `SET app.tenant_id` hors transaction (le code n'utilise que `SET LOCAL` dans `withTenantConnection`).
- Comportement safe-by-default : si `app.tenant_id` n'est pas posé, `current_setting(…, true)` retourne NULL → toute politique RLS est fausse → **0 ligne retournée** (jamais une fuite).

#### C07 — Intégrité référentielle et contraintes de données

- `consent_records.guardian_id` → FK vers `guardians(id)` (nullable si gardien supprimé, mais FK + `ON DELETE SET NULL`).
- `media_assets.child_id` → FK `ON DELETE RESTRICT` (pas de suppression d'enfant avec médias).
- `child_guardians` : ajouter `version INTEGER DEFAULT 1` et `updated_at` (modifications des permissions à tracer).
- Ajouter les contraintes `CHECK` de cohérence temporelle : `contracts.end_date >= start_date`, `staff_attendance.check_out >= check_in`, `medication_authorizations.end_date >= start_date`, `authorized_pickups.valid_until >= valid_from`, `payments.amount > 0`.
- `attendance_sessions.UNIQUE(child_id, session_date)` : conserver (un enfant = une session/jour), documenter l'ADR.

#### C08 — Historique des changements de chambre et statuts

Ajouter `room_moves` (append-only : `child_id`, `room_id_from`, `room_id_to`, `moved_at`, `moved_by`, `reason`) et `child_status_history` (ou réutiliser `daily_log_events` avec `event_type = 'status_change'` pour le MVP). Permet de reconstituer le parcours de l'enfant et les ratios éducateur/enfant rétrospectifs (conformité 19-253).

#### C09 — Corrections Flutter (erreurs de compilation identifiées)

1. `LocalChildren` : ajouter `TextColumn get siteId => text()();`
2. Renommer le widget `Banner` en `SyncBanner` (conflit avec `Material.Banner`).
3. Clé de réponse : `next_cursor` (pas `nextcursor`).
4. `SyncEngine` : gérer la reprise avec backoff exponentiel sur `attempts`, redéclencher sur reconnexion (`connectivity_plus`) et au démarrage de l'app, pas seulement toutes les 30 s.
5. `PendingOperations` : ajouter `lastError` pour l'affichage du statut par opération.

#### C10 — Audit sans données sensibles + rétention

- Dans `AuditService.log`, masquer systématiquement : `password_hash`, `totp_secret`, `national_id`, `phone`, `email`, données de santé (`health_*`, `medication*`, `temperature_celsius`), `fcm_token`, `refresh_token_hash` → remplacer par `"[REDACTED]"` (liste centralisée dans un module `shared/redact`).
- Les journaux applicatifs (logs JSON) ne contiennent jamais de PII (middleware de logging qui filtre body/query).
- Rétention : `audit_logs` et `data_access_logs` conservés **5 ans** (recommandé au regard de la loi 25-11) → partitionnement mensuel + job d'archivage vers S3 glacier.
- `processing_registry` pré-rempli au seed avec les traitements déclarés : photos d'enfants, données de santé, paie, vidéosurveillance éventuelle.

#### C11 — Mise à jour des apps mobiles (schema_version)

- API `GET /api/v1/mobile/config` retournant `min_schema_version` et `min_app_version` par plateforme ; l'app affiche un écran bloquant « Mise à jour requise » si obsolète.
- Le `schema_version` de `sync_operations` est rejeté (`UNSUPPORTED_SCHEMA_VERSION`) si > version supportée, et le changelog (`sync_changelog`) porte une version pour permettre la migration locale Drift (migrations Drift numérotées).

#### C12 — Décisions à acter (ADR) dès la Phase 0

1. `memberships UNIQUE(org, user)` → **1 rôle par utilisateur et par organisation** (MVP) ; multi-rôles = phase ultérieure (table `role_assignments`).
2. Dévise : **DZD uniquement** pour le MVP (colonne `currency` présente, figée à `DZD`).
3. Paiement en ligne (CIB/Edahabia via SATIM) : **feature flag `online_payment` off** jusqu'à validation du MVP.
4. Client API : **TypeScript généré** pour le web (openapi-typescript), **clients Dart écrits à la main** typés (pas de codegen Dart — décision pragmatique).
5. Worker : application **NestJS standalone** (`NestFactory.createApplicationContext`) partageant les modules métier, pas un script brut.
6. Monorepo : **pnpm workspaces + Turborepo** (apps npm) ; les apps Flutter hors workspace pnpm (gérées par le même repo git, CI séparée).

### 1.4 Vérification réglementaire (faits confirmés)

| Texte | Contenu confirmé | Conséquence produit |
|---|---|---|
| **Loi n° 25-11 du 24/07/2025** (modifie et complète la loi 18-07 du 10/06/2018) | Autorité : ANPDP. DPO **obligatoire** ; notification de violation sous **5 jours** ; **DPIA** (AIPD) pour traitements à risque ; sanctions pénales ; pas de droit à l'effacement automatique ; transferts transfrontaliers sous autorisation | Console support : module « Vie privée » avec registre des traitements, DPIA, workflow violation (chrono 5 j), gestion des demandes droits (accès/rectification/opposition) ; consentements spécifiques pour photos d'enfants (traitement sensible) |
| **Décret exécutif n° 19-253 du 16/09/2019** (conditions de création, organisation, fonctionnement et contrôle des établissements d'accueil de la petite enfance) | Crèche : 3 mois → 3 ans ; jardin d'enfants : 3 → 6 ans ; multi-accueil : 3 mois → <6 ans ; **capacité max 150 enfants** ; affichage obligatoire des prestations et tarifs ; programmes pédagogiques par tranche d'âge ; personnel qualifié | `max_children` par défaut 150 ✅ ; module conformité (règle capacité, ratios, documents obligatoires, affichage tarifs) ; âges par défaut des `rooms` cohérents avec le type d'établissement (crèche 3–36 mois, multi-accueil 3–71 mois) — ajouter un champ `establishment_type` sur `organizations` |

> **Terminologie** : remplacer « RGPD » par « loi 18-07 modifiée par la loi 25-11 » dans tout le code, la doc et les écrans (la loi algérienne diffère du RGPD sur l'effacement, le portage et les transferts).

---

## 2. Principes d'implémentation (contrat d'équipe)

1. **Fondation d'abord** : rien de métier avant le gate « 3 règles de démarrage » (JWT tenant → `SET LOCAL` → test d'isolation vert).
2. **Test d'abord pour la sécurité** : le test d'isolation d'une ressource est écrit **avant** le CRUD de cette ressource.
3. **Feature flags** pour tout module non-MVP (`online_payment`, `compliance_module`, `medication_module`, `multi_site`, `whatsapp_notifications`, `staff_planning`, `marketplace`) — déjà en base ✅.
4. **Definition of Ready** (une tâche est prête quand) : schéma écrit ✅, test d'isolation écrit ✅, comportement offline documenté ✅, messages d'erreur FR+AR définis ✅.
5. **Definition of Done** (une fonctionnalité est finie quand) : tests CI verts ✅, RTL AR vérifié visuellement ✅, aucune PII dans les logs ✅, sauvegarde restaurée en staging ✅, testée par un utilisateur réel (éducatrice ou parent) ✅.
6. **Une migration appliquée ne se modifie jamais** ; **une facture payée ne se modifie jamais** ; **un événement de journal ne se supprime jamais** (correction = nouvel événement `is_correction`).
7. **Environnements** : `dev` (docker compose local), `staging` (serveur dédié, **données anonymisées uniquement**), `prod` (VPS durci, backups chiffrés). Jamais de données réelles en staging.
8. **Toute décision structurante fait l'objet d'un ADR** dans `docs/adr/`.

---

## 3. Plan phase par phase

Légende estimation : **PD** = jours-personne nets (à majorer de +25–35 % : réunions, intégration, imprévus). Responsables : **E** = backend/DB, **F** = Flutter, **W** = web.

---

### PHASE 0 — Fondations du monorepo  ⏱ 2 PD  (S1, j1–j2)

**🎯 Objectif** : dépôt exploitable par 3 personnes, outillage standardisé, CI squelette, docs.

**✅ Tâches**
1. Créer la structure exacte du monorepo (Partie 1.3) : `apps/{api,worker,admin-web,parent-mobile,staff-mobile,support-console}`, `packages/{api-contracts,design-system,i18n,shared-config}`, `infrastructure/{docker,database/migrations,nginx,monitoring}`, `docs/{architecture,adr,regulatory,api}`, `tests/{tenant-isolation,sync,financial,e2e}`.
2. Initialiser `apps/api` (NestJS 10 + TS strict), `apps/worker` (NestJS standalone), `apps/admin-web` + `apps/support-console` (Vite + React 18 + TS), `apps/parent-mobile` + `apps/staff-mobile` (`flutter create`, org `dz.creche`), `packages/*`.
3. `pnpm` workspaces + Turborepo ; scripts racine `dev`, `build`, `test`, `lint`, `typecheck`.
4. Tooling : ESLint + Prettier + tsconfig partagés (`packages/shared-config`) ; `husky` pre-commit (lint + typecheck + format).
5. `infrastructure/docker/docker-compose.dev.yml` corrigé : postgres:16-alpine + minio + api + worker + admin-web ; healthchecks ; `docker-entrypoint-initdb.d` **retiré** au profit du runner de migrations (C05).
6. GitHub Actions : workflow `ci.yml` (lint + tests + build, matrix Node 20 / Flutter stable) ; workflow `cd-staging.yml` (déploiement auto sur merge `develop`).
7. Git flow : branches `main` (prod) / `develop` (staging) / `feature/*` ; **Conventional Commits** ; template de PR avec checklist DoD.
8. Écrire les ADR 000–006 (C12) et le template `docs/adr/adr-template.md`.

**🧪 Critères d'acceptation**
- [ ] `pnpm lint && pnpm typecheck && pnpm build` verts sur la racine
- [ ] `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d` démarre PG + MinIO, healthchecks OK
- [ ] CI verte sur le premier commit
- [ ] Un ADR par décision C12 (6 ADR)

---

### PHASE 1 — Base de données v1 (migrations 001–014 corrigées)  ⏱ 5 PD  (S1, j3–j5)

**🎯 Objectif** : schéma complet, gelé, **testé** — y compris RLS systématique, contraintes, runner de migrations et seeds.

**✅ Tâches**
1. Écrire le runner de migrations (C05) + table `schema_migrations`.
2. Réécrire les 14 migrations en intégrant **C01, C04, C06, C07, C08** :
   - `001` extensions + enums ✅ (tels quels) ;
   - `002` + `establishment_type` sur `organizations` ; RLS sur `sites`, `rooms` ;
   - `003` + RLS `memberships`, `devices` ; index complétés ;
   - `004` + FK `consent_records.guardian_id`, RLS consent/privacy/processing ; commentaire loi 25-11 ;
   - `005` + `WITH CHECK`, `room_moves`, `child_status_history` (append-only), `version` sur `child_guardians` ;
   - `006` + `sync_changelog` (C02) ; RLS `sync_operations`, `sync_cursors`, `emergency_contacts` ;
   - `007` + `daily_summaries` : triggers de mise à jour incrémentale (INSERT événement → update agrégats) ;
   - `008` + FK `media_assets.child_id` RESTRICT, RLS `media_access_logs` ;
   - `009` + RLS `notification_preferences`, `messages`, `conversation_participants` ;
   - `010` + contraintes C04 + RLS `contracts`, `invoice_lines`, `payment_allocations`, `daily_cash_registers` ;
   - `011` + RLS `health_records`, `vaccinations`, `medication_authorizations`, `medication_administrations` ;
   - `012` + RLS `staff_*` ;
   - `013` + règles du décret 19-253 (capacité 150, documents obligatoires, ratios à paramétrer) ;
   - `014` + RLS `background_jobs`, `outbox_events`, `feature_flags` (org NULL = global).
3. Seeds (`seeds/`) : rôles système, permissions + `role_permissions` (matrice complète), feature flags, registre des traitements (DPO), règles conformité, organisation de démo.
4. Écrire les **tests SQL de structure** (C01 : 0 table tenant sans RLS ; C04 : contraintes présentes) dans `tests/tenant-isolation/schema.test.ts`.
5. Scripts npm : `db:migrate`, `db:seed`, `db:reset`, `db:check` (drift detection).

**🧪 Critères d'acceptation**
- [ ] 14 migrations s'appliquent proprement sur base vierge (CI)
- [ ] 0 table tenant sans RLS ; chaque politique a `WITH CHECK`
- [ ] `INSERT` d'une ligne d'un autre tenant → refusé (testé) ; `INSERT` sans `SET LOCAL app.tenant_id` → refusé
- [ ] Contraintes financières et temporelles présentes (tests structure)
- [ ] Seeds reproductibles (`db:reset && db:seed` sur base vierge)
- [ ] `db:check` ne détecte aucune dérive entre dev et staging

---

### PHASE 2 — Backend : authentification, tenant, audit (le gate)  ⏱ 6 PD  (S2)

**🎯 Objectif** : les **3 règles de démarrage** fonctionnent, testées, en CI.

**✅ Tâches**
1. Squelette NestJS : `main.ts` (versioning `/api/v1`, validation pipes, CORS, logs JSON + correlation id), `app.module.ts`, filtres d'exceptions (erreurs → `{ code, message_fr, message_ar }`).
2. `TenantContextService` (Partie 3.2) + `TenantInterceptor` + `@Tenant()` décorateur ; **un seul point d'accès DB** (`withTenantConnection`) — interdiction du `pool.query` direct pour les tables tenant.
3. `JwtAuthGuard` (Partie 3.3) + `PlatformGuard` (super_admin sans org, pour la console support) + `RolesGuard`.
4. Module `identity` : `POST /auth/login` (email+password, bcrypt 12), `POST /auth/refresh` (rotation + détection de réutilisation → révocation de la famille), `POST /auth/logout`, `POST /auth/change-password`, TOTP admin (`totp_secret`), verrouillage après 5 échecs (15 min), OTP email/SMS pour parents (`otp_codes`).
5. Sessions (`sessions` avec `refresh_token_hash`), appareils (`devices`, fingerprint, `fcm_token`), révocation distante (endpoint + hook au refresh).
6. `AuditService` + `@Audit()` décorateur + masquage C10 ; `data_access_logs` sur l'accès aux dossiers médicaux, photos, données d'identité.
7. **Tests d'isolation** (Partie 6.1 réécrits en `pg` réel) + tests auth (lockout, refresh reuse, TOTP).
8. Rate limiting applicatif (en plus de nginx) : login 5/min/IP, OTP 3/min.

**🧪 Critères d'acceptation (GATE — rien d'autre ne commence tant que ce n'est pas vert)**
- [ ] Login → JWT access (15 min) + refresh (7 j) ; refresh rotatif ; révocation immédiate d'un appareil
- [ ] Aucune lecture cross-tenant possible (suite 6.1 verte, 404 et non 403)
- [ ] L'audit enregistre : login, logout, modification enfant, accès dossier médical — sans PII
- [ ] Verrouillage de compte après 5 échecs ; TOTP exigé pour les comptes admin
- [ ] Les 3 règles de démarrage de la conclusion sont vertes en CI

---

### PHASE 3 — Organisations, structure, personnel  ⏱ 5 PD  (S3)

**🎯 Objectif** : un tenant complet et configurable : organisation, sites, rooms, invitations, staff.

**✅ Tâches**
1. Module `organizations` : CRUD org (super_admin), `sites`, `rooms`, limites d'abonnement (`max_children`), settings JSONB validés.
2. Invitations : email → lien signé → création user `pending` → `memberships` (rôle par org, C12-ADR-001) → `joined_at`.
3. Module `staff` : `staff_profiles`, `staff_documents` (alertes expiration +30 j via job), `staff_assignments` (affectation salles), `staff_attendance`.
4. `GET /api/v1/me` (profil + orgs + rôles + permissions), `GET /api/v1/feature-flags`.
5. **Web (en parallèle)** : squelette admin-web (design-system, routing, auth flow, layout desktop, i18n AR/FR avec RTL) + écrans org/sites/rooms/staff.
6. Tests : isolation sur `rooms`/`staff` ; cycle d'invitation complet.

**🧪 Critères d'acceptation**
- [ ] Un super_admin crée une org + site + rooms ; un directeur invite une éducatrice qui se connecte avec le bon rôle
- [ ] L'éducatrice ne voit que les rooms auxquelles elle est affectée
- [ ] Alertes expiration documents (job) testées
- [ ] Écrans web org/sites/rooms/staff opérationnels en FR et AR (RTL)

---

### PHASE 4 — Enfants et familles  ⏱ 10 PD  (S4)

**🎯 Objectif** : CRUD complet enfants/responsables + import Excel + base locale du mobile personnel.

**✅ Tâches**
1. Module `children` : CRUD (soft delete, `version`, audit), `guardians`, `child_guardians` (permissions granulaires), `emergency_contacts`, `authorized_pickups`, recherche (pg_trgm).
2. Import CSV/Excel (50 enfants) : upload → parsing → validation (lignes d'erreur détaillées FR/AR) → dry-run → commit transactionnel ; job d'import dans `background_jobs`.
3. Génération du `reference_number` enfant (séquence par org).
4. **Mobile staff** : bootstrap Flutter (Drift, auth + refresh token dans flutter_secure_storage, PIN local), tables `LocalChildren` (+ `siteId`, C09), pull initial des enfants, écran liste par section (Partie 4.5), bannière sync.
5. **Web** : écrans enfants/familles (fiche enfant, responsables, permissions, contacts d'urgence), import Excel.
6. Tests : isolation enfants (Partie 6.1), permissions `child_guardians` (can_pickup, can_view_health…), import avec 10 lignes invalides sur 50.

**🧪 Critères d'acceptation**
- [ ] Isolation enfants testée (A ne voit pas B, 404)
- [ ] Import 50 enfants : 40 OK + 10 erreurs listées, rien en base si dry-run
- [ ] Le mobile affiche la liste des enfants d'une section après sync (test widget)
- [ ] Un parent secondaire sans `can_view_health` ne reçoit pas les données santé (test API)

---

### PHASE 5 — Présences et synchronisation offline  ⏱ 10 PD  (S5)

**🎯 Objectif** : le cœur du produit — pointer une section en < 3 min, même hors ligne, sans perte.

**✅ Tâches**
1. Machine à états `attendance_states` : `expected → present → departed`, `absent` (déclaré), `cancelled` ; corrections avec `correction_of` + traçabilité.
2. Endpoints : `POST /attendance/check-in`, `POST /attendance/check-out`, `POST /attendance/mark-absent` (2 taps parent), `GET /attendance/summary` (par room/jour).
3. **Sync backend** : `POST /sync/push` (Partie 3.4 réécrit avec `sync_changelog`, idempotence par `event_id`, contrôle d'accès par commande : l'opération doit viser un enfant du tenant **et** de la room de l'appareil), `GET /sync/pull` (curseur `sync_seq`, lot 500), conflits (`base_version`).
4. **Sync mobile** : `SyncEngine` (Partie 4.3 corrigé), `operation_queue`, `conflict_resolver` (matrice : check_in/check_out = dernier événement gagne sur états finaux ; événements journal = append-only toujours acceptés ; corrections = exigent `base_version`), bannière `SyncBanner`, reprise avec backoff + reconnexion.
5. Tests : idempotence (10× = 1 résultat) ; opération cross-tenant rejetée (`PERMISSION_DENIED`) ; appareil à l'heure fausse ; **test terrain simulé : 8 h offline** (integration test avec file d'opérations).
6. **Web** : écran présences du jour par room (pointage, corrections tracées).

**🧪 Critères d'acceptation**
- [ ] Une éducatrice pointe toute sa section (12 enfants) en < 3 min
- [ ] 10× la même opération = 1 événement en base
- [ ] 8 h hors ligne → aucun événement perdu (test automatisé + test terrain semaine suivante)
- [ ] Conflit sur état final → rejet explicite `INVALID_STATE_TRANSITION` avec message FR/AR
- [ ] L'opération d'un appareil de l'org A ciblant un enfant de B est rejetée (Partie 6.1 sync)

---

### PHASE 6 — Journal quotidien et médias  ⏱ 10 PD  (S6)

**🎯 Objectif** : repas, sieste, change, activité, température, notes, incidents — avec photos, offline, groupés par section.

**✅ Tâches**
1. Module `journal` : événements (Partie 3, migration 007), corrections append-only, `daily_summaries` incrémentales, visibilité parents (`visible_to_parents`), notification parent sur événement visible.
2. **Mobile staff** : formulaires repas (quantités enum), sieste (début/fin/qualité), change (action rapide), activité, température, note privée, incident (sévérité + action + notification parent) ; **actions groupées** (repas de section en < 30 s).
3. Médias : capture photo → compression (max ~1,5 Mo, EXIF supprimé côté client et serveur), upload **direct vers MinIO via URL signée** (le serveur signe, l'app upload), `media_assets` avec `children_in_photo` + `all_consents_checked` ; **règle serveur** : `is_visible_to_parents=true` interdit si consentement photo manquant ou `all_consents_checked=false` ; file d'upload avec reprise.
4. Notifications parents : check-in/out push (job `send_parent_notification`), événements visibles (meals, nap, incident) — via `notification_queue` + FCM.
5. Tests : 200 événements offline puis sync ; photos en attente 6 h ; consentement révoqué → photo retirée du fil parent ; agrégats `daily_summaries` exacts après 50 événements.

**🧪 Critères d'acceptation**
- [ ] Repas groupé 12 enfants < 30 s
- [ ] 200 événements offline synchronisés sans perte ni doublon
- [ ] Photo sans consentement : jamais visible côté parent (test serveur)
- [ ] Incident grave → notification parent < 30 s (quand en ligne)
- [ ] Le parent reçoit l'arrivée de l'enfant en push < 30 s (quand en ligne)

---

### PHASE 7 — Application parents et notifications  ⏱ 10 PD  (S7) — API ✅, mobile ⏳

**🎯 Objectif** : l'app parent (iOS + Android) — fil du jour, photos, consentements, absence en 2 taps, messagerie.

**✅ Tâches**
1. **parent-mobile** : auth par OTP téléphone (SMS ou whatsapp selon flags) + code PIN ; multi-enfants (si plusieurs) ; fil du jour chronologique (journal + photos + présences) ; consultation photos (URLs signées 1 h) ; gestion des consentements (revocation → effet immédiat côté serveur) ; signalement d'absence en 2 taps ; RTL arabe complet.
   - **API : ✅ FAIT et testé** (portail `/parent/*` + OTP/PIN — voir PLAN_EXECUTION §6).
   - **Flutter parent-mobile : ⏳ squelette Dart, non compilé** (SDK absent de la sandbox).
2. **Isolation parent** : l'API parent ne renvoie que les enfants dont le parent est `child_guardians` avec `can_view_journal` — **✅ testé** (phase7, cas 1-6).
3. Notifications : préférences par canal/événement + quiet hours ; FCM (Android) + APNs (iOS) ; inbox dans l'app (`notification_inbox`). — **✅ API/worker testés** (phase7 cas 7-8 ; FCM/APNs codés, non testés de bout en bout faute de secrets ; SMS déclaré non configuré).
4. Messagerie : conversations par enfant, participants, messages (texte + pièce jointe média), système de messages, RLS. — **⏳ non implémenté** (schéma 009 prêt).
5. Jobs : envoi push via `notification_queue` (worker, tentatives + backoff), nettoyage `otp_codes`/`sessions`/queue. — **✅ worker** (drain + retries) ; nettoyage/rotation des codes : partiel (invalidation à chaque nouvelle demande).
6. Tests : isolation parent ; notification push bout-en-bout (émulateur) ; quiet hours respectées ; RTL visuel (golden tests). — **✅ isolation/quiet hours** ; push émulateur + golden RTL ⏳ (SDK).

**🧪 Critères d'acceptation**
- [x] Le parent ne voit que ses enfants (testé, y compris le partage entre deux parents d'un même enfant avec permissions différentes) — **11 cas phase7 verts**
- [x] Absence signalée en 2 taps → statut + notification éducatrice
- [x] Révocation d'un consentement photo → effet immédiat côté serveur (testé : URLs coupées au 1er appel suivant)
- [ ] L'app fonctionne sur Android 2 Go RAM (test device farm, profil de release) — ⏳ SDK absent
- [ ] FR/AR corrects sur tous les écrans (golden tests RTL) — ⏳ SDK absent

---

### PHASE 8 — Facturation (MVP final)  ⏱ 8 PD  (S8) — API + worker ✅, web/mobile ⏳

**🎯 Objectif** : contrats, factures mensuelles, paiements espèces, PDF, exports — intègre et immuable.

**✅ Tâches**
1. Module `billing` : `contracts` (formules : full_time, half_time, daily, custom ; repas, transport, remises, frais d'inscription), génération mensuelle des factures (job `send_monthly_invoices` : lignes par type `care/meal/transport/activity/registration/adjustment/discount`, numérotation par org/année/mois, `due_date`). — **✅ API + job worker** (idempotence : index 021 + ON CONFLICT DO NOTHING).
2. `invoices` : CRUD limité (draft → sent), immuabilité C04 (422 `INVOICE_IMMUTABLE`), statuts (`draft, sent, partially_paid, paid, overdue, cancelled`), job de passage `overdue`. — **✅ API/DB** (immuabilité testée API + SQL) ; job `overdue` ⏳.
3. `payments` : espèces (caisse : `daily_cash_registers` ouverture/clôture, `total_cash_in/out`), allocation aux factures (FOR UPDATE, C04), reçus (`receipt_number`), historique. — **✅ API + trigger 023** (bornes testées en SQL direct).
4. PDF : worker — **✅ générateur PDF réel intégré** (zéro dépendance lourde ; corps FR Helvetica/WinAnsi — la composition arabe exige une police GSUB, ⏳) ; stockage backend explicite (`STORAGE_BACKEND=local` ou `s3`) ; `pdf_url` renseigné par le worker ; < 5 s ⏳ non mesuré.
5. Exports : Excel présences et facturation (worker + URL signée). — ⏳ stub `NOT_IMPLEMENTED`.
6. **Web** : écrans contrats, factures, paiements, caisse ; **mobile parent** : consultation factures + reçus (lecture seule au MVP, `can_receive_invoices`/`can_pay_invoices`). — **✅ API parent** (`/parent/invoices`, `/parent/receipts`, PDF) ; écrans web ⏳ (Phase 9) ; mobile ⏳ (SDK).
7. Tests financiers (Partie 6.2, réels) : immuabilité, webhook ×2 = 1 paiement (même pour les virements), total = somme des lignes, partiel → `partially_paid`, complet → `paid`, caisse cohérente. — **✅ 16/16 cas phase8 sur PostgreSQL réel NOBYPASSRLS.**

**🧪 Critères d'acceptation**
- [x] Facture payée non modifiable (422 + trigger C04 en SQL direct)
- [x] Même webhook/reçu envoyé 3× = 1 paiement confirmé
- [x] Total facture = somme des lignes (contrôle en base, chk_line_total) ; solde et bornes d'allocation testés API + SQL
- [ ] PDF généré < 5 s ; rapprochement compréhensible par une personne non technique (⏳ non mesuré)
- [ ] La directrice génère les factures du mois en 5 min (sans compter la génération PDF) — ⏳ écrans web (Phase 9)
- [ ] **MVP complet** : les 9 critères MVP de la Partie 9 sont verts — ⏳ (mobile/web/device farm restants)

---

### PHASE 9 — Administration web complète  ⏱ 8 PD  (S9) — API + écrans ✅, e2e ⏳

**🎯 Objectif** : l'outil de gestion quotidien de la directrice, en FR et AR.

**✅ Tâches**
1. Tableau de bord : présences du jour par site/room, alertes (enfants non pointés à 9 h, documents expirés, factures impayées, incidents). — **✅ `GET /dashboard/summary` + `DashboardPage`** (test d'isolation phase9).
2. Écrans : enfants (fiche complète, historique `room_moves`, statuts — **✅** `GET /children/:id` enrichi + fiche web), familles (⚠️ CRUD gardiens déjà en API, pas d'écran dédié), présences (vue jour, corrections tracées — **✅**), journal (consultation + modération — **✅** `PATCH /journal/events/:id/visibility`), photos (validation visibilité parents — **✅**), messagerie (**⏳ non implémenté**), contrats/factures/paiements (P8 — **✅** `BillingPage`), personnel (P3 — ✅ existant), paramètres org (tarifs affichés — **✅** `OrgSettingsPage`, exigence 19-253).
3. i18n : AR/FR complets — **✅ ~150 nouvelles clés** ; RTL document-wide — ✅ ; dates/montants localisés (DZD) — ✅ partiel ; export PDF — ✅ (lien PDF facture) ; export Excel — ⏳ (worker stub).
4. Performance : bundle principal **63,7 kB gzip** (pages lazy, < 250 Ko ✅) ; pagination API existante, virtualisation ⏳.
5. Tests : Playwright e2e (login → pointer une section → générer une facture) — **⏳ spec + config écrits, non exécutés** (navigateur indisponible) ; a11y de base ⏳ ; RTL visuel ⏳ (SDK/golden).

**🧪 Critères d'acceptation**
- [x] Tous les flux métier du quotidien réalisables via l'API (smoke testé : login → dashboard → attendance → contracts via proxy Vite)
- [ ] Playwright e2e verts sur le parcours directeur (écrit, à exécuter en CI)
- [ ] AR RTL vérifié visuellement sur les 5 écrans principaux (⏳ golden/SDK)
- [x] Correction de présence = tracée (motif obligatoire, append-only Phase 5)

---

### PHASE 10 — Santé, conformité 19-253, console support, vie privée  ⏱ 10 PD  (S10) — API + console ✅, écrans web ⏳

**🎯 Objectif** : modules à feature flag + outils internes (support) + conformité 25-11 opérationnelle.

**✅ Tâches**
1. **Santé** — **✅ API + tests (11 cas)** : dossier médical (upsert), allergies (sévérité, protocole d'urgence), vaccinations (prochaine dose, vérification), `medication_authorizations` (consentement gardien requis, vérification directrice) + `medication_administrations` (double saisie : qui donne / qui confirme — 422 même personne, 409 double confirmation) ; accès journalisé (`data_access_logs`) ; accès parent verrouillé par `can_view_health`. Écran mobile/fiche : ⏳.
2. **Conformité 19-253** — **✅ API + tests (7 cas)** : `GET /compliance/summary` (CAP_150, RATIO_EDUC, AGE_CRECHE, DOC_STAFF, PRICE_DISPLAY) persisté dans `compliance_checks`, liste + accusé de réception directrice ; **capacité enforceée** : 151e enfant → 409 `CAPACITY_EXCEEDED` (création + import). Tableau de bord web conformité : ⏳.
3. **Console support** — **✅ API + UI React** : recherche globale (org, enfant, user — `support_global_search` SECURITY DEFINER), impersonation **avec audit `impersonate`** (motif obligatoire), monitoring jobs + retry (`support_list_jobs`/`support_retry_job`), UI onglets Recherche/Jobs/Impersonation (48 kB gzip). Gestion feature flags : ⏳.
4. **Vie privée (DPO)** — **✅ API + tests (11 cas)** : registre des traitements (seed 015 + lignes modèle visibles, migrations 030/031), DPIA (création + approbation pour photos enfants, santé, paie), workflow violation (chrono 5 jours ANPDP, notification email SMTP réelle via nodemailer ou 503 explicite sans config), demandes droits (accès → export JSON complet de l'enfant persisté ; rectification ; opposition ; résolution). Rétention/purge (job 5 ans) : ⏳.
5. Tests — **✅ 29 cas phase10 verts** : cycle complet demande de droits (export testé) ; impersonation tracée ; 151e enfant refusé ; violation créée avec suivi 5 j.

**🧪 Critères d'acceptation**
- [x] Un parent demande l'export des données de son enfant → JSON complet (enfant, santé, journal, présence, factures, consentements) testé
- [x] Toute impersonation apparaît dans l'audit avec raison (testé)
- [x] 151e enfant refusé quand `max_children=150` (409 FR/AR, création + import)
- [x] Violation testée : événement créé → échéance +5 j visible (notification email ⏳ SMTP non testé de bout en bout)

---

### PHASE 11 — Durcissement, observabilité, performance  ⏱ 8 PD  (S11) — API ✅, infra ⏳

**🎯 Objectif** : prêt pour la production et pour les pilotes.

**✅ Tâches**
1. Observabilité — **✅ partiel** : `/metrics` Prometheus (compteurs HTTP, histogramme, jobs/notifications/factures en file, uptime — aucun PII), healthcheck public ; logs JSON/correlation id ✅ (nginx existant) ; Grafana/alertes ⏳ (infra).
2. Sentry — ⏳ non configuré (DSN requis).
3. Performance — **✅ index Phase 11** (migration 033 : guardians(user_id), fil du jour, inbox, contrats, caisse, allocations, incidents) ; **load test k6** ⏳ script écrit (`tests/load/sync.k6.js`), non exécuté (k6 absent).
4. Sécurité — **✅ partiel** : `npm audit` durci (@nestjs/config 4, nodemailer 9, overrides) + résidus documentés `SECURITY.md` (migration NestJS 11 planifiée) ; workflows CodeQL/Semgrep ⏳ (permission workflows) ; test de révocation d'appareil ✅ (S2) ; URLs signées ✅ (revue).
5. Backups — **✅ script** `scripts/backup.sh` (pg_dump + gzip + GPG AES256, rétention 7 j) ; cron + **exercice de restauration staging < 30 min** ⏳ (infra).
6. Runbook ops — **✅** `docs/RUNBOOK.md` (déploiement, rollback, restauration, incidents, expand/contract).
7. Staging — **✅ script** `scripts/anonymize.sql` (pseudonymisation + garde-fou) ; vérification automatique d'absence de données réelles ⏳ (CI).

**🧪 Critères d'acceptation**
- [x] /metrics Prometheus public sans PII (testé phase11) ; rétention 5 ans testée ; healthcheck public
- [ ] k6 : p95 sync push < 2 s pour 500 ops (script écrit, non exécuté)
- [ ] Restauration complète en staging < 30 min (procédure documentée, exercice à programmer)
- [ ] 0 vulnérabilité critique au scan (résidus moderate/high documentés — NestJS 11 planifié)
- [ ] Staging prouvé sans données réelles (script d'anonymisation prêt, contrôle CI ⏳)

---

### PHASE 12 — Pilotes et mise en production  ⏱ 10 PD  (S12–S16)

**🎯 Objectif** : 5 crèches pilotes utilisent le produit chaque jour pendant 2 semaines → go-live.

**✅ Tâches**
1. Préparation pilotes : onboarding (fiches, formations directrice/éducatrice, QR de partage d'app), données de démarrage par crèche, comptes de test, canal de feedback dédié.
2. Semaine pilote 1 : suivi quotidien (métriques d'usage : pointages/jour, sync réussies, erreurs), hotfixes en continu, journal des irritants.
3. Semaine pilote 2 : correction des irritants, mesure des critères MVP (3 min/pointage, 30 s/repas groupé, notifications < 30 s), collecte des retours AR/FR.
4. Bilan pilotes : décision go/no-go ; liste des améliorations différées → backlog v2.
5. Mise en production : builds stores (Play Console + App Store), DNS/TLS, sauvegardes activées, monitoring, plan de support (SLA cible, canaux), formation des équipes crèche.
6. Rétrospective + **roadmap v2** : paiement en ligne CIB/Edahabia, multi-sites, WhatsApp, marketplace, module planning personnel, multi-rôles.

**🧪 Critères d'acceptation**
- [ ] 5 crèches × 2 semaines d'utilisation quotidienne (métriques vérifiées)
- [ ] 100 % des critères MVP de la Partie 9 cochés
- [ ] 0 incident bloquant non résolu en 24 h pendant les pilotes
- [ ] Go-live validé ; rollback testé ; runbook remis à jour

---

## 4. Calendrier consolidé (équipe de 3 — E backend, F Flutter, W web)

| Semaine | Backend (E) | Flutter (F) | Web (W) | Jalon |
|---|---|---|---|---|
| S1 | P0 + P1 (schéma complet + RLS) | P0 (setup repo) | P0 + revue schéma | Schéma v1 gelé et testé |
| S2 | P2 (auth, tenant, audit) | — (dépend du gate) | P2 admin : skeleton + design-system + i18n | **GATE sécurité vert** |
| S3 | P3 (orgs, sites, rooms, staff) | P3 : bootstrap staff-mobile (Drift, PIN) | P3 : écrans orgs/rooms/staff | 1er tenant complet |
| S4 | P4 (enfants, familles, import) | P4 : pull enfants + liste sections | P4 : écrans enfants/familles | Import 50 enfants OK |
| S5 | P5 (présences + sync) | P5 : SyncEngine complet | P5 : écran présences jour | Test terrain 8 h offline |
| S6 | P6 (journal + médias + jobs) | P6 : formulaires + photos | P6 : modération journal | Repas groupé < 30 s |
| S7 | P7 (notifications + messagerie) | P7 : parent-mobile complet | P7 : dashboard | Push arrivée < 30 s |
| S8 | P8 (facturation + PDF) | P8 : factures côté parent | P8 : écrans facturation | **MVP** |
| S9 | P10a (santé, conformité) | polish AR/RTL + perf 2 Go | P9 : admin web complet | Admin complet |
| S10 | P10b (support console, vie privée) | tests device farm | P10 : écrans console support | Conformité 25-11 opérationnelle |
| S11 | P11 (observabilité, load tests) | Sentry + crash-free | P11 : perf web | k6 vert |
| S12 | P11 (sécurité, backups, runbook) | build release stores | P11 : a11y/RTL QA | Restauration < 30 min |
| S13 | P12 : préparation pilotes | builds pilotes | P12 : exports + formation | 5 crèches onboardées |
| S14 | P12 : pilotes S1 + hotfixes | hotfixes | hotfixes | Jour 1 pilotes |
| S15 | P12 : pilotes S2 + bilan | correctifs UX | correctifs UX | Bilan go/no-go |
| S16 | **Go-live** + support + roadmap v2 | release stores | formation finale | **Production** |

> **Une personne seule** : même séquence, chaque semaine devient ~2 semaines → MVP ≈ semaine 16, go-live ≈ semaine 32.

---

## 5. Registre des risques

| # | Risque | Prob. | Impact | Mitigation | Phase |
|---|---|---|---|---|---|
| R1 | RLS mal posée → fuite de données entre crèches | M | **Critique** | C01 + tests SQL de structure + suite 6.1 en CI | 1–2 |
| R2 | Perte d'événements offline (crash, curseur, doublons) | M | Critique | C02 (changelog), idempotence, tests 200 ops + 8 h offline | 5–6 |
| R3 | Connexion instable des crèches (ADSL/3G) | É | Élevé | Offline-first, photos compressées, sync par lots + reprise | 5–6 |
| R4 | Photos d'enfants : incident de confidentialité | F | Critique | Consentements, URLs signées courtes, EXIF, audit `data_access_logs`, DPIA, masquage logs | 6, 10 |
| R5 | Fraude/erreur financière (paiements, caisse) | M | Élevé | C04 (immutabilité, contraintes), tests 6.2, caisse quotidienne, rapprochement | 8 |
| R6 | Dérive des schémas dev/staging/prod | M | Élevé | C05 (runner + checksums + drift check CI) | 1 |
| R7 | Périmètre : console support et conformité oubliées | É | Moyen | Incluses dans P10 (ce plan) | 10 |
| R8 | App mobile lente sur Android 2 Go RAM | M | Moyen | Profil release, taille APK, listes virtuelles, tests device farm | 7, 9 |
| R9 | Départ d'un membre de l'équipe | F | Moyen | Monorepo documenté, ADR, PRs revues, runbook | 0 |
| R10 | Changement réglementaire (décrets d'application 25-11/19-253) | M | Moyen | Règles de conformité en base (modifiables sans déploiement), veille | 10 |
| R11 | Adoption faible des pilotes | M | Élevé | Onboarding, formation, feedback quotidien, 2 semaines de mesure | 12 |
| R12 | Coût d'infrastructure (S3, SMS, push) | M | Moyen | MinIO self-hosted, SMS flaggé, budgets par crèche | 7, 12 |

---

## 6. Checklist de validation consolidée (Partie 9 complétée)

### Gate Phase 2 (bloquant)
- [ ] Aucune lecture cross-tenant possible (testé automatiquement)
- [ ] Une opération répétée 10 fois = 1 résultat en base
- [ ] La sauvegarde peut être restaurée en moins de 30 minutes (dès S12)
- [ ] Le squelette de synchronisation fonctionne sur 1 cas simple
- [ ] L'audit enregistre : login, logout, modification enfant, accès dossier médical
- [ ] Le CI passe au vert (lint + tests + build)
- [ ] L'arabe RTL s'affiche correctement
- [ ] La révocation d'un appareil coupe immédiatement l'accès

### MVP (fin S8)
- [ ] Une éducatrice pointe toute sa section en moins de 3 minutes
- [ ] Un repas groupé pour 12 enfants en moins de 30 secondes
- [ ] Aucun événement perdu après 8 heures hors ligne
- [ ] Le parent reçoit la notification d'arrivée dans les 30 secondes (quand en ligne)
- [ ] Le parent voit uniquement ses propres enfants (testé)
- [ ] L'application fonctionne sur Android 2 Go RAM
- [ ] La directrice génère les factures du mois en 5 minutes
- [ ] L'import de 50 enfants depuis Excel fonctionne
- [ ] Les données de staging ne contiennent aucune donnée réelle
- [ ] 5 crèches pilotes utilisent le produit chaque jour pendant 2 semaines (fin S15)

### Facturation (fin S8)
- [ ] Aucun paiement dupliqué dans tous les scénarios testés
- [ ] Webhook reçu 3 fois = 1 paiement confirmé
- [ ] Facture payée non modifiable (erreur 422 claire)
- [ ] Total facture = somme des lignes (testé automatiquement)
- [ ] Rapprochement vérifiable par une personne non technique
- [ ] PDF facture généré en moins de 5 secondes
- [ ] 3 crèches utilisent la facturation et paient leur abonnement (S16)

### Conformité (fin S10) — ajouts de ce plan
- [ ] Registre des traitements (DPO) complet et accessible
- [ ] DPIA réalisé pour les photos d'enfants et les données de santé
- [ ] Workflow de violation de données testé (chrono 5 jours ANPDP)
- [ ] Export des données d'un enfant (droit d'accès) testé
- [ ] 151e enfant refusé si capacité = 150 (décret 19-253)
- [ ] Tarifs affichables et exportables (exigence 19-253)

---

## 7. Règles de fonctionnement

1. **Git** : `main` (prod) ← `develop` (staging) ← `feature/*` ; Conventional Commits ; PR ≤ 400 lignes, revue par un pair, checklist DoD dans le template.
2. **Tests** : `tests/` contient tenant-isolation, sync, financial, e2e (+ security, regulatory) ; la suite complète s'exécute dans CI en < 15 min ; tout bug corrigé = test de régression ajouté.
3. **Sécurité** : aucune PII dans les logs ; secrets uniquement via variables d'environnement/vault ; `npm audit` vert avant merge.
4. **Contrats** : la spec OpenAPI 3.1 (`packages/api-contracts/openapi.yaml`) est générée à chaque build et versionnée ; le client TS du web est régénéré ; toute modification d'endpoint exige la mise à jour de la spec et des messages d'erreur FR/AR.
5. **Réunions** : daily 15 min ; démo interne chaque vendredi ; rétrospective à chaque fin de phase ; revue de code le jeudi (calqué sur le plan d'origine).
6. **Documentation** : ADR pour toute décision structurante ; le présent plan est le document de pilotage — mise à jour après chaque phase avec le taux de complétion des checklists.

---

## 8. Démarrage immédiat (jour 1, ordre d'exécution)

| Heure | Action |
|---|---|
| 09:00 | Créer le dépôt GitHub `creche-saas`, branches `main`/`develop`, protéger `main` |
| 09:30 | Copier la structure du monorepo (P0 t.1) et les ADR 000–006 |
| 10:30 | `docker compose -f infrastructure/docker/docker-compose.dev.yml up -d` — vérifier PG + MinIO |
| 11:00 | Écrire le runner de migrations (C05) — ~100 lignes |
| 11:30 | Réécrire la migration 001 et la migration 002 corrigées (C01, C06) |
| 14:00 | Appliquer les migrations sur la base locale ; vérifier les 2 requêtes de test RLS (C01) |
| 15:00 | Commiter (conventional commits) ; CI verte |
| 16:00 | Rédiger la liste des 12 corrections (C01–C12) comme issues GitHub avec liens vers ce plan |
| 17:00 | Démo interne : schéma + RLS + plan validés |

**Cette semaine** : terminer P0 et P1 (migrations 001→014 corrigées, seeds, tests de structure). **Ne commencer P2 qu'avec P1 verte.**

---

## 9. ADR à acter en Phase 0 (liste)

| ADR | Décision | Statut proposé |
|---|---|---|
| ADR-000 | Monorepo pnpm + Turborepo ; Flutter hors workspace | À acter |
| ADR-001 | 1 rôle par utilisateur/org (`memberships` UNIQUE) | À acter |
| ADR-002 | DZD seul pour le MVP | À acter |
| ADR-003 | `online_payment` off jusqu'à post-pilotes | À acter |
| ADR-004 | Client TS généré (web) ; Dart écrit à la main | À acter |
| ADR-005 | Worker = app NestJS standalone (pas script brut) | À acter |
| ADR-006 | Tests en `pg` brut, jamais d'ORM | À acter |
| ADR-007 | Une migration appliquée ne se modifie jamais | À acter |
| ADR-008 | Curseur sync = `sync_changelog` (BIGSERIAL), pas l'horloge | À acter |
| ADR-009 | Loi applicable : 18-07 modifiée par 25-11 (pas « RGPD ») | À acter |
| ADR-010 | Rétention audit 5 ans + masquage PII systématique | À acter |

---

## 10. Périmètre hors MVP (backlog v2, après go-live)

Paiement en ligne CIB/Edahabia (SATIM) · WhatsApp Business API · Multi-établissements avancé · Marketplace public · Planning du personnel (roulements) · Multi-rôles par utilisateur · Application web mobile-responsive complète · Module paie · Vidéosurveillance (sous DPIA) · Mode inspection (export conformité officiel) · Redis pour cache/jobs si le volume le justifie.

---

*Fin du document — prochaine révision : à la clôture de la Phase 1 (semaine 1).*
