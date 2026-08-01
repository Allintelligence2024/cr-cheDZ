-- Phase 8 : allocations financièrement bornées, même en écriture SQL directe.
CREATE OR REPLACE FUNCTION guard_payment_allocation() RETURNS trigger AS $$
DECLARE v_payment numeric(10,2); v_invoice_total numeric(10,2); v_invoice_paid numeric(10,2);
BEGIN
 SELECT amount INTO v_payment FROM payments WHERE id=NEW.payment_id;
 SELECT total_amount, paid_amount INTO v_invoice_total, v_invoice_paid FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 IF (SELECT COALESCE(SUM(amount_allocated),0) FROM payment_allocations WHERE payment_id=NEW.payment_id) + NEW.amount_allocated > v_payment THEN
   RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_PAYMENT' USING ERRCODE='P0001';
 END IF;
 IF v_invoice_paid + NEW.amount_allocated > v_invoice_total THEN
   RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_INVOICE' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_payment_allocation_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION guard_payment_allocation();
