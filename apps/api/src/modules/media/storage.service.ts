import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Stockage objet S3-compatible (MinIO auto-hébergé ou AWS S3).
 * URLs signées : le serveur signe, le client uploade/télécharge en direct
 * (jamais de médias via l'API). La signature est calculée localement
 * (aucun réseau requis).
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly expirySeconds: number;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET', 'creche-media');
    this.expirySeconds = this.config.get<number>('S3_URL_EXPIRY_SECONDS', 3600);
    this.client = new S3Client({
      endpoint: this.config.get<string>('S3_ENDPOINT', 'http://localhost:9000'),
      region: this.config.get<string>('S3_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: this.config.get<string>('S3_ACCESS_KEY', 'minio_dev'),
        secretAccessKey: this.config.get<string>('S3_SECRET_KEY', 'minio_dev_password'),
      },
      forcePathStyle: true, // MinIO / S3-compatible
    });
  }

  /** URL signée PUT — l'appareil uploade directement l'objet. */
  async presignPut(key: string, contentType: string): Promise<{ url: string; key: string }> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: this.expirySeconds });
    return { url, key };
  }

  /** URL signée GET — accès de courte durée, journalisé côté API. */
  async presignGet(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: this.expirySeconds });
  }

  /** Clé de stockage hiérarchisée par organisation. */
  storageKey(orgId: string, mediaType: string, filename: string): string {
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
    return `${orgId}/${mediaType}/${Date.now()}-${safe}`;
  }
}
