import { Injectable } from '@nestjs/common';
import { assertStorageKeyInTenant } from '../../shared/authorization/storage-key';
export { assertStorageKeyInTenant } from '../../shared/authorization/storage-key';
import { photoConsentsAllowed } from '../../shared/authorization/photo-consent';
import type { StorageObject } from '../../shared/storage/object-stream';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { MEDIA_MIME_TYPES, PresignUploadDto, RegisterMediaDto, UploadMediaDto } from './dto/media.dto';
import { createHash } from 'node:crypto';
import { StorageService } from './storage.service';

/** Plafond produit d'un média téléversé (photo compressée, PDF). */
export const MEDIA_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** Signatures binaires des types acceptés (le Content-Type d'un client se ment). */
const MAGIC_BYTES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'application/pdf': (b) => b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-',
};

/** Fichier reçu par l'API (forme minimale de `Express.Multer.File`). */
export interface UploadedMediaFile {
  buffer?: Buffer;
  size: number;
  mimetype: string;
  originalname: string;
}

/**
 * Chemin de lecture same-origin d'un média (LOT 2 — P0 F5).
 * Relatif à l'origine PUBLIQUE : le web le résout sur la même origine, les
 * apps mobiles le préfixent par l'origine de leur `API_URL`. Jamais d'hôte de
 * stockage dans une réponse d'API.
 */
export function mediaContentPath(mediaId: string): string {
  return `/api/v1/media/${mediaId}/content`;
}

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

  // ── Upload proxyfié par l'API (LOT 2B) ───────────────────────────────────

  /**
   * Téléversement d'un média **par l'API** — chemin supporté en production.
   *
   * Pourquoi : `POST /media/presign-upload` rend une URL signée bâtie sur
   * `S3_ENDPOINT` (`http://minio:9000` en production, MinIO lié à
   * `127.0.0.1`) — un téléphone ne peut pas y écrire (P0 F5). Ici les octets
   * passent par l'API, qui les écrit dans le stockage ; la clé est construite
   * côté serveur (préfixe tenant) et le SHA-256 fourni par le client est
   * **vérifié**, pas seulement stocké (la dette « le serveur la stocke sans la
   * recalculer » est levée sur ce chemin).
   *
   * L'asset est créé exactement comme `POST /media` (mêmes gardes enfants /
   * enfants sur la photo, même `sync_changelog`, même audit) et reste
   * `is_visible_to_parents = false` jusqu'à vérification du consentement.
   */
  async upload(userId: string, file: UploadedMediaFile, dto: UploadMediaDto): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    if (!file?.buffer || file.size === 0) {
      throw new AppError('MEDIA_FILE_REQUIRED', 'Aucun fichier reçu', 'لم يتم استلام أي ملف', 422);
    }
    if (!(MEDIA_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      throw new AppError(
        'MEDIA_MIME_NOT_ALLOWED',
        `Type de fichier non autorisé (autorisés : ${MEDIA_MIME_TYPES.join(', ')})`,
        'نوع الملف غير مسموح به',
        422,
      );
    }
    if (file.size > MEDIA_MAX_UPLOAD_BYTES) {
      throw new AppError(
        'MEDIA_TOO_LARGE',
        `Fichier trop volumineux (maximum ${Math.round(MEDIA_MAX_UPLOAD_BYTES / 1024 / 1024)} Mo)`,
        'الملف كبير جدًا',
        422,
      );
    }
    if (dto.checksum) {
      const actual = createHash('sha256').update(file.buffer).digest('hex');
      if (actual !== dto.checksum.toLowerCase()) {
        // Intégrité : on refuse AVANT d'écrire — jamais d'objet douteux stocké.
        throw new AppError(
          'MEDIA_CHECKSUM_MISMATCH',
          'Le contenu reçu ne correspond pas au SHA-256 annoncé',
          'المحتوى المستلم لا يطابق البصمة المعلنة',
          422,
        );
      }
    }
    // Le type annoncé par le client ne suffit pas : on vérifie la SIGNATURE
    // binaire avant d'écrire quoi que ce soit dans le stockage (un fichier
    // texte annoncé « image/jpeg » n'a rien à faire dans les médias, même
    // servi en same-origin).
    if (!MAGIC_BYTES[file.mimetype]?.(file.buffer)) {
      throw new AppError(
        'MEDIA_CONTENT_MISMATCH',
        'Le contenu du fichier ne correspond pas au type annoncé',
        'محتوى الملف لا يطابق النوع المعلن',
        422,
      );
    }
    const mediaType = file.mimetype === 'application/pdf' ? 'document' : 'photo';
    const storageKey = this.storage.storageKey(tenantId, mediaType, file.originalname);
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    return this.createAsset(userId, {
      storageKey,
      mediaType,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      fileSizeBytes: file.size,
      checksum: dto.checksum ?? createHash('sha256').update(file.buffer).digest('hex'),
      childId: dto.child_id,
      logEventId: dto.log_event_id,
      childrenInPhoto: dto.children_in_photo,
      takenAt: dto.taken_at,
      // Déclaration du client ≠ mesure du serveur : ici, personne ne retire
      // les métadonnées (ni le client — L2F —, ni l'API). Défaut `true` =
      // un mensonge de données, qui plus est un risque de confidentialité
      // (GPS conservé dans des photos d'enfants, colonne lue par l'audit
      // `data_*`). On enregistre ce qui est VRAI ; `false` le restera tant
      // que rien ne dépouille l'image, et un vrai retrait pourra le dire.
      exifStripped: dto.exif_stripped ?? false,
    });
  }

  // ── Étape 2 : enregistrement de l'asset après upload direct ──────────────

  async register(userId: string, dto: RegisterMediaDto): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    assertStorageKeyInTenant(dto.storage_key, tenantId);
    return this.createAsset(userId, {
      storageKey: dto.storage_key,
      mediaType: dto.mime_type === 'application/pdf' ? 'document' : 'photo',
      mimeType: dto.mime_type,
      originalFilename: dto.original_filename,
      fileSizeBytes: dto.file_size_bytes,
      checksum: dto.checksum,
      childId: dto.child_id,
      logEventId: dto.log_event_id,
      childrenInPhoto: dto.children_in_photo,
      takenAt: dto.taken_at,
      exifStripped: dto.exif_stripped,
    });
  }

  /**
   * Création de l'asset — chemins `register` (upload direct, dev/legacy) et
   * `upload` (octets passés par l'API, production) partagent EXACTEMENT les
   * mêmes gardes : enfants du tenant, `sync_changelog`, audit, et
   * `is_visible_to_parents = false` tant que le consentement n'est pas vérifié.
   */
  private async createAsset(
    userId: string,
    input: {
      storageKey: string;
      mediaType: 'photo' | 'document';
      mimeType: string;
      originalFilename?: string | null;
      fileSizeBytes?: number | null;
      checksum?: string | null;
      childId?: string | null;
      logEventId?: string | null;
      childrenInPhoto?: string[] | null;
      takenAt?: string | null;
      exifStripped?: boolean | null;
    },
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      if (input.childId) await this.childOfTenant(client, input.childId);
      if (input.logEventId) await this.logEventOfTenant(client, input.logEventId);
      if (input.childrenInPhoto?.length) {
        for (const cid of input.childrenInPhoto) {
          await this.childOfTenant(client, cid);
        }
      }
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
          tenantId, input.childId ?? null, input.logEventId ?? null, userId, input.mediaType,
          input.storageKey, input.originalFilename ?? null, input.mimeType, input.fileSizeBytes ?? null,
          input.takenAt ?? null, input.exifStripped ?? false, input.checksum ?? null,
          input.childrenInPhoto ?? null,
          input.childrenInPhoto != null && input.childrenInPhoto.length > 0,
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
          JSON.stringify({ media_id: media.id, child_id: input.childId ?? null, media_type: input.mediaType }),
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

  /**
   * Lien de lecture pour le personnel : **chemin relatif same-origin**.
   *
   * LOT 2 (P0 F5) : l'API rendait une URL signée S3 bâtie sur `S3_ENDPOINT`
   * (`http://minio:9000` en production, MinIO lié à 127.0.0.1) — inutilisable
   * par un client. Le client appelle désormais ce chemin sur l'API elle-même
   * (avec son JWT) : `GET /media/:id/content`. Le journal d'accès reste
   * inchangé (l'URL n'est plus qu'un chemin, la lecture réelle re-journalise).
   */
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
    await this.logView(tenantId, userId, mediaId, media.child_id, ipAddress);
    return { url: mediaContentPath(mediaId), key: media.storage_key };
  }

  /**
   * Contenu binaire d'un média, servi en flux par l'API (same-origin).
   *
   * Mêmes autorisations que `downloadUrl` (RLS + rôle au contrôleur) et même
   * journalisation (media_access_logs + carnet d'accès loi 25-11). Un objet
   * absent du stockage est un 404, jamais un 500.
   */
  async streamContent(
    userId: string,
    mediaId: string,
    ipAddress?: string,
  ): Promise<{ object: StorageObject; mimeType: string; filename: string | null; childId: string | null }> {
    const tenantId = requireTenant(this.tenantContext);
    const media = await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, storage_key, mime_type, original_filename, child_id
         FROM media_assets WHERE id = $1 AND deleted_at IS NULL`,
        [mediaId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      return res.rows[0];
    });
    // C3 : le client ne choisit pas le périmètre de ses objets — la clé doit
    // être préfixée par le tenant, y compris en lecture locale.
    assertStorageKeyInTenant(media.storage_key, tenantId);
    const object = await this.storage.open(media.storage_key);
    if (!object) {
      throw new AppError(
        'MEDIA_CONTENT_MISSING',
        'Le fichier du média est introuvable sur le stockage',
        'ملف الوسائط غير موجود في التخزين',
        404,
      );
    }
    await this.logView(tenantId, userId, mediaId, media.child_id, ipAddress);
    return {
      object,
      mimeType: media.mime_type ?? 'application/octet-stream',
      filename: media.original_filename ?? null,
      childId: media.child_id ?? null,
    };
  }

  /** Journal d'accès médias dédié (loi 25-11) + carnet d'accès (ADR-010). */
  private async logView(
    tenantId: string,
    userId: string,
    mediaId: string,
    childId: string | null,
    ipAddress?: string,
  ): Promise<void> {
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
      dataSubjectId: childId ?? mediaId,
      dataSubjectType: childId ? 'child' : 'media',
      accessType: 'view',
      justification: 'consultation_media',
      ipAddress: ipAddress ?? null,
    });
  }

  /**
   * Médias d'un enfant visibles par ses parents.
   *
   * `list()` est réservé au personnel : il résout le rôle et les `room_ids`
   * du membership pour cloisonner par aire. Un parent (`parent_primary` /
   * `parent_secondary`) n'appartient à aucune salle — `room_ids` est NULL —
   * donc ce filtrage renvoyait toujours une liste vide, alors même que le
   * téléchargement direct de la MÊME photo fonctionnait. La liste parent
   * était donc systématiquement vide.
   *
   * On interroge ici sur le lien de filiation plutôt que sur les salles.
   * Les garde-fous ne sont pas relâchés, ils sont seulement portés par
   * l'appelant, qui reste la seule voie d'accès parent :
   *   - `assertPermission(..., 'can_view_journal')` vérifie le lien tuteur ;
   *   - `is_visible_to_parents = true` est exigé ci-dessous ;
   *   - le consentement photo est revérifié par `photoUrl()` au moment de
   *     signer chaque URL, donc une révocation reste immédiate.
   * RLS continue de cloisonner par organisation.
   */
  async listForParent(childId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT id, child_id, media_type, mime_type, original_filename,
                file_size_bytes, taken_at, is_visible_to_parents,
                all_consents_checked, children_in_photo, created_at
         FROM media_assets
         WHERE child_id = $1
           AND is_visible_to_parents = true
           AND deleted_at IS NULL
         ORDER BY created_at DESC`,
        [childId],
      );
      return res.rows;
    });
  }

  /**
   * L2H — `log_event_id` est un identifiant DÉCLARÉ par le client, au même
   * titre que `child_id`... sauf que lui n'était vérifié nulle part : il
   * partait tel quel dans l'INSERT. Or les clés étrangères PostgreSQL **ne
   * consultent pas le RLS** — l'insertion aboutissait donc même vers
   * l'organisation voisine (mesuré : 201 + ligne créée). La garde lit
   * l'événement sur la connexion du tenant : le RLS fait le tri, et un
   * identifiant hors périmètre devient un 404, comme un enfant inconnu.
   */
  private async logEventOfTenant(client: PoolClient, logEventId: string): Promise<void> {
    const res = await client.query(
      `SELECT id FROM daily_log_events WHERE id = $1`,
      [logEventId],
    );
    if (res.rows.length === 0) {
      throw new AppError(
        'NOT_FOUND',
        'Événement de journal introuvable dans cette organisation',
        'حدث اليومية غير موجود',
        404,
      );
    }
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
