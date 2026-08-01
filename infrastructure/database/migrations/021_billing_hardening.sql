-- Phase 8 : unicité de génération mensuelle et index de consultation parent.
CREATE UNIQUE INDEX invoices_one_contract_period
  ON invoices (organization_id, contract_id, period_year, period_month)
  WHERE contract_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX invoices_parent_lookup ON invoices (organization_id, child_id, created_at DESC);
