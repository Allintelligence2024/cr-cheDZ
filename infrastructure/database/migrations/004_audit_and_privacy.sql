-- ============================================================================
-- 004_audit_and_privacy.sql
-- Journalisation conforme à la loi 18-07 modifiée par la loi 25-11 du
-- 24/07/2025 : audit, carnet d'accès aux données sensibles, registre des
-- traitements (DPO), consentements, demandes de droits.
--
-- Tables système (PAS de RLS, accès DPO/super_admin uniquement) :
--   audit_logs, data_access_logs
-- Tables tenant (RLS WITH CHECK, C01) :
--   processing_registry, consent_records, privacy_requests
--
-- NOTE : consent_records.guardian_id reçoit sa FK en migration 005
-- (la table guardians est créée là-bas).
-- ============================================================================

-- Journal d'audit général (loi 25-11, art. 3 : traçabilité des traitements)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  session_id UUID REFERENCES sessions(id),
  action audit_action NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  resource_label TEXT,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  correlation_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Journal d'accès aux données sensibles (carnet automatisé)
CREATE TABLE data_access_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  data_type TEXT NOT NULL,
  data_subject_id UUID NOT NULL,
  data_subject_type TEXT NOT NULL,
  access_type TEXT NOT NULL,
  justification TEXT,
  ip_address INET,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Registre des activités de traitement (DPO — loi 25-11)
CREATE TABLE processing_registry (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  processing_name TEXT NOT NULL,
  purpose_fr TEXT NOT NULL,
  purpose_ar TEXT,
  legal_basis TEXT NOT NULL,
  data_categories TEXT[] NOT NULL,
  data_subjects TEXT[] NOT NULL,
  retention_days INTEGER NOT NULL,
  third_parties TEXT[],
  security_measures TEXT[],
  dpo_notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consentements (par famille, par type, avec historique)
CREATE TABLE consent_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  guardian_id UUID NOT NULL, -- FK vers guardians ajoutée en 005
  child_id UUID,
  consent_type consent_type NOT NULL,
  granted BOOLEAN NOT NULL,
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  ip_address INET,
  signature_data TEXT,
  collected_by UUID REFERENCES users(id),
  collection_method TEXT NOT NULL DEFAULT 'app',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Demandes de droits (accès, rectification, opposition — loi 25-11)
CREATE TABLE privacy_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  requester_id UUID NOT NULL REFERENCES users(id),
  request_type TEXT NOT NULL,
  subject_id UUID,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  deadline TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE processing_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_registry FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS processing_registry_tenant ON processing_registry;
CREATE POLICY processing_registry_tenant ON processing_registry
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_records_tenant ON consent_records;
CREATE POLICY consent_records_tenant ON consent_records
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS privacy_requests_tenant ON privacy_requests;
CREATE POLICY privacy_requests_tenant ON privacy_requests
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_audit_org ON audit_logs(organization_id, occurred_at DESC);
CREATE INDEX idx_audit_user ON audit_logs(user_id, occurred_at DESC);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_data_access_org ON data_access_logs(organization_id, accessed_at DESC);
CREATE INDEX idx_consents_guardian ON consent_records(organization_id, guardian_id);
CREATE INDEX idx_consents_child ON consent_records(organization_id, child_id);
CREATE INDEX idx_privacy_org ON privacy_requests(organization_id, status);
