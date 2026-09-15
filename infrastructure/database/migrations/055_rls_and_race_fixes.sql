-- G2: new migration in the slot reserved by 056; no existing migration edited.
-- Ordinary tenant writes cannot create, modify, adopt or delete global rows.
-- Global reads and explicit privileged worker/support functions are retained.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['feature_flags','background_jobs','outbox_events'] LOOP
    EXECUTE format('DROP POLICY %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (organization_id=app_tenant_id()) WITH CHECK (organization_id=app_tenant_id())',
      t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (organization_id IS NULL OR organization_id=app_tenant_id())',
      t || '_read', t);
  END LOOP;
  -- 029 reintroduced the unsafe direct cast after 018 had fixed it.
  FOREACH t IN ARRAY ARRAY['privacy_violations','privacy_request_exports','privacy_dpias'] LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I USING (organization_id=app_tenant_id()) WITH CHECK (organization_id=app_tenant_id())',
      t || '_tenant', t);
  END LOOP;
END $$;

-- Serialize allocations for the same payment, even across different invoices.
-- Keep 023's invoice guard and trigger attachment; do not rewrite old allocations.
CREATE OR REPLACE FUNCTION guard_payment_allocation() RETURNS trigger AS $$
DECLARE v_payment numeric(10,2); v_invoice_total numeric(10,2); v_invoice_paid numeric(10,2);
BEGIN
 SELECT amount INTO v_payment FROM payments WHERE id=NEW.payment_id FOR UPDATE;
 SELECT total_amount, paid_amount INTO v_invoice_total, v_invoice_paid FROM invoices WHERE id=NEW.invoice_id FOR UPDATE;
 IF (SELECT COALESCE(SUM(amount_allocated),0) FROM payment_allocations WHERE payment_id=NEW.payment_id) + NEW.amount_allocated > v_payment THEN
   RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_PAYMENT' USING ERRCODE='P0001';
 END IF;
 IF v_invoice_paid + NEW.amount_allocated > v_invoice_total THEN
   RAISE EXCEPTION 'PAYMENT_ALLOCATION_EXCEEDS_INVOICE' USING ERRCODE='P0001';
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
