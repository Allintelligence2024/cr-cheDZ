-- ============================================================================
-- 002_organizations.sql
-- Organisations, sites, salles.
-- RLS (USING + WITH CHECK) appliquée dès la création (C01).
-- ============================================================================

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug TEXT UNIQUE NOT NULL,
  name_fr TEXT NOT NULL,
  name_ar TEXT,
  legal_name TEXT,
  -- Type d'établissement au sens du décret exécutif 19-253 (2019) :
  -- creche (3 mois-3 ans), jardin_enfants (3-6 ans), multi_accueil (3 mois-<6 ans)
  establishment_type TEXT NOT NULL DEFAULT 'creche',
  registration_number TEXT,
  phone TEXT,
  email TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  commune TEXT,
  wilaya TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'DZ',
  logo_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'Africa/Algiers',
  locale TEXT NOT NULL DEFAULT 'fr',
  subscription_plan TEXT NOT NULL DEFAULT 'trial',
  subscription_ends_at TIMESTAMPTZ,
  -- Limite réglementaire décret 19-253 : 150 enfants par établissement
  max_children INTEGER NOT NULL DEFAULT 150,
  is_active BOOLEAN NOT NULL DEFAULT true,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  name_fr TEXT NOT NULL,
  name_ar TEXT,
  phone TEXT,
  email TEXT,
  address_line1 TEXT,
  commune TEXT,
  wilaya TEXT,
  authorized_capacity INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  name_fr TEXT NOT NULL,
  name_ar TEXT,
  min_age_months INTEGER NOT NULL DEFAULT 3,
  max_age_months INTEGER NOT NULL DEFAULT 71,
  max_capacity INTEGER NOT NULL DEFAULT 12,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  version INTEGER NOT NULL DEFAULT 1
);

-- RLS — tables tenant (C01 : USING + WITH CHECK) -----------------------------

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sites_tenant_isolation ON sites;
CREATE POLICY sites_tenant_isolation ON sites
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rooms_tenant_isolation ON rooms;
CREATE POLICY rooms_tenant_isolation ON rooms
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index performance ----------------------------------------------------------

CREATE INDEX idx_sites_org ON sites(organization_id);
CREATE INDEX idx_rooms_org ON rooms(organization_id);
CREATE INDEX idx_rooms_site ON rooms(site_id);
