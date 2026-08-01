-- ============================================================================
-- 033_phase11_indexes.sql
-- Phase 11 — index manquants identifiés par revue des requêtes chaudes
-- (portail parent, facturation, caisse, file de notifications, fil du jour).
-- ============================================================================

-- Portail parent : JOIN guardians g ON g.user_id = $1 (enfants, factures,
-- reçus, santé) — aucun index sur guardians(user_id).
CREATE INDEX idx_guardians_user
  ON guardians (user_id)
  WHERE deleted_at IS NULL;

-- Fil du jour parent : tri par occurred_at après filtrage visibilité.
CREATE INDEX idx_daily_events_feed
  ON daily_log_events (child_id, event_date, visible_to_parents, occurred_at)
  WHERE visible_to_parents = true;

-- Inbox : WHERE user_id + organization_id ORDER BY created_at DESC.
CREATE INDEX idx_notif_inbox_user_org
  ON notification_inbox (user_id, organization_id, created_at DESC);

-- Contrats : listes par organisation (page Facturation, paramètres).
CREATE INDEX idx_contracts_org
  ON contracts (organization_id, is_active, created_at DESC);

-- Caisse : total des paiements espèces confirmés du jour par site
-- (JOIN children site_id + filtre method/status/confirmed_at).
CREATE INDEX idx_payments_cash_daily
  ON payments (organization_id, method, status, confirmed_at);

-- Trigger 023 : somme des allocations par payment_id à chaque INSERT.
CREATE INDEX idx_payment_alloc_payment
  ON payment_allocations (payment_id);

-- Dashboard : incidents 24 h par organisation (event_type, occurred_at).
CREATE INDEX idx_daily_events_incidents
  ON daily_log_events (organization_id, event_type, occurred_at DESC)
  WHERE event_type = 'incident';
