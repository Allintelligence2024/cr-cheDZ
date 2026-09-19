import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3ClientService } from '../../shared/storage/s3-client.service';

/**
 * Stockage objet S3-compatible (MinIO auto-hébergé ou AWS S3).
 * URLs signées : le serveur signe, le client uploade/télécharge en direct
 * (jamais de médias via l'API). La signature est calculée localement
 * (aucun réseau requis).
 *
 * E1 : le client S3 est mutualisé via S3ClientService (plus de client
 * dupliqué par service de stockage).
 */
@Injectable()
export class StorageService {
  private readonly expirySeconds: number;

  constructor(
    private readonly config: ConfigService,
    private readonly s3: S3ClientService,
  ) {
    this.expirySeconds = this.config.get<number>('S3_URL_EXPIRY_SECONDS', 3600);
  }

  /** URL signée PUT — l'appareil uploade directement l'objet. */
  async presignPut(key: string, contentType: string): Promise<{ url: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.s3.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.s3.client, command, { expiresIn: this.expirySeconds });
    return { url, key };
  }

  /** URL signée GET — accès de courte durée, journalisé côté API. */
  presignGet(key: string): Promise<string> {
    return this.s3.presignGet(key, this.expirySeconds);
  }

  /** Clé de stockage hiérarchisée par organisation. */
  storageKey(orgId: string, mediaType: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return `${orgId}/${mediaType}/${Date.now()}-${safe}`;
  }
}
