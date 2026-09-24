import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolveStorageBackend, type StorageBackend } from '@creche/prod-config';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { openLocalObject, openS3Object, type StorageObject } from '../../shared/storage/object-stream';

/**
 * Stockage objet des médias.
 *
 * LOT 2 (P0 « F5 », plan de réparation 2026-09-24) — ce service ne rend PLUS
 * d'URL de lecture : `presignGet` a été supprimé. En production,
 * `S3_ENDPOINT` vaut `http://minio:9000` et MinIO est lié à `127.0.0.1` :
 * toute URL signée rendue au client était donc inutilisable depuis un
 * navigateur ou un téléphone. La lecture passe désormais par `open()`, et
 * l'API sert le contenu same-origin (cf. shared/storage/object-stream.ts).
 *
 * E1 : le client S3 est mutualisé via S3ClientService.
 */
@Injectable()
export class StorageService {
  private readonly expirySeconds: number;
  private readonly backend: StorageBackend;

  constructor(
    private readonly config: ConfigService,
    private readonly s3: S3ClientService,
  ) {
    this.expirySeconds = this.config.get<number>('S3_URL_EXPIRY_SECONDS', 3600);
    this.backend = resolveStorageBackend({
      NODE_ENV: this.config.get<string>('NODE_ENV'),
      STORAGE_BACKEND: this.config.get<string>('STORAGE_BACKEND'),
    });
  }

  isLocal(): boolean {
    return this.backend === 'local';
  }

  localDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', '/tmp/creche-pdf');
  }

  /**
   * URL signée PUT — l'appareil uploade directement l'objet.
   *
   * ⚠ TOUJOURS EN PLACE, ET ENCORE INUTILISABLE EN PRODUCTION : c'est la
   * moitié « upload » du P0 F5, traitée par le lot 2B (endpoint d'upload
   * proxifié par l'API + client staff-mobile). Ne pas s'appuyer dessus pour
   * une mise en service réelle tant que le lot 2B n'est pas livré — le plan
   * de réparation le dit explicitement.
   */
  async presignPut(key: string, contentType: string): Promise<{ url: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.s3.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.s3.client, command, { expiresIn: this.expirySeconds });
    return { url, key };
  }

  /**
   * Ouvre un objet en lecture (local ou S3) — `null` si l'objet n'existe pas.
   * Aucun garde d'autorisation ici : l'appelant a déjà vérifié le périmètre
   * (RLS + `assertStorageKeyInTenant` + containment local).
   */
  open(key: string): Promise<StorageObject | null> {
    if (this.isLocal()) return openLocalObject(this.localDir(), key);
    return openS3Object(this.s3.client, this.s3.bucket, key);
  }

  /** Clé de stockage hiérarchisée par organisation. */
  storageKey(orgId: string, mediaType: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return `${orgId}/${mediaType}/${Date.now()}-${safe}`;
  }
}
