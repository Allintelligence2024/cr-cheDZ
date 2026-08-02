-- ============================================================================
-- Seed 014 — Feature flags par défaut (globaux, organization_id NULL).
-- Idempotent.
-- ============================================================================

INSERT INTO feature_flags (flag_key, is_enabled, description) VALUES
  ('online_payment',       false, 'Paiement CIB/Edahabia en ligne'),
  ('whatsapp_notifications', false, 'Relances et rappels WhatsApp'),
  ('whatsapp_otp',         false, 'OTP de connexion parent via WhatsApp'),
  ('video_surveillance',   false, 'Vidéosurveillance des locaux (DPIA approuvée exigée — loi 25-11)'),
  ('compliance_module',    false, 'Module conformité décret 19-253'),
  ('staff_planning',       false, 'Planning et présence personnel'),
  ('medication_module',    false, 'Gestion des médicaments'),
  ('multi_site',           false, 'Multi-établissements'),
  ('marketplace',          false, 'Marketplace public')
ON CONFLICT (flag_key, organization_id) DO NOTHING;
