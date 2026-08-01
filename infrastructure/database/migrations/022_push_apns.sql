-- Phase 7 : jeton APNs natif, distinct du jeton FCM.
ALTER TABLE devices ADD COLUMN apns_token TEXT;
CREATE INDEX idx_devices_apns_active ON devices (organization_id, registered_by) WHERE apns_token IS NOT NULL AND is_active = true;
