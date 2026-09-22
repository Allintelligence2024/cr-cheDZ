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
  ('marketplace',          false, 'Marketplace public'),
  -- R16 (remédiation 2026-09-21, F14) : sync_generated_v1 contrôle si
  -- staff-mobile utilise le client généré (apps/staff-mobile/lib/core/
  -- network/generated/sync_wire_client.dart, validé par F1 — gate F4
  -- encore ouvert : certaines opérations avancées peuvent diverger du
  -- contrat). FALSE par défaut : le mobile utilise l'ancien client
  -- (sync_client.dart) qui a fait ses preuves. Activer par tenant
  -- uniquement après audit explicite + décision plateforme.
  ('sync_generated_v1',    false, 'R16 — staff-mobile utilise le client sync généré v1 (gate F4 ouvert)'),
  -- R16 (remédiation 2026-09-21, F14) : whatsapp_otp_v2 — flag technique
  -- prévu pour le canal OTP WhatsApp via Meta Cloud API v2 (encore en
  -- test côté Meta ; false tant que non homologué).
  ('whatsapp_otp_v2',      false, 'R16 — OTP WhatsApp via Meta Cloud API v2 (homologation Meta en cours)')
ON CONFLICT (flag_key, organization_id) DO NOTHING;
