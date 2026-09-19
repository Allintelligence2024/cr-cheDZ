import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * E1 (remédiation audits combinés) : client S3 UNIQUE pour toute l'API.
 *
 * Avant ce service, StorageService (médias), PdfStorageService (factures) et
 * ExportsService recréaient chacun leur S3Client avec les mêmes valeurs par
 * défaut de développement — triple duplication, trois endroits à oublier en
 * cas de changement de configuration. Les valeurs par défaut restent
 * strictement identiques à l'existant (le contrôle des défauts dev en
 * production est assuré par @creche/prod-config au boot, pas ici).
 *
 * Déclaré dans les providers des modules consommateurs (media, billing,
 * exports) — NestJS n'a pas de providedIn global.
 */
@Injectable()
export class S3ClientService {
  private readonly _client: S3Client;
  /** Bucket partagé (médias, PDF, exports). */
  readonly bucket: string;

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('S3_BUCKET', 'creche-media');
    this._client = new S3Client({
      endpoint: config.get<string>('S3_ENDPOINT', 'http://localhost:9000'),
      region: config.get<string>('S3_REGION', 'us-east-1'),
      credentials: {
        accessKeyId: config.get<string>('S3_ACCESS_KEY', 'minio_dev'),
        secretAccessKey: config.get<string>('S3_SECRET_KEY', 'minio_dev_password'),
      },
      forcePathStyle: true, // MinIO / S3-compatible
    });
  }

  get client(): S3Client {
    return this._client;
  }

  /** URL signée GET de courte durée (jamais de lecture objet via l'API). */
  presignGet(key: string, expirySeconds: number): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this._client, command, { expiresIn: expirySeconds });
  }
}
