/** H2b: one SQL predicate for producer, worker and inbox. SECURITY INVOKER semantics:
 * callers MUST supply a transaction with SET LOCAL app.tenant_id. No admin pool.
 * SQL fragments below are code constants, never supplied by an HTTP caller.
 */
const journalTypes = ['meal', 'nap_end', 'incident'] as const;
export const JOURNAL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set(journalTypes);
const journalSql = journalTypes.map(type => `'${type}'`).join(',');
const childTypesSql = `'check_in','check_out',${journalSql}`;
export const NOTIFICATION_DENIED_REASON = 'NOTIFICATION_ACCESS_REVOKED_OR_UNVERIFIABLE';

/** notification_context has organization_id, user_id, data, event_type (inbox hint), channel. */
export const NOTIFICATION_ALLOWED_SQL = `
  COALESCE(jsonb_typeof(notification_context.data), 'null') IN ('object','null')
  AND EXISTS (
    SELECT 1 FROM users notification_user
    JOIN memberships notification_member ON notification_member.user_id=notification_user.id
    WHERE notification_user.id=notification_context.user_id AND notification_user.status='active'
      AND notification_member.organization_id=notification_context.organization_id
      AND notification_member.is_active=true
  )
  AND (
    -- Legacy non-child push/inbox messages retain their existing behavior.
    -- All shipped WhatsApp queue producers are child events; unscoped legacy WhatsApp is refused.
    (notification_context.channel <> 'whatsapp'
      AND NOT COALESCE(notification_context.data ?| ARRAY['scope','child_id','log_event_id'], false)
      AND COALESCE(notification_context.data->>'event_type','') NOT IN (${childTypesSql})
      AND COALESCE(notification_context.event_type,'') NOT IN (${childTypesSql}))
    OR (
      COALESCE(notification_context.data->>'scope','child_event')='child_event'
      AND notification_context.data->>'event_type' IN (${childTypesSql})
      AND (notification_context.event_type IS NULL OR notification_context.event_type=notification_context.data->>'event_type')
      AND EXISTS (
        SELECT 1 FROM child_guardians notification_link
        JOIN guardians notification_guardian ON notification_guardian.id=notification_link.guardian_id
        JOIN children notification_child ON notification_child.id=notification_link.child_id
        WHERE notification_link.organization_id=notification_context.organization_id
          AND notification_guardian.organization_id=notification_context.organization_id
          AND notification_child.organization_id=notification_context.organization_id
          AND notification_guardian.user_id=notification_context.user_id
          AND notification_guardian.deleted_at IS NULL AND notification_child.deleted_at IS NULL
          AND notification_child.id::text=lower(notification_context.data->>'child_id')
          AND notification_link.can_receive_push=true
          AND (
            (notification_context.data->>'event_type' IN (${journalSql})
              AND notification_link.can_view_journal=true
              AND EXISTS (SELECT 1 FROM daily_log_events notification_event
                WHERE notification_event.organization_id=notification_context.organization_id
                  AND notification_event.child_id=notification_child.id
                  AND notification_event.id::text=lower(notification_context.data->>'log_event_id')
                  AND notification_event.event_type::text=notification_context.data->>'event_type'
                  AND notification_event.visible_to_parents=true AND notification_event.note_is_private IS NOT TRUE))
            OR (notification_context.data->>'event_type' IN ('check_in','check_out')
              AND EXISTS (SELECT 1 FROM attendance_sessions notification_session
                JOIN attendance_events notification_attendance ON notification_attendance.session_id=notification_session.id
                WHERE notification_session.organization_id=notification_context.organization_id
                  AND notification_attendance.organization_id=notification_context.organization_id
                  AND notification_session.child_id=notification_child.id
                  AND notification_attendance.child_id=notification_child.id
                  AND notification_session.id::text=lower(notification_context.data->>'log_event_id')
                  AND notification_attendance.event_type::text=notification_context.data->>'event_type'))
          )
          AND (notification_context.channel <> 'whatsapp' OR (
            notification_guardian.phone_primary=notification_context.data->>'to'
            AND COALESCE(
              (SELECT bool_and(is_enabled) FROM feature_flags WHERE organization_id=notification_context.organization_id AND flag_key='whatsapp_notifications'),
              (SELECT bool_and(is_enabled) FROM feature_flags WHERE organization_id IS NULL AND flag_key='whatsapp_notifications'), false)
          ))
      )
      AND (notification_context.channel='inbox' OR NOT EXISTS (
        SELECT 1 FROM notification_preferences notification_preference
        WHERE notification_preference.organization_id=notification_context.organization_id
          AND notification_preference.user_id=notification_context.user_id
          AND notification_preference.channel::text=notification_context.channel
          AND notification_preference.event_type=notification_context.data->>'event_type'
          AND notification_preference.is_enabled=false
      ))
    )
  )`;

/** Correlated predicate for a notification_inbox row aliased n, before LIMIT or UPDATE. */
export const NOTIFICATION_INBOX_ALLOWED_SQL = `EXISTS (
  SELECT 1 FROM (SELECT n.organization_id, n.user_id, n.data, n.type AS event_type, 'inbox'::text AS channel) notification_context
  WHERE ${NOTIFICATION_ALLOWED_SQL}
)`;

interface NotificationConnection {
  query(sql: string, values: unknown[]): Promise<{ rows: Array<{ allowed: boolean }> }>;
}
export async function notificationAllowed(
  client: NotificationConnection, organizationId: string, userId: string, data: unknown, channel: string,
): Promise<boolean> {
  const result = await client.query(
    `SELECT (${NOTIFICATION_ALLOWED_SQL}) AS allowed FROM
      (SELECT $1::uuid AS organization_id, $2::uuid AS user_id, $3::jsonb AS data,
        NULL::text AS event_type, $4::text AS channel) notification_context`,
    [organizationId, userId, JSON.stringify(data), channel],
  );
  return result.rows[0]?.allowed === true;
}
