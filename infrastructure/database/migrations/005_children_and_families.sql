-- ============================================================================
-- 005_children_and_families.sql
-- Enfants, responsables légaux, liens et permissions, récupérations
-- autorisées, contacts d'urgence + historique (C08 : room_moves,
-- child_status_history).
-- RLS WITH CHECK sur toutes les tables tenant (C01).
-- ============================================================================

CREATE TABLE children (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  room_id UUID REFERENCES rooms(id),
  reference_number TEXT,
  first_name_fr TEXT NOT NULL,
  first_name_ar TEXT,
  last_name_fr TEXT NOT NULL,
  last_name_ar TEXT,
  date_of_birth DATE NOT NULL,
  gender TEXT,
  photo_url TEXT,
  status child_status NOT NULL DEFAULT 'active',
  enrollment_date DATE,
  departure_date DATE,
  departure_reason TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'full_time',
  is_walking BOOLEAN NOT NULL DEFAULT false,
  has_special_needs BOOLEAN NOT NULL DEFAULT false,
  special_needs_notes TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID REFERENCES users(id),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_children_dates CHECK (
    departure_date IS NULL OR enrollment_date IS NULL OR departure_date >= enrollment_date
  )
);

CREATE TABLE guardians (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  first_name_fr TEXT NOT NULL,
  first_name_ar TEXT,
  last_name_fr TEXT NOT NULL,
  last_name_ar TEXT,
  relationship TEXT NOT NULL,
  phone_primary TEXT,
  phone_secondary TEXT,
  email TEXT,
  national_id TEXT,
  address TEXT,
  employer TEXT,
  photo_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE child_guardians (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  guardian_id UUID NOT NULL REFERENCES guardians(id),
  is_legal_guardian BOOLEAN NOT NULL DEFAULT true,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  -- Permissions granulaires
  can_view_journal BOOLEAN NOT NULL DEFAULT true,
  can_view_health BOOLEAN NOT NULL DEFAULT true,
  can_receive_invoices BOOLEAN NOT NULL DEFAULT false,
  can_pay_invoices BOOLEAN NOT NULL DEFAULT false,
  can_pickup BOOLEAN NOT NULL DEFAULT true,
  can_authorize_pickup BOOLEAN NOT NULL DEFAULT false,
  can_receive_push BOOLEAN NOT NULL DEFAULT true,
  receives_invoice_copies BOOLEAN NOT NULL DEFAULT false,
  priority_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(child_id, guardian_id)
);

-- Personnes autorisées à récupérer (non-parents)
CREATE TABLE authorized_pickups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone TEXT,
  national_id TEXT,
  photo_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  valid_from DATE,
  valid_until DATE,
  added_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_pickup_dates CHECK (
    valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from
  )
);

-- Contacts d'urgence
CREATE TABLE emergency_contacts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone_primary TEXT NOT NULL,
  phone_secondary TEXT,
  priority_order INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Historique des changements de chambre (C08 — append-only)
CREATE TABLE room_moves (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  room_id_from UUID REFERENCES rooms(id),
  room_id_to UUID NOT NULL REFERENCES rooms(id),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  moved_by UUID NOT NULL REFERENCES users(id),
  reason TEXT
);

-- Historique des statuts enfant (C08 — append-only)
CREATE TABLE child_status_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  status_from child_status,
  status_to child_status NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID NOT NULL REFERENCES users(id),
  reason TEXT
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE children FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS children_tenant_isolation ON children;
CREATE POLICY children_tenant_isolation ON children
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guardians_tenant_isolation ON guardians;
CREATE POLICY guardians_tenant_isolation ON guardians
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE child_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_guardians FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS child_guardians_tenant_isolation ON child_guardians;
CREATE POLICY child_guardians_tenant_isolation ON child_guardians
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE authorized_pickups ENABLE ROW LEVEL SECURITY;
ALTER TABLE authorized_pickups FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authorized_pickups_tenant_isolation ON authorized_pickups;
CREATE POLICY authorized_pickups_tenant_isolation ON authorized_pickups
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emergency_contacts_tenant_isolation ON emergency_contacts;
CREATE POLICY emergency_contacts_tenant_isolation ON emergency_contacts
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE room_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_moves FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS room_moves_tenant_isolation ON room_moves;
CREATE POLICY room_moves_tenant_isolation ON room_moves
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE child_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_status_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS child_status_history_tenant_isolation ON child_status_history;
CREATE POLICY child_status_history_tenant_isolation ON child_status_history
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- FK consent_records.guardian_id (table créée en 004) ------------------------

ALTER TABLE consent_records
  ADD CONSTRAINT fk_consent_records_guardian
  FOREIGN KEY (guardian_id) REFERENCES guardians(id)
  ON DELETE RESTRICT;

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_children_org ON children(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_children_room ON children(organization_id, room_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_children_status ON children(organization_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_children_search ON children USING gin (first_name_fr gin_trgm_ops, last_name_fr gin_trgm_ops);
CREATE INDEX idx_guardians_org ON guardians(organization_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_child_guardians_child ON child_guardians(child_id);
CREATE INDEX idx_child_guardians_guardian ON child_guardians(guardian_id);
CREATE INDEX idx_pickups_child ON authorized_pickups(child_id) WHERE is_active = true;
CREATE INDEX idx_emergency_child ON emergency_contacts(child_id);
CREATE INDEX idx_room_moves_child ON room_moves(child_id, moved_at DESC);
CREATE INDEX idx_status_history_child ON child_status_history(child_id, changed_at DESC);
