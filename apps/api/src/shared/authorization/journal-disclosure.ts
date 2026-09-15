/** H2e — common parent-facing journal visibility (feed and rights export).
 * Fixed SQL, never caller-supplied: query $1 is childId, $2 is the current health
 * capability (not a role or HTTP input). Callers must enforce journal access and
 * tenant RLS separately. Health values still require their explicit projection.
 * Both supported medical event types are sensitive, including their metadata
 * and side fields accepted by the journal DTO. New types require review/tests.
 */
export const PARENT_JOURNAL_VISIBILITY_SQL = `
  visible_to_parents = true
  AND note_is_private IS NOT TRUE
  AND ($2::boolean OR event_type NOT IN ('temperature', 'health_observation'))`;
