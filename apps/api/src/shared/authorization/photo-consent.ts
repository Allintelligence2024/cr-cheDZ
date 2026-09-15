import type { PoolClient } from 'pg';

/** Metadata read from a tenant-scoped media row, never a caller's consent assertion. */
export interface PhotoConsentMetadata {
  child_id: string | null;
  children_in_photo: Array<string | null> | null;
  all_consents_checked: boolean;
}

/** H2g: one consent perimeter for publication and new parent URL generation.
 * Keep the existing latest-photo_individual-per-child rule. The primary child
 * cannot be omitted to bypass consent; duplicate declarations count only once.
 * Missing declarations/unchecked legacy rows fail closed, without rewriting them.
 * Must run on the application's tenant-scoped connection (RLS).
 */
export async function photoConsentsAllowed(
  client: PoolClient, tenantId: string, media: PhotoConsentMetadata,
): Promise<boolean> {
  if (media.all_consents_checked !== true || !media.children_in_photo?.length) return false;
  if (media.children_in_photo.some(id => !id)) return false;
  const children = [...new Set([
    ...media.children_in_photo,
    ...(media.child_id ? [media.child_id] : []),
  ])];
  const result = await client.query(
    `WITH latest AS (
       SELECT DISTINCT ON (child_id) child_id, granted, revoked_at
       FROM consent_records
       WHERE organization_id=$2 AND child_id=ANY($1::uuid[]) AND consent_type='photo_individual'
       ORDER BY child_id, created_at DESC
     )
     SELECT c.id FROM children c JOIN latest l ON l.child_id=c.id
     WHERE c.organization_id=$2 AND c.id=ANY($1::uuid[]) AND c.deleted_at IS NULL
       AND l.granted=true AND l.revoked_at IS NULL`,
    [children, tenantId],
  );
  return result.rows.length === children.length;
}
