import { Injectable } from '@nestjs/common';
import { assertStorageKeyInTenant } from '../../shared/authorization/storage-key';
export { assertStorageKeyInTenant } from '../../shared/authorization/storage-key';
import { photoConsentsAllowed } from '../../shared/authorization/photo-consent';
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
 * - C3 (audit 2026-09) : la clé de stockage DOIT être préfixée par le tenant
 *   courant — le client ne choisit pas le périmètre de ses objets.
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
    assertStorageKeyInTenant(dto.storage_key, tenantId);
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

      if (visible && !await photoConsentsAllowed(client, tenantId, m)) {
        throw new AppError(
          'CONSENT_REQUIRED',
          'Consentement photo requis pour tous les enfants concernés',
          'موافقة الصور مطلوبة لجميع الأطفال المعنيين',
          422,
        );
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

  /**
   * R10 (remédiation 2026-09-21, F7) : un staff (educator, etc.) ne doit
   * voir que les médias des enfants de SES salles (memberships.room_ids).
   * Sans cette garde, tout le personnel voit tous les médias du tenant —
   * ce qui viole le principe du moindre privilège. Les rôles director /
   * super_admin / accountant voient tout (pas de restriction d'aire) ; le
   * rôle educator voit restreint ; parent voit uniquement ce qui est marqué
   * `is_visible_to_parents=true` (déjà géré par le contrôleur parent).
   */
  async list(userId: string, childId?: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      // 1. Récupérer le rôle + room_ids de l'utilisateur pour ce tenant.
      const m = await client.query(
        `SELECT m.room_ids, r.slug AS role_slug
         FROM memberships m
         JOIN roles r ON r.id = m.role_id
         WHERE m.user_id = $1 AND m.organization_id = $2 AND m.is_active = true`,
        [userId, tenantId],
      );
      if (m.rows.length === 0) {
        // Pas de membership actif → 0 média (defense-in-depth ; le guard a
        // normalement déjà refusé).
        return [];
      }
      const { role_slug: roleSlug, room_ids: roomIds } = m.rows[0] as {
        role_slug: string;
        room_ids: string[] | null;
      };

      // 2. Rôles qui voient TOUT (direction + finance + ops plateforme).
      const SEES_ALL = new Set(['director', 'super_admin', 'accountant']);
      const params: unknown[] = [tenantId];
      let extraWhere = '';

      if (!SEES_ALL.has(roleSlug)) {
        // Staff « terrain » : filtrer par room_id des enfants via la table
        // children. memberships.room_ids peut être NULL (= aucune salle :
        // ne voit rien) ou vide. Si room_ids = NULL, l'utilisateur n'a
        // aucune aire → aucun média retourné.
        if (!roomIds || roomIds.length === 0) {
          return [];
        }
        params.push(roomIds);
        // children.room_id = ANY(memberships.room_ids) ; les photos peuvent
        // aussi concerner plusieurs enfants (children_in_photo[]) — on inclut
        // les médias dont child_id OU n'importe quel enfant de la photo
        // appartient à l'aire du staff. Cohorte côté SQL via EXISTS.
        extraWhere = `AND (
          child_id IN (SELECT id FROM children WHERE room_id = ANY($${params.length}::uuid[]))
          OR EXISTS (
            SELECT 1 FROM unnest(children_in_photo) AS child_id_in_photo
            WHERE child_id_in_photo IN (SELECT id FROM children WHERE room_id = ANY($${params.length}::uuid[]))
          )
        )`;
      }

      if (childId) {
        params.push(childId);
        extraWhere += ` AND child_id = $${params.length}`;
      }

      const res = await client.query(
        `SELECT id, child_id, media_type, mime_type, original_filename,
                file_size_bytes, taken_at, is_visible_to_parents,
                all_consents_checked, children_in_photo, created_at
         FROM media_assets
         WHERE organization_id = $1 AND deleted_at IS NULL ${extraWhere}
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
    // C3 (audit 2026-09) : même garde que register() — la voie sync (offline)
    // ne doit pas pouvoir écrire hors du périmètre du tenant.
    assertStorageKeyInTenant(input.storageKey, tenantId);
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
