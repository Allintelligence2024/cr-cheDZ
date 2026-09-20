-- ============================================================================
-- 068 — Impayés & relances (P2-3, docs/ANALYSE_PILIERS_MANQUANTS.md)
-- ----------------------------------------------------------------------------
-- Constat : invoice_status possède 'overdue' depuis 001 mais AUCUN code ne
-- l'écrivait ; aucune facture ne sortait de 'draft' par l'API ; aucune trace
-- de relance n'existait. Le journal des impayés est pourtant le module central
-- de toute gestion de crèche (Belami, L&A, Procare).
--
-- Ce que cette migration pose :
--   1. invoice_reminders : historique des relances (niveau 1..3, canal email
--      ou manuel), une ligne par niveau et par facture (UNIQUE) — jamais deux
--      « 1er rappel » pour la même facture. RLS forcée (table tenant).
--   2. invoices_mark_overdue(p_org) : transition idempotente sent /
--      partially_paid → overdue quand due_date est dépassée (date d'Alger).
--      SECURITY INVOKER : s'exécute DANS le tenant courant (RLS), appelée par
--      l'API lors de la consultation de la balance âgée / d'une relance.
--      Aucun nouveau job planifié : scheduler_ticks (056) fige 3 traitements
--      et la fraîcheur de la balance est garantie à la lecture.
--
-- Immuabilité (064) : seules les factures paid/cancelled sont figées ;
-- sent/partially_paid → overdue reste une mutation légitime.
-- ============================================================================
BEGIN;

CREATE TABLE invoice_reminders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  -- Niveau de relance : 1 rappel, 2 relance, 3 dernier rappel.
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  -- email : envoyé réellement (fail-closed, P0-1) ; manual : appel/entretien
  -- consigné par le personnel (notes obligatoires côté API).
  channel TEXT NOT NULL CHECK (channel IN ('email', 'manual')),
  -- Solde réclamé au moment de la relance (photo, pas une colonne dérivée).
  balance_due NUMERIC(10,2) NOT NULL CHECK (balance_due > 0),
  -- Tuteur destinataire (email) — référence, jamais l'adresse en clair ici.
  guardian_id UUID REFERENCES guardians(id),
  notes TEXT,
  sent_by UUID NOT NULL REFERENCES users(id),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invoice_id, level)
);

CREATE INDEX idx_invoice_reminders_org_invoice ON invoice_reminders (organization_id, invoice_id, level);

ALTER TABLE invoice_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_reminders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_reminders_tenant ON invoice_reminders;
CREATE POLICY invoice_reminders_tenant ON invoice_reminders
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

COMMENT ON TABLE invoice_reminders IS
  'P2-3 : historique des relances d''impayés (1 ligne par niveau et par facture). Une relance email n''est enregistrée QUE si l''envoi a réussi (transaction).';

-- Transition d'impayé : idempotente, bornée au tenant courant (RLS + filtre
-- explicite). Retourne le nombre de factures passées en overdue.
CREATE OR REPLACE FUNCTION invoices_mark_overdue(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SET search_path = public, pg_temp
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE invoices
     SET status = 'overdue', updated_at = NOW()
   WHERE organization_id = p_org
     AND status IN ('sent', 'partially_paid')
     AND due_date < (NOW() AT TIME ZONE 'Africa/Algiers')::date;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION invoices_mark_overdue(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'creche_app') THEN
    GRANT EXECUTE ON FUNCTION invoices_mark_overdue(uuid) TO creche_app;
  END IF;
END $$;

COMMIT;
