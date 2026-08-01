import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { PresignUploadDto, RegisterMediaDto } from './dto/media.dto';
import { StorageService } from './storage.service';

/**
 * Médias (photos, documents) — objets en S3/MinIO, références en base.
 * Règles :
 * - is_visible_to_parents=true IMPOSSIBLE sans consentement photo valide
 *   pour CHAQUE enfant présent (children_in_photo) + all_consents_checked.
 * - Chaque téléchargement est journalisé (media_access_logs, loi 25-11).
 */
@Injectable()
export class MediaService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  // ── Étape 1 : URL signée d'upload ────────────────────────────────────────

  async presignUpload(userId: string, dto: PresignUploadDto): Promise<{ upload_url: string; storage_key: string }> {
    const tenantId = requireTenant(this.tenantContext);
    const mediaType = dto.mime_type === 'application/pdf' ? 'document' : 'photo';
    const storageKey = this.storage.storageKey(tenantId, mediaType, dto.filename);
    const { url } = await this.storage.presignPut(storageKey, dto.mime_type);
    await this.audit.log({
      organizationId: tenantId,
      userId,
      action: 'create',
      resourceType: 'media_presign',
      newValues: { storage_key: storageKey, media_type: mediaType },
    });
    return { upload_url: url, storage_key: storageKey };
  }

  // ── Étape 2 : enregistrement de l'asset après upload direct ──────────────

  async register(userId: string, dto: RegisterMediaDto): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      if (dto.child_id) await this.childOfTenant(client, dto.child_id);
      if (dto.children_in_photo?.length) {
        for (const cid of dto.children_in_photo) {
          await this.childOfTenant(client, cid);
        }
      }
      const mediaType = dto.mime_type === 'application/pdf' ? 'document' : 'photo';
      const res = await client.query(
        `INSERT INTO media_assets
           (organization_id, child_id, log_event_id, uploaded_by, media_type,
            storage_key, original_filename, mime_type, file_size_bytes,
            taken_at, exif_stripped, checksum,
            children_in_photo, all_consents_checked, is_visible_to_parents)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[],
                 COALESCE($14, false), false)
         RETURNING id, storage_key, media_type, is_visible_to_parents, created_at`,
        [
          tenantId, dto.child_id ?? null, dto.log_event_id ?? null, userId, mediaType,
          dto.storage_key, dto.original_filename ?? null, dto.mime_type, dto.file_size_bytes ?? null,
          dto.taken_at ?? null, dto.exif_stripped ?? false, dto.checksum ?? null,
          dto.children_in_photo ?? null,
          dto.children_in_photo != null && dto.children_in_photo.length > 0,
        ],
      );
      const media = res.rows[0];

      // Changelog → le mobile sait que la photo est enregistrée.
      await client.query(
        `INSERT INTO sync_changelog
           (organization_id, aggregate_type, aggregate_id, event_type, payload)
         VALUES ($1, 'media', $2, 'media_registered', $3)`,
        [
          tenantId, media.id,
          JSON.stringify({ media_id: media.id, child_id: dto.child_id ?? null, media_type: mediaType }),
        ],
      );

      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'create',
        resourceType: 'media',
        resourceId: media.id,
        newValues: { storage_key: media.storage_key, media_type: media.media_type },
      });
      return media;
    });
  }

  // ── Visibilité parent (consentement) ─────────────────────────────────────

  async setVisibility(userId: string, mediaId: string, visible: boolean): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const media = await client.query(
        `SELECT id, child_id, children_in_photo, all_consents_checked, is_visible_to_parents
         FROM media_assets WHERE id = $1 AND deleted_at IS NULL`,
        [mediaId],
      );
      if (media.rows.length === 0) throw Errors.notFound();
      const m = media.rows[0];

      if (visible && !m.all_consents_checked) {
        throw new AppError(
          'CONSENT_REQUIRED',
          'Consentement photo requis avant la visibilité aux parents',
          'موافقة الصور مطلوبة قبل العرض للوالدين',
          422,
        );
      }
      if (visible && m.children_in_photo?.length) {
        // Chaque enfant présent sur la photo doit avoir un consentement
        // photo_individual actif — seul le DERNIER consentement compte
        // (append-only) : une révocation rend la publication impossible.
        const consents = await client.query(
          `WITH latest AS (
             SELECT DISTINCT ON (child_id) child_id, granted, revoked_at
             FROM consent_records
             WHERE child_id = ANY($1::uuid[]) AND consent_type = 'photo_individual'
             ORDER BY child_id, created_at DESC
           )
           SELECT child_id FROM latest WHERE granted = true AND revoked_at IS NULL`,
          [m.children_in_photo],
        );
        const consented = new Set(consents.rows.map((r: { child_id: string }) => r.child_id));
        const missing = (m.children_in_photo as string[]).filter((cid) => !consented.has(cid));
        if (missing.length > 0) {
          throw new AppError(
            'CONSENT_REQUIRED',
            'Consentement manquant pour un ou plusieurs enfants de la photo',
            'موافقة مفقودة لطفل أو أكثر في الصورة',
            422,
          );
        }
      }

      const res = await client.query(
        `UPDATE media_assets
         SET is_visible_to_parents = $2, visible_at = CASE WHEN $2 THEN NOW() ELSE NULL END
         WHERE id = $1
         RETURNING id, is_visible_to_parents, visible_at`,
        [mediaId, visible],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: visible ? 'approve' : 'update',
        resourceType: 'media',
        resourceId: mediaId,
        newValues: { is_visible_to_parents: visible },
      });
      return res.rows[0];
    });
  }

  // ── Liste / téléchargement ───────────────────────────────────────────────

  async list(_userId: string, childId?: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const params: unknown[] = [tenantId];
      let childClause = '';
      if (childId) {
        params.push(childId);
        childClause = `AND child_id = $${params.length}`;
      }
      const res = await client.query(
        `SELECT id, child_id, media_type, mime_type, original_filename,
                file_size_bytes, taken_at, is_visible_to_parents,
                all_consents_checked, children_in_photo, created_at
         FROM media_assets
         WHERE organization_id = $1 AND deleted_at IS NULL ${childClause}
         ORDER BY created_at DESC`,
        params,
      );
      return res.rows;
    });
  }

  /** Téléchargement : URL signée + journalisation d'accès (loi 25-11). */
  async downloadUrl(userId: string, mediaId: string, ipAddress?: string): Promise<{ url: string; key: string }> {
    const tenantId = requireTenant(this.tenantContext);
    const media = await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, storage_key, child_id FROM media_assets WHERE id = $1 AND deleted_at IS NULL`,
        [mediaId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      return res.rows[0];
    });
    const url = await this.storage.presignGet(media.storage_key);
    // Journal d'accès médias dédié (loi 25-11).
    await this.tenantContext.withTenantConnection(async (client) => {
      await client.query(
        `INSERT INTO media_access_logs (media_id, organization_id, accessed_by, access_type, ip_address)
         VALUES ($1, $2, $3, 'view', $4)`,
        [mediaId, tenantId, userId, ipAddress ?? null],
      );
    });
    await this.audit.logDataAccess({
      organizationId: tenantId,
      userId,
      dataType: 'media',
      dataSubjectId: media.child_id ?? media.id,
      dataSubjectType: media.child_id ? 'child' : 'media',
      accessType: 'view',
      justification: 'consultation_media',
      ipAddress: ipAddress ?? null,
    });
    return { url, key: media.storage_key };
  }

  // ── Sync : commande add_photo (offline) ──────────────────────────────────

  /** Enregistre une photo poussée par le mobile (jamais visible sans consentement). */
  async registerFromSync(
    client: PoolClient,
    tenantId: string,
    input: {
      childId: string;
      userId: string;
      deviceId?: string | null;
      syncEventId?: string | null;
      storageKey: string;
      mimeType: string;
      takenAt?: string;
      checksum?: string;
      childrenInPhoto?: string[];
    },
  ): Promise<Record<string, unknown>> {
    if (input.childrenInPhoto?.length) {
      for (const cid of input.childrenInPhoto) {
        await this.childOfTenant(client, cid);
      }
    }
    const res = await client.query(
      `INSERT INTO media_assets
         (organization_id, child_id, uploaded_by, media_type, storage_key,
          mime_type, taken_at, checksum, children_in_photo,
          all_consents_checked, is_visible_to_parents, exif_stripped)
       VALUES ($1,$2,$3,'photo',$4,$5,$6,$7,$8::uuid[],
               $9, false, true)
       RETURNING id`,
      [
        tenantId, input.childId, input.userId, input.storageKey, input.mimeType,
        input.takenAt ?? null, input.checksum ?? null, input.childrenInPhoto ?? null,
        input.childrenInPhoto != null && input.childrenInPhoto.length > 0,
      ],
    );
    const media = res.rows[0];
    await client.query(
      `INSERT INTO sync_changelog
         (organization_id, aggregate_type, aggregate_id, event_type, payload, origin_device_id)
       VALUES ($1, 'media', $2, 'media_registered', $3, $4)`,
      [
        tenantId, media.id,
        JSON.stringify({ media_id: media.id, child_id: input.childId, media_type: 'photo' }),
        input.deviceId ?? null,
      ],
    );
    return media;
  }

  private async childOfTenant(client: PoolClient, childId: string): Promise<void> {
    const res = await client.query(
      `SELECT id FROM children WHERE id = $1 AND deleted_at IS NULL`,
      [childId],
    );
    if (res.rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Enfant introuvable dans cette organisation', 'الطفل غير موجود', 404);
    }
  }
}
