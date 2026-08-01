-- ============================================================================
-- 010_billing.sql
-- Facturation : contrats, factures, lignes, paiements, allocations, caisse.
-- C04 : intégrité financière en base (CHECK + trigger d'immutabilité).
-- ============================================================================

CREATE TABLE contracts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  reference_number TEXT,
  schedule_type TEXT NOT NULL DEFAULT 'full_time', -- full_time, half_time, daily, custom
  monthly_base_amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'DZD',
  includes_meals BOOLEAN NOT NULL DEFAULT false,
  meal_amount NUMERIC(10,2),
  includes_transport BOOLEAN NOT NULL DEFAULT false,
  transport_amount NUMERIC(10,2),
  discount_percent NUMERIC(5,2) DEFAULT 0,
  discount_reason TEXT,
  registration_fee NUMERIC(10,2),
  start_date DATE NOT NULL,
  end_date DATE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_contract_amounts CHECK (
    monthly_base_amount >= 0 AND discount_percent BETWEEN 0 AND 100
  ),
  CONSTRAINT chk_contract_dates CHECK (
    end_date IS NULL OR end_date >= start_date
  )
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  invoice_number TEXT NOT NULL,
  child_id UUID NOT NULL REFERENCES children(id),
  contract_id UUID REFERENCES contracts(id),
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(10,2) NOT NULL,
  paid_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  balance NUMERIC(10,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
  status invoice_status NOT NULL DEFAULT 'draft',
  due_date DATE NOT NULL,
  sent_at TIMESTAMPTZ,
  notes TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  UNIQUE(organization_id, invoice_number),
  CONSTRAINT chk_invoice_period CHECK (period_month BETWEEN 1 AND 12),
  -- C04 : cohérence arithmétique et comptable en base
  CONSTRAINT chk_invoice_amounts CHECK (
    subtotal >= 0 AND discount_amount >= 0 AND total_amount >= 0
    AND paid_amount >= 0 AND paid_amount <= total_amount
    AND total_amount = subtotal - discount_amount
  )
);

CREATE TABLE invoice_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  description_fr TEXT NOT NULL,
  description_ar TEXT,
  quantity NUMERIC(10,3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(10,2) NOT NULL,
  total_price NUMERIC(10,2) NOT NULL,
  line_type TEXT NOT NULL DEFAULT 'care', -- care, meal, transport, activity, registration, adjustment, discount
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- C04 : total ligne = quantité × prix unitaire
  CONSTRAINT chk_line_total CHECK (total_price = quantity * unit_price)
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  reference_number TEXT NOT NULL,
  child_id UUID NOT NULL REFERENCES children(id),
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'DZD',
  method payment_method NOT NULL,
  status payment_status NOT NULL DEFAULT 'pending',
  external_reference TEXT UNIQUE, -- référence fournisseur (idempotence webhook)
  payment_gateway TEXT,
  gateway_response JSONB,
  received_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  notes TEXT,
  receipt_number TEXT UNIQUE,
  receipt_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID NOT NULL REFERENCES users(id),
  UNIQUE(organization_id, reference_number),
  CONSTRAINT chk_payment_amount CHECK (amount > 0)
);

CREATE TABLE payment_allocations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  payment_id UUID NOT NULL REFERENCES payments(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  amount_allocated NUMERIC(10,2) NOT NULL,
  allocated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  allocated_by UUID NOT NULL REFERENCES users(id),
  UNIQUE(payment_id, invoice_id),
  CONSTRAINT chk_allocation_amount CHECK (amount_allocated > 0)
);

CREATE TABLE daily_cash_registers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  site_id UUID NOT NULL REFERENCES sites(id),
  register_date DATE NOT NULL,
  opening_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(10,2),
  total_cash_in NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_cash_out NUMERIC(10,2) NOT NULL DEFAULT 0,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES users(id),
  notes TEXT,
  UNIQUE(site_id, register_date)
);

-- ============================================================================
-- C04 — Immuabilité des factures payées/annulées (défense en base)
-- ============================================================================
CREATE OR REPLACE FUNCTION guard_invoice_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('paid', 'cancelled')
     AND (NEW.total_amount IS DISTINCT FROM OLD.total_amount
          OR NEW.paid_amount   IS DISTINCT FROM OLD.paid_amount) THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_immutable
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_mutation();

-- ============================================================================
-- C04 — Immuabilité des paiements confirmés/remboursés
-- ============================================================================
CREATE OR REPLACE FUNCTION guard_payment_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('confirmed', 'refunded')
     AND (NEW.amount IS DISTINCT FROM OLD.amount
          OR NEW.method IS DISTINCT FROM OLD.method
          OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'PAYMENT_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payment_immutable
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_mutation();

-- RLS ------------------------------------------------------------------------

ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contracts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_tenant ON contracts;
CREATE POLICY contracts_tenant ON contracts
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_tenant ON invoices;
CREATE POLICY invoices_tenant ON invoices
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_lines FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoice_lines_tenant ON invoice_lines;
CREATE POLICY invoice_lines_tenant ON invoice_lines
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payments_tenant ON payments;
CREATE POLICY payments_tenant ON payments
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_allocations_tenant ON payment_allocations;
CREATE POLICY payment_allocations_tenant ON payment_allocations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE daily_cash_registers ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_cash_registers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cash_registers_tenant ON daily_cash_registers;
CREATE POLICY cash_registers_tenant ON daily_cash_registers
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_invoices_org_status ON invoices(organization_id, status, due_date);
CREATE INDEX idx_invoices_child ON invoices(child_id, period_year, period_month);
CREATE INDEX idx_payments_org ON payments(organization_id, created_at DESC);
CREATE INDEX idx_payments_external ON payments(external_reference) WHERE external_reference IS NOT NULL;
CREATE INDEX idx_payment_alloc_invoice ON payment_allocations(invoice_id);
CREATE INDEX idx_contracts_child ON contracts(child_id) WHERE is_active = true;
