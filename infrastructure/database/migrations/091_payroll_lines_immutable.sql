-- ============================================================================
-- 091_payroll_lines_immutable.sql
-- P2 (remédiation 2026-10-04, phase 3.4.2 / F3) — le trigger 072 couvre
-- payroll_runs et payroll_entries mais PAS payroll_lines.
--
-- payroll_lines.entry_id → payroll_entries(id). Une fois le run finalisé,
-- les lignes (montants bruts/retenues/net, heures, primes) restaient
-- librement modifiables ou supprimables : le bulletin émis et figé dans
-- payroll_entries ne correspondait plus aux lignes qui le composent —
-- document comptable incohérent.
--
-- Correction : trigger miroir. La lecture de finalized_at/status se fait par
-- jointure sur payroll_runs via entry_id, en lecture seule (pas de UPDATE
-- sur payroll_runs, donc pas de récursion). Même sémantique que 072 :
-- cancelled est immuable lui aussi, et la seule mutation autorisée sur un
-- run est status → cancelled (déjà gérée par 072).
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_payroll_line_finalized() RETURNS trigger AS $$
DECLARE
  v_finalized_at TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  -- Une ligne n'existe jamais sans son entrée (FK NOT NULL). Lecture jointée
  -- (SECURITY DEFINER inutile : trigger exécuté comme propriétaire).
  SELECT r.finalized_at, r.status
    INTO v_finalized_at, v_status
  FROM payroll_entries e
  JOIN payroll_runs r ON r.id = e.run_id
  WHERE e.id = OLD.entry_id;

  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'PAYROLL_LINE_CANCELLED: ligne d''un bulletin d''une course annulée immuable'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'PAYROLL_LINE_FINALIZED: modification d''une ligne rattachée à un bulletin finalisé interdite'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_line_finalized
  BEFORE UPDATE OR DELETE ON payroll_lines
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_line_finalized();

COMMENT ON FUNCTION guard_payroll_line_finalized() IS
  'P2 (remédiation 2026-10-04, phase 3.4.2 / F3) — une ligne de bulletin (payroll_lines) liée à un run finalisé OU annulé est immuable. Miroir de guard_payroll_entry_finalized (072) pour les lignes.';
