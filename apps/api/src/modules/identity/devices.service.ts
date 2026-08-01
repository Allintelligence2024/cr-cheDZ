import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';

export interface RegisterDeviceInput {
  name: string;
  deviceFingerprint: string;
  platform: string;
  appVersion?: string;
  fcmToken?: string;
}

/**
 * Appareils (table tenant sous RLS — opérations via le contexte tenant).
 * L'enregistrement nécessite d'être authentifié (tenant posé par le guard).
 */
@Injectable()
export class DevicesService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  async register(userId: string, input: RegisterDeviceInput): Promise<{ id: string }> {
    const tenantId = this.tenantContext.getTenantIdOrNull();
    if (!tenantId) throw Errors.forbidden();

    const result = await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `INSERT INTO devices
           (organization_id, name, device_fingerprint, platform, app_version, fcm_token, registered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [tenantId, input.name, input.deviceFingerprint, input.platform, input.appVersion ?? null, input.fcmToken ?? null, userId],
      );
      return res.rows[0] as { id: string };
    });

    await this.audit.log({
      organizationId: tenantId,
      userId,
      action: 'create',
      resourceType: 'device',
      resourceId: result.id,
      resourceLabel: input.name,
    });
    return result;
  }

  async list(userId: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = this.tenantContext.getTenantIdOrNull();
    if (!tenantId) throw Errors.forbidden();
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, name, platform, app_version, is_active, last_seen_at, created_at
         FROM devices
         WHERE registered_by = $1
         ORDER BY created_at DESC`,
        [userId],
      );
      return res.rows;
    });
  }

  /** Révocation distante : appareil + toutes ses sessions. */
  async revoke(deviceId: string, userId: string): Promise<void> {
    const tenantId = this.tenantContext.getTenantIdOrNull();
    if (!tenantId) throw Errors.forbidden();

    await this.tenantContext.withTenantConnection(async (client) => {
      // RLS : l'UPDATE ne touche que les appareils du tenant courant.
      const res = await client.query(
        `UPDATE devices
         SET is_active = false, revoked_at = NOW(), revoked_reason = 'manual'
         WHERE id = $1
         RETURNING id, name`,
        [deviceId],
      );
      if (res.rows.length === 0) {
        throw new AppError('NOT_FOUND', 'Appareil introuvable', 'الجهاز غير موجود', 404);
      }
      // Révoquer les sessions liées (table système — filtre org explicite).
      await client.query(
        `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'device_revoked'
         WHERE device_id = $1 AND organization_id = $2 AND revoked_at IS NULL`,
        [deviceId, tenantId],
      );
      return res.rows[0] as { id: string; name: string };
    });

    await this.audit.log({
      organizationId: tenantId,
      userId,
      action: 'revoke',
      resourceType: 'device',
      resourceId: deviceId,
    });
  }
}
