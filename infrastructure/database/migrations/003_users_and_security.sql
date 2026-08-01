-- ============================================================================
-- 003_users_and_security.sql
-- Utilisateurs, rôles, permissions, appartenances, sessions, appareils, OTP.
--
-- Tables système (PAS de RLS — accès contrôlé par guards applicatifs) :
--   users, roles, permissions, role_permissions, sessions, otp_codes
-- Tables tenant (RLS WITH CHECK, C01) :
--   memberships, devices
--
-- Les rôles/permissions système sont insérés par le seed
-- infrastructure/database/seeds/003_roles_permissions.sql (pas ici).
-- ============================================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id),
  email TEXT UNIQUE,
  phone TEXT UNIQUE,
  password_hash TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'fr',
  avatar_url TEXT,
  status user_status NOT NULL DEFAULT 'pending',
  email_verified_at TIMESTAMPTZ,
  phone_verified_at TIMESTAMPTZ,
  totp_secret TEXT,
  totp_enabled BOOLEAN NOT NULL DEFAULT false,
  last_login_at TIMESTAMPTZ,
  last_login_ip INET,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  is_super_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID REFERENCES organizations(id), -- NULL = rôle système
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description_fr TEXT,
  description_ar TEXT,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NULLS NOT DISTINCT : les rôles système (organization_id NULL) restent uniques
  CONSTRAINT roles_org_unique UNIQUE NULLS NOT DISTINCT (organization_id, slug)
);

CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  resource TEXT NOT NULL,
  action TEXT NOT NULL,
  description TEXT,
  UNIQUE(resource, action)
);

CREATE TABLE role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id),
  permission_id UUID NOT NULL REFERENCES permissions(id),
  PRIMARY KEY(role_id, permission_id)
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  site_id UUID REFERENCES sites(id),
  room_ids UUID[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  invited_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- ADR-001 : 1 rôle par utilisateur et par organisation (MVP)
  UNIQUE(organization_id, user_id)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id),
  organization_id UUID REFERENCES organizations(id),
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_id UUID,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID REFERENCES sites(id),
  name TEXT NOT NULL,
  device_fingerprint TEXT NOT NULL,
  platform TEXT NOT NULL,
  app_version TEXT,
  fcm_token TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  registered_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE otp_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  target TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS memberships_tenant_isolation ON memberships;
CREATE POLICY memberships_tenant_isolation ON memberships
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devices_tenant_isolation ON devices;
CREATE POLICY devices_tenant_isolation ON devices
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_phone ON users(phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_memberships_org ON memberships(organization_id);
CREATE INDEX idx_memberships_user ON memberships(user_id);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_refresh ON sessions(refresh_token_hash);
CREATE INDEX idx_devices_org ON devices(organization_id);
CREATE INDEX idx_otp_target ON otp_codes(target, purpose);
