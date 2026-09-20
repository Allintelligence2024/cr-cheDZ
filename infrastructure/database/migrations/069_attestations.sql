-- ============================================================================
-- 069 — Attestations annuelles de frais de garde (P2-6)
-- ----------------------------------------------------------------------------
-- Équivalent local des attestations fiscales CAF : document numéroté,
-- remis au tuteur facturable, récapitulant pour une année civile les montants
-- facturés / réglés et les jours de présence d'un enfant.
--
-- Principe : une attestation est une PHOTO figée au moment de l'émission
-- (montants, jours, numéro). Réémettre pour la même année crée un nouveau
-- document numéroté (les chiffres peuvent avoir changé : règlement tardif) ;
-- l'historique reste consultable. Aucune ligne n'est jamais modifiée.
-- ============================================================================
BEGIN;

CREATE TABLE attestations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID NOT NULL REFERENCES children(id),
  attestation_number TEXT NOT NULL,
  year INTEGER NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  total_invoiced NUMERIC(12,2) NOT NULL CHECK (total_invoiced >= 0),
  total_paid NUMERIC(12,2) NOT NULL CHECK (total_paid >= 0 AND total_paid <= total_invoiced),
  invoice_count INTEGER NOT NULL CHECK (invoice_count >= 0),
  days_present INTEGER NOT NULL CHECK (days_present >= 0),
  period_start DATE,
  period_end DATE,
  -- Tuteur destinataire nommé sur le document (référence, jamais l'état civil copié ici).
  guardian_id UUID REFERENCES guardians(id),
  issued_by UUID NOT NULL REFERENCES users(id),
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, attestation_number),
  CONSTRAINT chk_attestation_period CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);

CREATE INDEX idx_attestations_child_year ON attestations (organization_id, child_id, year, issued_at DESC);

ALTER TABLE attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE attestations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attestations_tenant ON attestations;
CREATE POLICY attestations_tenant ON attestations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Immuabilité : un document remis ne se corrige pas, il se réémet.
CREATE OR REPLACE FUNCTION guard_attestation_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ATTESTATION_IMMUTABLE' USING ERRCODE = 'P0001';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_attestation_immutable
  BEFORE UPDATE OR DELETE ON attestations
  FOR EACH ROW EXECUTE FUNCTION guard_attestation_mutation();

COMMENT ON TABLE attestations IS
  'P2-6 : attestations annuelles de frais de garde — photo figée (montants, jours, numéro) à l''émission ; jamais modifiée, réémission = nouveau numéro.';

COMMIT;
