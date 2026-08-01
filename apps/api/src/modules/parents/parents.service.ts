import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AttendanceService } from '../attendance/attendance.service';
import { MediaService } from '../media/media.service';

/** Portail parent. Le contrôle est toujours child_guardians, jamais le rôle JWT. */
@Injectable()
export class ParentsService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly attendance: AttendanceService,
    private readonly media: MediaService,
  ) {}

  async children(userId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT c.id, c.reference_number, c.first_name_fr, c.last_name_fr, c.date_of_birth,
              cg.can_view_journal, cg.can_view_health, cg.can_receive_push
       FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
       JOIN children c ON c.id = cg.child_id
       WHERE g.user_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.first_name_fr, c.last_name_fr`, [userId],
    )).rows);
  }

  async feed(userId: string, childId: string): Promise<Array<Record<string, unknown>>> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT id, event_type, occurred_at, meal_type, meal_quantity, nap_start_at, nap_end_at,
              nap_quality, diaper_type, activity_name, activity_notes, incident_severity,
              incident_description, visible_to_parents
       FROM daily_log_events WHERE child_id = $1 AND visible_to_parents = true
         AND (note_is_private = false OR note_is_private IS NULL)
       ORDER BY occurred_at DESC LIMIT 100`, [childId],
    )).rows);
  }

  async reportAbsence(userId: string, childId: string, reason?: string): Promise<Record<string, unknown>> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    return this.attendance.markAbsent(userId, { child_id: childId, reason });
  }

  async consents(userId: string, childId: string): Promise<Array<Record<string, unknown>>> {
    await this.assertLinked(userId, childId);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT cr.id, cr.child_id, cr.consent_type, cr.granted, cr.granted_at, cr.revoked_at
       FROM consent_records cr JOIN guardians g ON g.id = cr.guardian_id
       WHERE cr.child_id = $1 AND g.user_id = $2 ORDER BY cr.created_at DESC`, [childId, userId],
    )).rows);
  }

  async saveConsent(userId: string, dto: { child_id: string; consent_type: string; granted: boolean }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const guardian = await client.query(
        `SELECT cg.guardian_id FROM child_guardians cg JOIN guardians g ON g.id = cg.guardian_id
         WHERE cg.child_id = $1 AND g.user_id = $2`, [dto.child_id, userId],
      );
      if (!guardian.rows[0]) throw Errors.notFound();
      const row = await client.query(
        `INSERT INTO consent_records (organization_id, guardian_id, child_id, consent_type, granted, granted_at, revoked_at, collection_method)
         VALUES ($1,$2,$3,$4,$5,CASE WHEN $5 THEN NOW() ELSE NULL END,CASE WHEN $5 THEN NULL ELSE NOW() END,'parent_portal')
         RETURNING id, child_id, consent_type, granted, granted_at, revoked_at`,
        [tenantId, guardian.rows[0].guardian_id, dto.child_id, dto.consent_type, dto.granted],
      );
      return row.rows[0];
    });
  }

  async preferences(userId: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT event_type, is_enabled, quiet_hours_start, quiet_hours_end
       FROM notification_preferences WHERE organization_id = $1 AND user_id = $2 AND channel = 'push'`,
      [tenantId, userId],
    )).rows);
  }

  async savePreference(userId: string, dto: { event_type: string; is_enabled: boolean; quiet_hours_start?: string; quiet_hours_end?: string }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `INSERT INTO notification_preferences (organization_id,user_id,channel,event_type,is_enabled,quiet_hours_start,quiet_hours_end)
       VALUES ($1,$2,'push',$3,$4,$5,$6)
       ON CONFLICT (user_id,channel,event_type) DO UPDATE SET is_enabled=EXCLUDED.is_enabled,
         quiet_hours_start=EXCLUDED.quiet_hours_start, quiet_hours_end=EXCLUDED.quiet_hours_end
       RETURNING event_type,is_enabled,quiet_hours_start,quiet_hours_end`,
      [tenantId, userId, dto.event_type, dto.is_enabled, dto.quiet_hours_start ?? null, dto.quiet_hours_end ?? null],
    )).rows[0]);
  }

  async photos(userId: string, childId: string, ip?: string): Promise<Array<Record<string, unknown>>> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    const items = await this.media.list(userId, childId);
    const visible = items.filter((item) => item.is_visible_to_parents === true);
    const result: Array<Record<string, unknown>> = [];
    for (const item of visible) {
      try {
        result.push({ ...item, ...(await this.photoUrl(userId, childId, String(item.id), ip)) });
      } catch (error) {
        // Une révocation entre la liste et la signature ne divulgue jamais l'URL.
        if (!(error instanceof AppError) || error.code !== 'CONSENT_REVOKED') throw error;
      }
    }
    return result;
  }

  async photoUrl(userId: string, childId: string, mediaId: string, ip?: string): Promise<{ url: string; key: string }> {
    await this.assertPermission(userId, childId, 'can_view_journal');
    await this.tenantContext.withTenantConnection(async (client) => {
      // La révocation est effective immédiatement : une ancienne photo déjà
      // publiée ne peut plus obtenir d'URL si l'un des consentements manque.
      const r = await client.query(
        `SELECT children_in_photo FROM media_assets
         WHERE id=$1 AND child_id=$2 AND is_visible_to_parents=true AND deleted_at IS NULL`,
        [mediaId, childId],
      );
      if (!r.rows[0]) throw Errors.notFound();
      const children = (r.rows[0].children_in_photo as string[] | null) ?? [childId];
      const valid = await client.query(
        `SELECT DISTINCT child_id FROM consent_records
         WHERE child_id = ANY($1::uuid[]) AND consent_type='photo_individual'
           AND granted=true AND revoked_at IS NULL`, [children],
      );
      if (valid.rows.length !== children.length) {
        throw new AppError('CONSENT_REVOKED', 'Le consentement photo a été retiré', 'تم سحب الموافقة على الصورة', 422);
      }
    });
    return this.media.downloadUrl(userId, mediaId, ip);
  }

  private async assertLinked(userId: string, childId: string): Promise<void> { await this.assertPermission(userId, childId, 'guardian_id'); }
  private async assertPermission(userId: string, childId: string, permission: string): Promise<void> {
    requireTenant(this.tenantContext);
    const allowed = await this.tenantContext.withTenantConnection(async (client) => {
      const column = permission === 'guardian_id' ? 'cg.guardian_id' : `cg.${permission}`;
      const res = await client.query(
        `SELECT 1 FROM child_guardians cg JOIN guardians g ON g.id=cg.guardian_id
         WHERE cg.child_id=$1 AND g.user_id=$2 AND ${column}${permission === 'guardian_id' ? ' IS NOT NULL' : ' = true'}`,
        [childId, userId],
      );
      return Boolean(res.rows[0]);
    });
    if (!allowed) throw new AppError('PARENT_ACCESS_DENIED', 'Vous n’avez pas l’autorisation pour cet enfant', 'ليس لديك صلاحية لهذا الطفل', 403);
  }
}
