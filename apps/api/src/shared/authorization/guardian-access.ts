/** H2c: current portal link, for queries joining child_guardians cg and guardians g.
 * Execute with the application's tenant-scoped connection (RLS), never an admin pool.
 * This constant contains no caller-supplied SQL. Capability checks remain explicit
 * at each call site: journal, health and invoices are not interchangeable.
 */
export const CURRENT_GUARDIAN_LINK_SQL = `
  g.organization_id = cg.organization_id
  AND g.deleted_at IS NULL
  AND EXISTS (
    SELECT 1 FROM children guardian_child
    WHERE guardian_child.id = cg.child_id
      AND guardian_child.organization_id = cg.organization_id
      AND guardian_child.deleted_at IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM users guardian_user
    JOIN memberships guardian_member ON guardian_member.user_id = guardian_user.id
    WHERE guardian_user.id = g.user_id AND guardian_user.status = 'active'
      AND guardian_member.organization_id = cg.organization_id
      AND guardian_member.is_active = true
  )`;
