-- Phase 7 : connexion parent par OTP téléphone puis PIN local.
-- Le PIN est haché bcrypt et n'est jamais exposé ni journalisé.
ALTER TABLE users ADD COLUMN parent_pin_hash TEXT;
CREATE INDEX idx_otp_codes_active ON otp_codes(target, purpose, expires_at) WHERE used_at IS NULL;
