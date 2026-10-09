-- ============================================================================
-- 086_deadline_key_unique.sql
-- P1 (remédiation 2026-10-04, phase 2.3) — idempotence de compliance_deadlines.
--
-- Le job worker compliance_deadlines enfile une notification au DPO pour
-- chaque échéance réglementaire dépassée (5 j ANPDP / 30 j droits / 365 j
-- DPIA, loi 25-11). L'idempotence repose sur ON CONFLICT DO NOTHING, qui
-- n'a d'effet QUE sur une contrainte unique — sans elle, une exécution
-- quotidienne spammerait le DPO.
--
-- Note : data->>'deadline_key' est une expression IMMUTABLE (jsonb ->> text
-- est immutable) → éligible pour un index unique partiel. On exclut les
-- notifications sans deadline_key (toutes les autres notifications).
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_deadline_key
  ON notification_queue (organization_id, (data->>'deadline_key'))
  WHERE data ? 'deadline_key';
