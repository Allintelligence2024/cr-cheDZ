-- ============================================================================
-- 019_parent_portal.sql
-- Phase 7 : index d'accès du portail parent. Les liens enfant/responsable
-- restent la source d'autorité ; aucun accès n'est accordé par le rôle seul.
-- ============================================================================

CREATE INDEX idx_child_guardians_parent_access
  ON child_guardians (organization_id, guardian_id, child_id)
  WHERE can_view_journal = true;

-- Les préférences sont déjà une ressource tenant (migration 009). Cet index
-- sert le portail sans modifier les migrations immuables antérieures.
CREATE INDEX idx_notification_preferences_user_event
  ON notification_preferences (organization_id, user_id, event_type);
