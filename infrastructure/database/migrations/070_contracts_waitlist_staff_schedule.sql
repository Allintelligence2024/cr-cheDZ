-- ============================================================================
-- 070 — P2-2 contrats d'accueil (semaine type, annualisation),
--       P2-4 pré-inscriptions & liste d'attente,
--       P2-5 planning du personnel.
-- ----------------------------------------------------------------------------
-- Principes communs : RLS forcée (C01 USING + WITH CHECK), aucune donnée
-- financière modifiée rétroactivement (les factures restent C04), toute règle
-- métier vérifiable en base (CHECK), pas de valeur libre silencieuse.
-- ============================================================================
BEGIN;

-- ── P2-2 : semaine type et annualisation du contrat ─────────────────────────
-- weekly_schedule : jours contractuels 1=lundi … 7=dimanche (DZ : dim→jeu par
-- défaut = {7,1,2,3,4}), hours_per_day pour les contrats horaires.
-- Annualisation : annual_weeks (ex. 48) → le montant mensuel lissé =
-- daily_rate × jours contractuels/semaine × annual_weeks / 12. Si
-- monthly_base_amount est donné explicitement, il reste la référence
-- (compatibilité 010) ; sinon il est calculé à la création.
ALTER TABLE contracts
  ADD COLUMN IF NOT EXISTS weekly_schedule SMALLINT[] NOT NULL DEFAULT '{7,1,2,3,4}',
  ADD COLUMN IF NOT EXISTS hours_per_day NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS annual_weeks SMALLINT,
  ADD COLUMN IF NOT EXISTS daily_rate NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS absence_deduction BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extra_day_rate NUMERIC(10,2);
ALTER TABLE contracts
  ADD CONSTRAINT chk_contract_weekly_schedule CHECK (
    cardinality(weekly_schedule) BETWEEN 1 AND 7
    AND weekly_schedule <@ ARRAY[1,2,3,4,5,6,7]::smallint[]
  ),
  ADD CONSTRAINT chk_contract_annualisation CHECK (
    (annual_weeks IS NULL OR annual_weeks BETWEEN 1 AND 52)
    AND (hours_per_day IS NULL OR hours_per_day BETWEEN 0.5 AND 12)
    AND (daily_rate IS NULL OR daily_rate >= 0)
    AND (extra_day_rate IS NULL OR extra_day_rate >= 0)
  );
COMMENT ON COLUMN contracts.weekly_schedule IS 'P2-2 : jours contractuels ISO (1=lundi … 7=dimanche).';
COMMENT ON COLUMN contracts.annual_weeks IS 'P2-2 : semaines d''accueil par an (lissage mensuel = daily_rate × jours/semaine × annual_weeks / 12).';
COMMENT ON COLUMN contracts.absence_deduction IS 'P2-2 : si vrai, les jours contractuels marqués absents (justifiés) sont déduits à la facturation, et les jours présents hors contrat facturés à extra_day_rate.';

-- ── P2-4 : pré-inscriptions & liste d'attente ───────────────────────────────
CREATE TABLE enrollment_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  reference_number TEXT NOT NULL,
  child_first_name TEXT NOT NULL,
  child_last_name TEXT NOT NULL,
  child_date_of_birth DATE NOT NULL,
  guardian_name TEXT NOT NULL,
  guardian_phone TEXT NOT NULL,
  guardian_email TEXT,
  desired_start_date DATE NOT NULL,
  schedule_type TEXT NOT NULL DEFAULT 'full_time' CHECK (schedule_type IN ('full_time','half_time','daily','custom')),
  -- Critères d'attribution (collectivités) : fratrie déjà accueillie, parent
  -- employé de l'établissement, situation particulière (justifiée en notes).
  has_sibling BOOLEAN NOT NULL DEFAULT false,
  is_staff_child BOOLEAN NOT NULL DEFAULT false,
  priority_notes TEXT,
  priority_score INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','waitlisted','offered','accepted','declined','withdrawn','expired')),
  offered_room_id UUID REFERENCES rooms(id),
  offered_at TIMESTAMPTZ,
  offer_expires_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  child_id UUID REFERENCES children(id),   -- renseigné à l'acceptation (enfant créé)
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (organization_id, reference_number),
  CONSTRAINT chk_enrollment_offer CHECK (
    (status <> 'offered') OR (offered_room_id IS NOT NULL AND offered_at IS NOT NULL AND offer_expires_at IS NOT NULL)
  ),
  CONSTRAINT chk_enrollment_accepted CHECK (status <> 'accepted' OR child_id IS NOT NULL)
);
CREATE INDEX idx_enrollment_requests_queue
  ON enrollment_requests (organization_id, site_id, status, priority_score DESC, created_at);
ALTER TABLE enrollment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollment_requests_tenant ON enrollment_requests
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);
COMMENT ON TABLE enrollment_requests IS
  'P2-4 : pré-inscriptions et liste d''attente — file par site ordonnée par score de priorité (fratrie, personnel, ancienneté) ; l''acceptation crée l''enfant (pre_registered) et fige child_id.';

-- ── P2-5 : planning du personnel ────────────────────────────────────────────
-- Un créneau = un membre, une salle, une date, une plage horaire. Pas de
-- chevauchement pour un même membre (contrainte d'exclusion, btree_gist).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE staff_shifts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id),
  room_id UUID REFERENCES rooms(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  shift_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  shift_type TEXT NOT NULL DEFAULT 'work' CHECK (shift_type IN ('work','on_call','training','leave')),
  notes TEXT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_shift_times CHECK (end_time > start_time),
  CONSTRAINT excl_shift_overlap EXCLUDE USING gist (
    staff_id WITH =,
    shift_date WITH =,
    tsrange((shift_date + start_time)::timestamp, (shift_date + end_time)::timestamp, '[)') WITH &&
  )
);
CREATE INDEX idx_staff_shifts_day ON staff_shifts (organization_id, site_id, shift_date, start_time);
CREATE INDEX idx_staff_shifts_staff ON staff_shifts (organization_id, staff_id, shift_date);
ALTER TABLE staff_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_shifts FORCE ROW LEVEL SECURITY;
CREATE POLICY staff_shifts_tenant ON staff_shifts
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);
COMMENT ON TABLE staff_shifts IS
  'P2-5 : planning du personnel — créneaux datés par salle, sans chevauchement par membre (EXCLUDE gist) ; la couverture est confrontée aux ratios RATIO_EDUC (staff-schedule.service).';

COMMIT;
