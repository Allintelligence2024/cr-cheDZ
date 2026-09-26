import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';

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

  /** Suppression d'un objet (purge après anonymisation 25-11). Idempotent
   * côté S3 : supprimer une clé absente n'est pas une erreur. */
  async deleteObject(key: string): Promise<void> {
    await this._client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // ── Pourquoi il n'y a PLUS de presignGet ici (LOT 2 — P0 F5) ────────────
  //
  // L'ancienne méthode signait des URLs GET avec l'endpoint INTERNE
  // (`S3_ENDPOINT=http://minio:9000` en production, MinIO lié à 127.0.0.1) :
  // toutes les URLs rendues au client étaient injoignables. La lecture passe
  // désormais par l'API (shared/storage/object-stream.ts) et rien ne doit
  // signer contre l'endpoint interne.
  //
  // Option B (plan de réparation) si la charge de lecture devient un sujet :
  // un sous-domaine public + TLS, et une méthode de signature qui construit
  // le client sur CETTE origine publique — jamais sur `S3_ENDPOINT`.
}
