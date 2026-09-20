-- ============================================================================
-- 064 — Durcissement intégrité financière (analyse 1, rapport 2026-09-19 :
-- DB1 / DB2 / DB3). Aucune donnée modifiée ; fonctions de garde + index.
-- Rétrocompatible : les flux applicatifs existants (cash, webhook, facturation)
-- conservent exactement les mêmes règles que 023 — le verrou est simplement
-- étendu au paiement, ce qui n'affecte pas les transactions séquentielles.
-- ============================================================================
BEGIN;

-- ── DB1 — index de lecture facturation ─────────────────────────────────────
-- Le rapport (analyse 1, DB1) : toute lecture des lignes d'une facture
-- fait un seq-scan complet de la table.
CREATE INDEX IF NOT EXISTS idx_invoice_lines_invoice
  ON invoice_lines (invoice_id);

-- ── DB3 — suppression interdite (C04 durci) ─────────────────────────────────
-- Un rôle SQL avec DELETE pouvait supprimer une facture payée ou un paiement
-- confirmé. Le cycle de vie est immuable : plus aucun DELETE.
CREATE OR REPLACE FUNCTION no_financial_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suppression interdite sur % : le cycle de vie financier est immuable (C04)', TG_TABLE_NAME
    USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_no_delete_invoices
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION no_financial_delete();

CREATE TRIGGER trg_no_delete_payments
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION no_financial_delete();

CREATE TRIGGER trg_no_delete_allocations
  BEFORE DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION no_financial_delete();

-- ── DB3 — C04 factures : clôture ⇒ tous champs immuables sauf updated_at ───
-- La version 010 ne bloquait que total_amount/paid_amount : status, child_id,
-- due_date, pdf_url, période… restaient modifiables sur une facture payée.
-- Différentiel jsonb : robuste, ne dépend pas de la liste des colonnes.
-- Strikt pour TOUS les rôles (app et superuser) — c'est le contrat du test
-- phase8 (SQL direct bloqué) ; les opérations légitimes passent par la
-- liste d'autorisation ci-dessous, pas par une exonération de rôle.
CREATE OR REPLACE FUNCTION guard_invoice_mutation() RETURNS trigger AS $$
DECLARE v_new jsonb := to_jsonb(NEW); v_old jsonb := to_jsonb(OLD); v_k text;
BEGIN
  IF OLD.status IN ('paid', 'cancelled') AND v_new IS DISTINCT FROM v_old THEN
    FOR v_k IN SELECT kv.key FROM jsonb_each(v_new) AS kv(key, value) LOOP
      -- Autorisés :
      --   updated_at : horodatage de maintenance ;
      --   balance    : colonne GENERATED (NULL dans NEW avant génération ;
      --                dérivée de total_amount/paid_amount, verrouillés) ;
      --   pdf_url    : le document PDF est généré/régénéré par le worker
      --                (job generate_invoice_pdf) — y compris après
      --                encaissement ; ce n'est pas du contenu financier.
      IF v_new -> v_k IS DISTINCT FROM v_old -> v_k
         AND v_k NOT IN ('updated_at', 'balance', 'pdf_url') THEN
        RAISE EXCEPTION 'INVOICE_IMMUTABLE' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- Le trigger trg_invoice_immutable (BEFORE UPDATE) existe déjà (010) : il
-- pointe sur la fonction remplacée ci-dessus.

-- ── DB3 — C04 paiements : confirmé/remboursé ⇒ immuable sauf gateway_response
-- Réponses passerelle post-confirmation (webhook de statut) restent
-- journalisables ; tout le reste (montant, méthode, référence, reçu…) est figé.
-- Strikt pour TOUS les rôles (idem factures) ; l'anonymisation DPO
-- (anonymize.sql:220) neutralise external_reference/gateway_response/notes —
-- ces trois colonnes sont donc dans la liste d'autorisation : ce sont des
-- métadonnées (référence passerelle, journal de réponse, texte libre), pas
-- du contenu financier (montant, méthode, référence interne, reçu, statut).
CREATE OR REPLACE FUNCTION guard_payment_mutation() RETURNS trigger AS $$
DECLARE v_new jsonb := to_jsonb(NEW); v_old jsonb := to_jsonb(OLD); v_k text;
BEGIN
  IF OLD.status IN ('confirmed', 'refunded') AND v_new IS DISTINCT FROM v_old THEN
    FOR v_k IN SELECT kv.key FROM jsonb_each(v_new) AS kv(key, value) LOOP
      IF v_new -> v_k IS DISTINCT FROM v_old -> v_k
         AND v_k NOT IN ('gateway_response', 'external_reference', 'notes') THEN
        RAISE EXCEPTION 'PAYMENT_IMMUTABLE' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- Le trigger trg_payment_immutable (BEFORE UPDATE) existe déjà (010).

-- ── DB2 — allocation : verrou sur le PAIEMENT (correction du trou 023) ──────
-- La version 023 ne verrouillait que la ligne FACTURE (FOR UPDATE) :
-- deux INSERT concurrents vers DEUX FACTURES différentes ne se bloquaient
-- pas mutuellement, chacun voyait une somme d'allocations sans l'autre,
-- et le paiement pouvait être sur-alloué. Le paiement est maintenant verrouillé
-- EN PREMIER : la seconde transaction attend, puis voit la somme committée.
-- Règles business inchangées (rejouées à l'identique par phase44b) :
--   somme(allocations du paiement) + nouvelle ≤ montant du paiement ;
--   paid_amount de la facture + nouvelle ≤ total_amount de la facture ;
--   le paiement doit être confirmé ; le paiement et la facture doivent
--   appartenir à la même organisation (anti-cross-tenant, y compris en
--   écriture SQL directe hors RLS).
CREATE OR REPLACE FUNCTION guard_payment_allocation() RETURNS trigger AS $$
DECLARE
  v_payment numeric(10,2); v_status payment_status; v_org_p uuid; v_org_i uuid;
  v_invoice_total numeric(10,2); v_invoice_paid numeric(10,2); v_sum numeric(10,2);
BEGIN
  SELECT amount, status, organization_id INTO v_payment, v_status, v_org_p
    FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable pour l''allocation' USING ERRCODE = '23503';
  END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Allocation impossible : paiement non confirmé' USING ERRCODE = 'P0001';
  END IF;
  SELECT total_amount, paid_amount, organization_id INTO v_invoice_total, v_invoice_paid, v_org_i
    FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable pour l''allocation' USING ERRCODE = '23503';
  END IF;
  IF v_org_p IS DISTINCT FROM v_org_i THEN
    RAISE EXCEPTION 'Allocation traversant les organisations' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(SUM(amount_allocated),0) INTO v_sum
    FROM payment_allocations WHERE payment_id = NEW.payment_id;
  IF v_sum + NEW.amount_allocated > v_payment THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_PAYMENT' USING ERRCODE = 'P0001';
  END IF;
  IF v_invoice_paid + NEW.amount_allocated > v_invoice_total THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_INVOICE' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.amount_allocated <= 0 THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_INVALID' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
-- Le trigger trg_payment_allocation_guard (BEFORE INSERT, 023) est conservé :
-- il pointe sur la fonction remplacée ci-dessus.

-- ── DB2 — modification d'allocation (aucun flux applicatif : verrou total) ─
-- UPDATE et DELETE de payment_allocations (DELETE déjà interdit plus haut).
-- Bornes identiques à l'INSERT, avec la ligne en cours exclue des sommes.
CREATE OR REPLACE FUNCTION guard_payment_allocation_mutation() RETURNS trigger AS $$
DECLARE
  v_payment numeric(10,2); v_status payment_status; v_org_p uuid; v_org_i uuid;
  v_invoice_total numeric(10,2); v_invoice_paid numeric(10,2);
  v_sum_pay numeric(10,2); v_sum_inv numeric(10,2);
BEGIN
  SELECT amount, status, organization_id INTO v_payment, v_status, v_org_p
    FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Paiement introuvable pour l''allocation' USING ERRCODE = '23503';
  END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'Allocation impossible : paiement non confirmé' USING ERRCODE = 'P0001';
  END IF;
  SELECT total_amount, paid_amount, organization_id INTO v_invoice_total, v_invoice_paid, v_org_i
    FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable pour l''allocation' USING ERRCODE = '23503';
  END IF;
  IF v_org_p IS DISTINCT FROM v_org_i THEN
    RAISE EXCEPTION 'Allocation traversant les organisations' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(SUM(amount_allocated),0) INTO v_sum_pay
    FROM payment_allocations
    WHERE payment_id = NEW.payment_id AND id <> NEW.id;
  IF v_sum_pay + NEW.amount_allocated > v_payment THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_PAYMENT' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(SUM(amount_allocated),0) INTO v_sum_inv
    FROM payment_allocations
    WHERE invoice_id = NEW.invoice_id AND id <> NEW.id;
  IF v_sum_inv + NEW.amount_allocated > v_invoice_total THEN
    RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_INVOICE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_allocation_mutation
  BEFORE UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_payment_allocation_mutation();

COMMIT;
