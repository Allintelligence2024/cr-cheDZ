-- ============================================================================
-- 011_health.sql
-- Santé : dossier médical, allergies, vaccinations, autorisations et
-- administrations de médicaments. Données sensibles — accès journalisé
-- (data_access_logs, migration 004) et RLS WITH CHECK (C01).
-- ============================================================================

CREATE TABLE health_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  blood_type TEXT,
  family_doctor TEXT,
  doctor_phone TEXT,
  health_insurance TEXT,
  chronic_conditions TEXT,
  general_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(child_id)
);

CREATE TABLE allergies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  allergen TEXT NOT NULL,
  allergen_type TEXT NOT NULL, -- food, medicine, environment, other
  severity TEXT NOT NULL,      -- mild, moderate, severe, life_threatening
  reaction TEXT,
  treatment TEXT,
  emergency_protocol TEXT,
  confirmed_by_doctor BOOLEAN NOT NULL DEFAULT false,
  diagnosed_date DATE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE vaccinations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  vaccine_name TEXT NOT NULL,
  dose_number INTEGER,
  administered_date DATE,
  next_dose_date DATE,
  administered_by TEXT,
  lot_number TEXT,
  document_id UUID,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE medication_authorizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  guardian_id UUID NOT NULL REFERENCES guardians(id),
  medication_name TEXT NOT NULL,
  dosage TEXT NOT NULL,
  frequency TEXT NOT NULL,
  administration_times TEXT[],
  start_date DATE NOT NULL,
  end_date DATE,
  prescription_id UUID,
  special_instructions TEXT,
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_med_auth_dates CHECK (
    end_date IS NULL OR end_date >= start_date
  )
);

CREATE TABLE medication_administrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  authorization_id UUID NOT NULL REFERENCES medication_authorizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  administered_at TIMESTAMPTZ NOT NULL,
  administered_by UUID NOT NULL REFERENCES users(id),
  confirmed_by UUID REFERENCES users(id),
  dose_given TEXT NOT NULL,
  observations TEXT,
  parent_notified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE health_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE health_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_records_tenant ON health_records;
CREATE POLICY health_records_tenant ON health_records
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE allergies ENABLE ROW LEVEL SECURITY;
ALTER TABLE allergies FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allergies_tenant ON allergies;
CREATE POLICY allergies_tenant ON allergies
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE vaccinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE vaccinations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vaccinations_tenant ON vaccinations;
CREATE POLICY vaccinations_tenant ON vaccinations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE medication_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_authorizations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS med_auth_tenant ON medication_authorizations;
CREATE POLICY med_auth_tenant ON medication_authorizations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE medication_administrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE medication_administrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS med_admin_tenant ON medication_administrations;
CREATE POLICY med_admin_tenant ON medication_administrations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_allergies_child ON allergies(child_id) WHERE is_active = true;
CREATE INDEX idx_vaccinations_child ON vaccinations(child_id);
CREATE INDEX idx_med_auth_child ON medication_authorizations(child_id) WHERE is_active = true;
CREATE INDEX idx_med_admin_child ON medication_administrations(child_id, administered_at DESC);
