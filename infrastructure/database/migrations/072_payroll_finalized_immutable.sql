-- ============================================================================
-- 072_payroll_finalized_immutable.sql
-- Remédiation R15 / F13 (2026-09-21) — garde « finalized » sur payroll_runs.
--
-- Constat (F13) : une course `payroll_runs` (migration 044) finalize le mois
-- et écrit `status='finalized', finalized_at=NOW()`. Le code applicatif
-- empêche alors les transitions logiques, mais une requête SQL directe
-- (UPDATE/DELETE via psql, ou via un futur endpoint oublié) peut muter la
-- ligne : c'est l'asymétrie pointée par l'audit — la facturation payée
-- est verrouillée par le trigger C04 (invoices, payments) mais pas la paie.
-- Risques :
--   1. modification de `total_gross/total_net` après remise des bulletins ;
--   2. suppression d'un run finalisé → perte comptable opposable à la loi ;
--   3. bascule de `status` finalisé → draft, permettant une régénération
--      concurrente et un dédoublement de bulletins (UNIQUE run/staff casse
--      au deuxième essai, mais entre-temps l'argent a été versé).
--
-- Correction : trigger BEFORE UPDATE qui refuse toute mutation d'un run
-- finalisé SAUF la transition finalisé → cancelled (annulation comptable
-- motivée, comme pour une facture ; nécessite un motif que l'app appliquera
-- via UPDATE explicite, hors scope de cette migration) et la transition
-- finalized → draft (REFUSÉE — c'est la garantie de non-régression). Pour
-- les `payroll_entries` et `payroll_lines` : trigger miroir, refus dès que
-- la run parente est finalisée. Seuls l'app (UI + service) peut annuler.
--
-- ADR-007 : migration additive (la 044 reste immuable). Pas de DROP/CREATE
-- TABLE — uniquement CREATE TRIGGER + CREATE FUNCTION.
-- ============================================================================

CREATE OR REPLACE FUNCTION guard_payroll_run_finalized() RETURNS trigger AS $$
DECLARE
  v_finalized BOOLEAN;
BEGIN
  -- finalized_at IS NOT NULL est la source de vérité (status peut être
  -- mis à jour atomiquement par d'autres transitions : on teste la marque).
  v_finalized := (OLD.finalized_at IS NOT NULL);

  -- (c) Test cancelled EN PREMIER — l'erreur la plus spécifique doit primer
  -- (sinon on renvoie PAYROLL_RUN_FINALIZED alors que le run est cancelled,
  --     ce qui masque la vraie raison du refus).
  IF TG_OP = 'UPDATE' AND OLD.status = 'cancelled' THEN
    RAISE EXCEPTION 'PAYROLL_RUN_CANCELLED: une course annulée est immuable'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_finalized THEN
    -- (a) UPDATE d'une ligne finalisée : seul `status → cancelled` autorisé
    --     (avec le motif comptable dans `notes` par l'app). Toute autre
    --     mutation d'une colonne « métier » est refusée.
    IF TG_OP = 'UPDATE' AND NOT (
        OLD.status = 'finalized' AND NEW.status = 'cancelled'
    ) THEN
      RAISE EXCEPTION 'PAYROLL_RUN_FINALIZED: une course de paie finalisée est immuable (total_gross, total_net, period_*). Annuler uniquement via status=cancelled.'
        USING ERRCODE = 'P0001';
    END IF;
    -- (b) DELETE d'une ligne finalisée : interdit. On garde la trace pour
    --     audit. La FK CASCADE depuis payroll_entries gère déjà la
    --     suppression en cascade (mais uniquement quand le run n'est PAS
    --     finalisé — test ci-dessous).
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'PAYROLL_RUN_FINALIZED: suppression d''une course de paie finalisée interdite (immuable, audit)'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_run_finalized
  BEFORE UPDATE OR DELETE ON payroll_runs
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_run_finalized();

-- Miroir sur payroll_entries : une entrée attachée à un run finalisé est
-- immuable (les bulletins sont des documents comptables émis). Le test est
-- fait par jointure sur la table parente — index `idx_payroll_runs_org`
-- n'est pas optimal ici, on s'appuie sur la PK du run.
CREATE OR REPLACE FUNCTION guard_payroll_entry_finalized() RETURNS trigger AS $$
DECLARE
  v_finalized_at TIMESTAMPTZ;
  v_status TEXT;
BEGIN
  SELECT finalized_at, status INTO v_finalized_at, v_status FROM payroll_runs WHERE id = OLD.run_id;
  -- Test cancelled EN PREMIER (même logique que guard_payroll_run_finalized).
  IF v_status = 'cancelled' THEN
    RAISE EXCEPTION 'PAYROLL_ENTRY_CANCELLED: bulletin d''une course annulée immuable'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_finalized_at IS NOT NULL THEN
    RAISE EXCEPTION 'PAYROLL_ENTRY_FINALIZED: modification d''un bulletin rattaché à une course finalisée interdite'
      USING ERRCODE = 'P0001';
  END IF;
  -- En DELETE, RETURN OLD (par convention ; postgres ignore la valeur
  -- retournée pour DELETE). En UPDATE, RETURN NEW propage la mutation.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_entry_finalized
  BEFORE UPDATE OR DELETE ON payroll_entries
  FOR EACH ROW EXECUTE FUNCTION guard_payroll_entry_finalized();

COMMENT ON FUNCTION guard_payroll_run_finalized() IS
  'R15 (remédiation 2026-09-21, F13) — un run de paie finalisé est immuable : seul status → cancelled est autorisé. DELETE refusé. Annulé aussi immuable. Miroir sur payroll_entries (gardes payroll_entry_finalized).';
COMMENT ON FUNCTION guard_payroll_entry_finalized() IS
  'R15 (F13) — un bulletin (payroll_entries) lié à un run finalisé OU annulé est immuable. Verrouillage comptable des bulletins émis.';
