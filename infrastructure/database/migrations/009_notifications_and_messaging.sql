-- ============================================================================
-- 009_notifications_and_messaging.sql
-- Préférences de notification, file d'envoi (worker), boîte de réception,
-- messagerie parent-crèche (conversations, participants, messages).
-- ============================================================================

CREATE TABLE notification_preferences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  channel notification_channel NOT NULL,
  event_type TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  UNIQUE(user_id, channel, event_type)
);

CREATE TABLE notification_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  device_id UUID REFERENCES devices(id),
  channel notification_channel NOT NULL,
  title_fr TEXT,
  title_ar TEXT,
  body_fr TEXT NOT NULL,
  body_ar TEXT,
  data JSONB, -- jamais de données médicales ou de photos ici
  status TEXT NOT NULL DEFAULT 'pending',
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE notification_inbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title_fr TEXT NOT NULL,
  title_ar TEXT,
  body_fr TEXT NOT NULL,
  body_ar TEXT,
  data JSONB,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  child_id UUID REFERENCES children(id),
  subject TEXT,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE conversation_participants (
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID NOT NULL REFERENCES users(id),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY(conversation_id, user_id)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  sender_id UUID NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  attachment_id UUID REFERENCES media_assets(id),
  is_system_message BOOLEAN NOT NULL DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- RLS ------------------------------------------------------------------------

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_prefs_tenant ON notification_preferences;
CREATE POLICY notif_prefs_tenant ON notification_preferences
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_queue FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_queue_tenant ON notification_queue;
CREATE POLICY notif_queue_tenant ON notification_queue
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE notification_inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_inbox FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notif_inbox_tenant ON notification_inbox;
CREATE POLICY notif_inbox_tenant ON notification_inbox
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_tenant ON conversations;
CREATE POLICY conversations_tenant ON conversations
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_participants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conv_participants_tenant ON conversation_participants;
CREATE POLICY conv_participants_tenant ON conversation_participants
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_tenant ON messages;
CREATE POLICY messages_tenant ON messages
  USING (organization_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.tenant_id', true)::uuid);

-- Index ----------------------------------------------------------------------

CREATE INDEX idx_notif_queue_pending ON notification_queue(status, scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_notif_inbox_user ON notification_inbox(user_id, created_at DESC);
CREATE INDEX idx_conversations_child ON conversations(organization_id, child_id);
CREATE INDEX idx_messages_conv ON messages(conversation_id, sent_at DESC);
