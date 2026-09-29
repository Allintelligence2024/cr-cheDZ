-- ============================================================================
-- 077_tenant_org_indexes.sql
-- Index de tête `organization_id` sur les tables tenant — remédiation 2026-09-27
-- (plan : docs/PLAN_REMEDIATION_2026-09-27.md, lot 1 / défaut D1)
-- ============================================================================
--
-- CONSTAT MESURÉ (PostgreSQL 18.4 réel)
-- -------------------------------------
-- Chaque politique RLS du schéma s'écrit :
--     USING      (organization_id = app_tenant_id())
--     WITH CHECK (organization_id = app_tenant_id())
-- Ce prédicat est donc ajouté à ABSOLUMENT TOUTE requête sur une table tenant,
-- y compris quand le développeur ne l'écrit pas. Or 32 des 68 tables portant
-- `organization_id` n'avaient aucun index dont cette colonne est la tête :
-- PostgreSQL devait balayer la table entière — toutes organisations confondues
-- — pour rendre les lignes d'UN SEUL tenant.
--
-- Conséquence, mesurée par tests/perf/bench-tenant-index.mjs :
--     40 organisations   : Seq Scan 0,304 ms  →  Index Scan 0,052 ms   (5,8×)
--    100 organisations   : Seq Scan 1,028 ms  →  Index Scan 0,064 ms  (16,1×)
-- Le seq-scan croît LINÉAIREMENT avec le volume total (0,304 → 1,028 ms quand
-- on triple), l'index reste constant (~0,06 ms). Autrement dit : sans cet
-- index, servir une crèche coûte de plus en plus cher à mesure que la
-- plateforme gagne des clients. C'est un défaut dont le coût croît.
--
-- PÉRIMÈTRE — 28 index
-- --------------------
-- Tables tenant (RLS activée) sans index de tête sur organization_id.
--
-- EXEMPTIONS, explicites et justifiées (toute autre table est une erreur) :
--   * users, sessions        → tables SYSTÈME, sans RLS par conception (accès
--                              cross-tenant contrôlé par les gardes
--                              applicatifs, cf. schema-check.mjs). Déjà
--                              indexées sur email, phone, user_id,
--                              refresh_token_hash.
--   * feature_flags          → table de CONFIGURATION (quelques dizaines de
--                              lignes au maximum, cf. FeatureFlagGuard) ;
--                              possède déjà UNIQUE(flag_key, organization_id),
--                              utilisé par la recherche habituelle.
--   * processing_registry    → table de CONFIGURATION (modèles globaux +
--                              entrées par organisation, quelques dizaines de
--                              lignes) ; un balayage y est optimal.
-- Le gardien scripts/check-tenant-index.mjs porte la même liste : une
-- exemption qui disparaîtrait du schéma, ou une nouvelle table tenant non
-- indexée, fait échouer la CI.
--
-- CHOIX D'INDEX SIMPLES (pas de composites)
-- -----------------------------------------
-- Un composite (organization_id, child_id) servirait les requêtes filtrant les
-- deux colonnes, mais il FERAIT PERDRE l'usage de l'index aux requêtes qui ne
-- filtrent QUE child_id — notamment celles émises depuis une fonction SECURITY
-- DEFINER, qui court-circuite la RLS. Les index existants
-- (idx_allergies_child, idx_invoice_lines_invoice, …) sont donc CONSERVÉS :
-- PostgreSQL sait combiner deux index par BitmapAnd. Choix conservateur,
-- réversible, sans changement de plan pour les requêtes actuelles.
--
-- EXPLOITATION — verrous et voie CONCURRENTLY
-- -------------------------------------------
-- CREATE INDEX pose un verrou SHARE : il bloque les ÉCRITURES sur la table
-- pendant la construction. La parade usuelle, CREATE INDEX CONCURRENTLY, ne
-- peut pas s'exécuter dans une transaction — or le runner de migrations
-- enveloppe chaque fichier dans BEGIN … COMMIT (scripts/migrate.mjs:96).
--
-- Les deux sont conciliables grâce à `IF NOT EXISTS` : un exploitant qui
-- déploie sur de grosses tables peut PRÉ-CRÉER les index hors bande, sans
-- verrou long :
--
--     CREATE INDEX CONCURRENTLY idx_messages_org ON messages(organization_id);
--     -- puis laisser tourner la migration : elle détecte l'index et ne refait
--     -- rien (idempotente, aucun verrou long).
--
-- À ce stade du projet (avant pilotes, tables de faible volume) la voie
-- transactionnelle est sûre ; la voie CONCURRENTLY reste ouverte sans
-- modification de code ni de migration.
--
-- Migrations 001–076 immuables (ADR-007) : index ajoutés ici, jamais modifiés
-- en place.
-- ============================================================================

-- ── Présences & journal ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_attendance_events_org       ON attendance_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_org         ON daily_summaries(organization_id);

-- ── Dossier enfant et entourage ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_allergies_org               ON allergies(organization_id);
CREATE INDEX IF NOT EXISTS idx_authorized_pickups_org      ON authorized_pickups(organization_id);
CREATE INDEX IF NOT EXISTS idx_emergency_contacts_org      ON emergency_contacts(organization_id);
CREATE INDEX IF NOT EXISTS idx_child_status_history_org    ON child_status_history(organization_id);
CREATE INDEX IF NOT EXISTS idx_room_moves_org              ON room_moves(organization_id);
CREATE INDEX IF NOT EXISTS idx_vaccinations_org            ON vaccinations(organization_id);

-- ── Santé ──────────────────────────────────────────────────────────────────
-- (données sensibles loi 25-11 : ce sont aussi les lectures les plus filtrées
--  par tenant, donc celles qui souffraient le plus du balayage)
CREATE INDEX IF NOT EXISTS idx_health_records_org          ON health_records(organization_id);
CREATE INDEX IF NOT EXISTS idx_medication_authorizations_org ON medication_authorizations(organization_id);
CREATE INDEX IF NOT EXISTS idx_medication_administrations_org ON medication_administrations(organization_id);

-- ── Facturation & paie (immuabilité financière : lectures fréquentes) ──────
CREATE INDEX IF NOT EXISTS idx_invoice_lines_org           ON invoice_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_allocations_org     ON payment_allocations(organization_id);
CREATE INDEX IF NOT EXISTS idx_daily_cash_registers_org    ON daily_cash_registers(organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_org         ON payroll_entries(organization_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_org           ON payroll_lines(organization_id);

-- ── Médias ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_media_access_logs_org       ON media_access_logs(organization_id);

-- ── Messagerie ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_messages_org                ON messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_conversation_participants_org ON conversation_participants(organization_id);

-- ── Notifications ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notification_queue_org      ON notification_queue(organization_id);
CREATE INDEX IF NOT EXISTS idx_notification_inbox_org      ON notification_inbox(organization_id);

-- ── Jobs, outbox et synchronisation ────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_background_jobs_org         ON background_jobs(organization_id);
CREATE INDEX IF NOT EXISTS idx_outbox_events_org           ON outbox_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_sync_cursors_org            ON sync_cursors(organization_id);

-- ── Personnel ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_staff_assignments_org       ON staff_assignments(organization_id);
CREATE INDEX IF NOT EXISTS idx_staff_attendance_org        ON staff_attendance(organization_id);
CREATE INDEX IF NOT EXISTS idx_staff_documents_org         ON staff_documents(organization_id);

-- ── Vie privée ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_privacy_request_exports_org ON privacy_request_exports(organization_id);

-- ── Contrôle d'intégrité de la migration ───────────────────────────────────
-- La migration échoue si une table tenant est passée entre les mailles, plutôt
-- que de laisser un défaut silencieux. Les exemptions sont les seules admises
-- (cf. en-tête) ; toute autre table est un oubli.
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relrowsecurity          -- table tenant : la RLS est active
    AND EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
    )
    AND c.relname NOT IN ('feature_flags', 'processing_registry')  -- exemptions config
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
      WHERE i.indrelid = c.oid
        AND i.indisvalid
        AND i.indkey[0] = (
          SELECT a.attnum FROM pg_attribute a
          WHERE a.attrelid = c.oid AND a.attname = 'organization_id'
        )
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'TENANT_INDEX_INCOMPLETE: index de tête organization_id manquant sur : %', v_missing
      USING ERRCODE = 'P0001';
  END IF;
END $$;
