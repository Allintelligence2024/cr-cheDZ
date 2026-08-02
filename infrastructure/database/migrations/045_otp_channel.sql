-- ============================================================================
-- 045_otp_channel.sql
-- Roadmap v2 — OTP de connexion parent via WhatsApp (phase 19).
-- otp_codes est une table bootstrap SANS tenant (login pré-authentification,
-- migration 003) : pas de RLS. On y enregistre le CANAL DEMANDÉ ('sms' par
-- défaut, 'whatsapp' derrière le flag global whatsapp_otp) pour l'audit et
-- le support. Honnêteté : la livraison réelle n'est attestée que par
-- l'absence d'erreur fournisseur à l'envoi — jamais de statut "délivré"
-- stocké ici.
-- ============================================================================

ALTER TABLE otp_codes ADD COLUMN channel TEXT NOT NULL DEFAULT 'sms';

ALTER TABLE otp_codes ADD CONSTRAINT otp_codes_channel_check
  CHECK (channel IN ('sms', 'whatsapp'));

COMMENT ON COLUMN otp_codes.channel IS
  'Canal de livraison demandé (sms|whatsapp). La livraison réelle n''est attestée que par l''absence d''erreur du fournisseur lors de l''envoi.';

-- Accélère la vérification (dernier code actif par cible/objet) — le
-- SELECT de verify utilise target + purpose + used_at IS NULL.
CREATE INDEX IF NOT EXISTS idx_otp_codes_active
  ON otp_codes (target, purpose)
  WHERE used_at IS NULL;
