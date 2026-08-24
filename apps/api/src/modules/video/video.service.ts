import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { StorageService } from '../media/storage.service';
import { CreateCameraDto, ListClipsQuery, PresignClipDto, RegisterClipDto, UpdateCameraDto, VIDEO_ZONES } from './dto/video.dto';

/**
 * Vidéosurveillance (roadmap v2 — post-DPIA, loi 25-11).
 *
 * Verrous d'honnêteté et de conformité (cf. docs/regulatory/
 * DPIA-VIDEOSURVEILLANCE.md) :
 * - chaque opération exige le flag `video_surveillance` ACTIVÉ POUR L'ORG
 *   (le support ne peut l'activer qu'après DPIA approuvée — migration 046) ;
 * - zones de caméras limitées (liste blanche + CHECK base) : jamais de zone
 *   intime (sanitaires, change, sieste, infirmerie) ;
 * - visionnage journalisé (audit_logs, action 'view') à CHAQUE téléchargement
 *   ou flux ;
 * - purge à 30 jours assurée par le worker (job video_clips_purge) — pas de
   * suppression manuelle dans cette version (traçabilité).
 * - PAS de flux en direct : seuls des extraits exportés du DVR/NVR local sont
 *   gérés (upload signé S3/MinIO ou backend local explicite).
 */
@Injectable()
export class VideoService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  // ── Verrou de conformité : flag org actif exigé ───────────────────────────

  /** 422 VIDEO_FEATURE_DISABLED si le flag org video_surveillance est inactif. */
  private async assertVideoEnabled(): Promise<string> {
    const tenantId = requireTenant(this.tenantContext);
    const enabled = await this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `SELECT is_enabled FROM feature_flags
         WHERE flag_key='video_surveillance' AND organization_id=$1
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId],
      );
      return Boolean(r.rows[0]?.is_enabled);
    });
    if (!enabled) {
      throw new AppError(
        'VIDEO_FEATURE_DISABLED',
        'La vidéosurveillance n’est pas activée pour cet établissement (DPIA approuvée requise — loi 25-11)',
        'المراقبة بالفيديو غير مفعّلة لهذه المؤسسة (يلزم تقييم أثر معتمد — القانون 25-11)',
        422,
      );
    }
    return tenantId;
  }

  /** Zone interdite → 422 propre (le CHECK base reste la défense en profondeur). */
  private assertZoneAllowed(zone: string): void {
    if (!(VIDEO_ZONES as readonly string[]).includes(zone)) {
      throw new AppError(
        'ZONE_FORBIDDEN',
        'Cette zone ne peut pas être filmée (zones autorisées : entrée, couloir, espace commun, cour)',
        'لا يمكن تصوير هذه المنطقة (المناطق المسموح بها: المدخل، الرواق، الفضاء المشترك، الساحة)',
        422,
      );
    }
  }

  // ── Caméras ───────────────────────────────────────────────────────────────

  async createCamera(userId: string, dto: CreateCameraDto): Promise<Record<string, unknown>> {
    const tenantId = await this.assertVideoEnabled();
    this.assertZoneAllowed(dto.zone);
    return this.tenantContext.withTenantConnection(async (client) => {
      const dup = await client.query(
        `SELECT 1 FROM video_cameras WHERE organization_id=$1 AND name=$2`,
        [tenantId, dto.name],
      );
      if (dup.rows[0]) {
        throw new AppError(
          'CAMERA_NAME_TAKEN',
          'Une caméra porte déjà ce nom',
          'توجد كاميرا بهذا الاسم مسبقاً',
          409,
        );
      }
      const r = await client.query(
        `INSERT INTO video_cameras (organization_id, name, zone, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id, name, zone, is_active, created_at`,
        [tenantId, dto.name, dto.zone, userId],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'create',
        resourceType: 'video_camera',
        resourceId: r.rows[0].id,
        newValues: { name: dto.name, zone: dto.zone },
      });
      return r.rows[0];
    });
  }

  async listCameras(): Promise<Array<Record<string, unknown>>> {
    const tenantId = await this.assertVideoEnabled();
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT c.id, c.name, c.zone, c.is_active, c.created_at,
              (SELECT COUNT(*)::int FROM video_clips v WHERE v.camera_id = c.id) AS clips_count
       FROM video_cameras c WHERE c.organization_id=$1 ORDER BY c.name`, [tenantId],
    )).rows);
  }

  async updateCamera(cameraId: string, userId: string, dto: UpdateCameraDto): Promise<Record<string, unknown>> {
    const tenantId = await this.assertVideoEnabled();
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(
        `SELECT id FROM video_cameras WHERE id=$1 AND organization_id=$2`,
        [cameraId, tenantId],
      )).rows[0];
      if (!existing) throw Errors.notFound();
      const r = await client.query(
        `UPDATE video_cameras
         SET name = COALESCE($3, name),
             is_active = COALESCE($4, is_active),
             updated_at = NOW()
         WHERE id=$1 AND organization_id=$2
         RETURNING id, name, zone, is_active, updated_at`,
        [cameraId, tenantId, dto.name ?? null, dto.is_active ?? null],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'update',
        resourceType: 'video_camera',
        resourceId: cameraId,
        newValues: { name: dto.name ?? undefined, is_active: dto.is_active ?? undefined },
      });
      return r.rows[0];
    });
  }

  // ── Clips ─────────────────────────────────────────────────────────────────

  /** Caméra du tenant (404 cross-tenant via RLS) — utilisé par les 2 flux clips. */
  private async cameraOfTenant(cameraId: string): Promise<void> {
    const tenantId = requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `SELECT id FROM video_cameras WHERE id=$1 AND organization_id=$2`,
        [cameraId, tenantId],
      );
      if (!r.rows[0]) throw Errors.notFound();
    });
  }

  /** URL signée S3 d'upload (signature calculée localement — comme les photos). */
  async presignClipUpload(userId: string, dto: PresignClipDto): Promise<{ upload_url: string; storage_key: string }> {
    const tenantId = await this.assertVideoEnabled();
    await this.cameraOfTenant(dto.camera_id);
    const key = `${tenantId}/video/${dto.camera_id}/${Date.now()}-${dto.filename}`;
    const { url } = await this.storage.presignPut(key, dto.mime_type);
    await this.audit.log({
      organizationId: tenantId,
      userId,
      action: 'create',
      resourceType: 'video_clip_presign',
      newValues: { camera_id: dto.camera_id, storage_key: key },
    });
    return { upload_url: url, storage_key: key };
  }

  async registerClip(userId: string, dto: RegisterClipDto): Promise<Record<string, unknown>> {
    const tenantId = await this.assertVideoEnabled();
    await this.cameraOfTenant(dto.camera_id);
    // Politique serveur AVANT toute insertion (audit) : la clé est validée
    // ici (préfixe tenant + pas de ..) et le backend est dérivé du serveur —
    // le champ DTO storage_backend est ignoré (déprécié).
    this.assertStorageKeyPolicy(tenantId, dto.storage_key);
    const backend = this.resolveStorageBackend();
    return this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `INSERT INTO video_clips
           (organization_id, camera_id, captured_at, storage_backend, storage_key,
            mime_type, size_bytes, duration_seconds, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING id, camera_id, captured_at, storage_backend, storage_key,
                   size_bytes, duration_seconds, uploaded_at`,
        [tenantId, dto.camera_id, dto.captured_at, backend, dto.storage_key,
         dto.mime_type ?? 'video/mp4', dto.size_bytes ?? null, dto.duration_seconds ?? null, userId],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId,
        action: 'create',
        resourceType: 'video_clip',
        resourceId: r.rows[0].id,
        newValues: {
          camera_id: dto.camera_id,
          storage_backend: backend,
          captured_at: dto.captured_at,
          purge_at: 'uploaded_at + 30 j (job video_clips_purge)',
        },
      });
      return r.rows[0];
    });
  }

  async listClips(query: ListClipsQuery): Promise<Array<Record<string, unknown>>> {
    const tenantId = await this.assertVideoEnabled();
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT v.id, v.camera_id, c.name AS camera_name, c.zone AS camera_zone,
              v.captured_at, v.storage_backend, v.mime_type, v.size_bytes,
              v.duration_seconds, v.uploaded_at,
              v.uploaded_at + INTERVAL '30 days' AS purge_at
       FROM video_clips v JOIN video_cameras c ON c.id = v.camera_id
       WHERE v.organization_id = $1
         AND ($2::uuid IS NULL OR v.camera_id = $2)
         AND ($3::timestamptz IS NULL OR v.captured_at >= $3)
         AND ($4::timestamptz IS NULL OR v.captured_at <= $4)
       ORDER BY v.captured_at DESC LIMIT 200`,
      [tenantId, query.camera_id ?? null, query.from ?? null, query.to ?? null],
    )).rows);
  }

  /** Clip du tenant (404 cross-tenant) — utilisé par download/content. */
  private async clipOfTenant(clipId: string): Promise<{ id: string; storage_backend: string; storage_key: string; mime_type: string }> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const r = await client.query(
        `SELECT id, storage_backend, storage_key, mime_type FROM video_clips WHERE id=$1 AND organization_id=$2`,
        [clipId, tenantId],
      );
      if (!r.rows[0]) throw Errors.notFound();
      return r.rows[0];
    });
  }

  // ── Politique de stockage serveur (audit — jamais confiance au client) ────

  /**
   * Politique SERVEUR sur storage_key (audit) :
   * - la clé DOIT être un chemin relatif sous `${tenantId}/video/` (jamais
   *   de clé d'un autre tenant, jamais de chemin absolu) ;
   * - aucun `..` (path traversal), même si la regex DTO a déjà filtré ;
   * - le tout AVANT tout accès disque ou insertion.
   */
  private assertStorageKeyPolicy(tenantId: string, storageKey: string): void {
    if (storageKey.includes('..')) {
      throw new AppError(
        'PATH_TRAVERSAL',
        'Clé de stockage interdite (chemin relatif attendu, sans ..)',
        'مفتاح تخزين مرفوض (مسار نسبي بدون ..)',
        422,
      );
    }
    const prefix = `${tenantId}/video/`;
    if (!storageKey.startsWith(prefix)) {
      throw new AppError(
        'STORAGE_POLICY',
        'Clé de stockage refusée : elle doit se trouver sous le répertoire vidéo de votre établissement',
        'مفتاح تخزين مرفوض: يجب أن يكون ضمن مجلد الفيديو الخاص بمؤسستك',
        422,
      );
    }
  }

  /**
   * Backend RÉEL : dérivé UNIQUEMENT de STORAGE_BACKEND serveur (audit) —
   * le champ DTO storage_backend est @deprecated et ignoré. `local` est
   * refusé en production (stockage local = dev/test uniquement).
   */
  private resolveStorageBackend(): 'local' | 's3' {
    const backend = this.config.get<string>('STORAGE_BACKEND', 's3') === 'local' ? 'local' : 's3';
    if (backend === 'local' && this.config.get<string>('NODE_ENV') === 'production') {
      throw new AppError(
        'STORAGE_POLICY',
        'Le stockage local de clips vidéo est interdit en production (S3/MinIO requis)',
        'التخزين المحلي لمقاطع الفيديو ممنوع في الإنتاج (يلزم S3/MinIO)',
        422,
      );
    }
    return backend;
  }

  /** Visionnage journalisé (DPIA §5, action 'read') — commun aux deux modes. */
  private async auditView(clipId: string, organizationId: string, userId: string, ipAddress?: string): Promise<void> {
    await this.audit.log({
      organizationId,
      userId,
      action: 'read',
      resourceType: 'video_clip',
      resourceId: clipId,
      newValues: { channel: 'download' },
      ipAddress,
    });
  }

  async downloadUrl(clipId: string, userId: string, ipAddress?: string): Promise<{ storage_backend: string; download_url?: string; content_url?: string }> {
    const tenantId = await this.assertVideoEnabled();
    const clip = await this.clipOfTenant(clipId);
    await this.auditView(clipId, tenantId, userId, ipAddress);
    if (clip.storage_backend === 'local') {
      return { storage_backend: 'local', content_url: `/api/v1/video/clips/${clipId}/content` };
    }
    return { storage_backend: 's3', download_url: await this.storage.presignGet(clip.storage_key) };
  }

  /** Backend local (dev/test) : lecture réelle du fichier — visionnage journalisé. */
  async streamContent(clipId: string, userId: string, ipAddress?: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const tenantId = await this.assertVideoEnabled();
    const clip = await this.clipOfTenant(clipId);
    if (clip.storage_backend !== 'local') {
      throw new AppError(
        'USE_SIGNED_URL',
        'Ce clip est stocké sur S3 : utilisez l’URL signée de download',
        'هذا المقطع مخزّن في S3 : استخدم رابط التحميل الموقّع',
        422,
      );
    }
    await this.auditView(clipId, tenantId, userId, ipAddress);
    // Garde anti path-traversal (audit) : la clé doit rester sous le préfixe
    // vidéo DU TENANT (défense croisée : un clip A ne peut jamais lire le
    // répertoire d'un autre tenant dans la même racine), PUIS resolve() +
    // containment sous la racine de stockage — aucune lecture disque avant
    // ces deux contrôles.
    this.assertStorageKeyPolicy(tenantId, clip.storage_key);
    const dir = this.config.get<string>('STORAGE_LOCAL_DIR', '/tmp/creche-pdf');
    const root = resolve(dir);
    const filePath = resolve(root, clip.storage_key);
    if (filePath !== root && !filePath.startsWith(root + sep)) {
      throw new AppError(
        'PATH_TRAVERSAL',
        'Clé de stockage interdite (chemin hors du répertoire de stockage)',
        'مفتاح تخزين مرفوض (مسار خارج مجلد التخزين)',
        422,
      );
    }
    let buffer: Buffer;
    try {
      buffer = await readFile(filePath);
    } catch {
      throw new AppError(
        'CLIP_FILE_MISSING',
        'Fichier du clip introuvable sur le stockage local',
        'ملف المقطع غير موجود في التخزين المحلي',
        404,
      );
    }
    return { buffer, mimeType: clip.mime_type };
  }
}
