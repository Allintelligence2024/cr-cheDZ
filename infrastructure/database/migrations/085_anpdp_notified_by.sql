-- ============================================================================
-- 085_anpdp_notified_by.sql
-- P1 (remédiation 2026-10-04, phase 2.4) — notification ANPDP sans auteur.
--
-- privacy.service.ts::notifyAnpdp(violationId) ne recevait PAS l'identité de
-- l'acteur : le controller ne lui passe que l'id de violation. L'acte de
-- notifier l'ANPDP (délai légal de 5 jours, loi 25-11) n'a donc aucun auteur
-- identifié dans l'audit — la table privacy_violations n'a d'ailleurs aucune
-- colonne pour le porter.
--
-- Correction : colonne anpdp_notified_by (NULL tant que non notifié, puis
-- l'utilisateur qui a déclenché l'envoi). Index sur la date pour le job
-- worker de dépassement de délai (2.3).
-- ============================================================================

ALTER TABLE privacy_violations
  ADD COLUMN IF NOT EXISTS anpdp_notified_by UUID REFERENCES users(id);

-- Index pour le job worker de dépassement de délai (2.3) : violations
-- non-notifiées dont la deadline est dépassée.
CREATE INDEX IF NOT EXISTS idx_privacy_violations_deadline
  ON privacy_violations (organization_id, notification_deadline)
  WHERE anpdp_notified_at IS NULL;
