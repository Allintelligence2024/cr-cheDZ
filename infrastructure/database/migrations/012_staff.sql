-- ============================================================================
-- 012_staff.sql
-- Personnel : profils, documents (alertes expiration), affectations aux
-- salles, pointage du personnel. RLS WITH CHECK (C01).
-- ============================================================================

CREATE TABLE staff_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  employee_number TEXT,
  national_id TEXT,
  cnas_number TEXT,
  qualification TEXT NOT NULL, -- educator_qualified, director, nurse, admin, other
  hire_date DATE NOT NULL,
  contract_type TEXT NOT NULL DEFAULT 'permanent', -- permanent, fixed_term, part_time
  base_salary NUMERIC(10,2),
  phone TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE staff_documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id),
  document_type TEXT NOT NULL,
  title TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  issued_date DATE,
  expiry_date DATE,
  issuing_authority TEXT,
  alert_days_before INTEGER DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE staff_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id),
  room_id UUID NOT NULL REFERENCES rooms(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_assignment_dates CHECK (
    end_date IS NULL OR end_date >= start_date
  )
);

CREATE TABLE staff_attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  staff_id UUID NOT NULL REFERENCES staff_profiles(id),
  attendance_date DATE NOT NULL,
  check_in TIMESTAMPTZ,
  check_out TIMESTAMPTZ,
  absence_type TEXT, -- present, vacation, sick, training, other
  notes TEXT,
  approved_by UUID REFERENCES users(id),
  UNIQUE(staff_id, attendance_date),
  CONSTRAINT chk_staff_attendance_times CHECK (
    check_out IS NULL OR check_in IS NULL OR check_out >= check_in
  )
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_profiles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_profiles_tenant ON staff_profiles;
CREATE POLICY staff_profiles_tenant ON staff_profiles
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE staff_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_documents_tenant ON staff_documents;
CREATE POLICY staff_documents_tenant ON staff_documents
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE staff_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_assignments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_assignments_tenant ON staff_assignments;
CREATE POLICY staff_assignments_tenant ON staff_assignments
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE staff_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_attendance FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_attendance_tenant ON staff_attendance;
CREATE POLICY staff_attendance_tenant ON staff_attendance
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_staff_org ON staff_profiles(organization_id) WHERE is_active = true;
CREATE INDEX idx_staff_assignments_room ON staff_assignments(room_id) WHERE is_active = true;
CREATE INDEX idx_staff_docs_expiry ON staff_documents(expiry_date) WHERE expiry_date IS NOT NULL;
CREATE INDEX idx_staff_attendance_date ON staff_attendance(attendance_date);
