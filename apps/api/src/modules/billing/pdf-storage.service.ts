import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Stockage des PDF de facturation.
 *
 * Deux backends explicitement configurés (aucune magie) :
 * - `STORAGE_BACKEND=s3`    (défaut) : S3/MinIO, URLs signées en lecture ;
 * - `STORAGE_BACKEND=local` : répertoire local `STORAGE_LOCAL_DIR`
 *   (pratique pour les tests et les déploiements mono-serveur).
 *
 * Le worker (apps/worker) écrit le PDF, l'API le sert après autorisation.
 */
@Injectable()
export class PdfStorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('S3_BUCKET', 'creche-media');
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

  isLocal(): boolean {
    return this.config.get<string>('STORAGE_BACKEND', 's3') === 'local';
  }

  localDir(): string {
    return this.config.get<string>('STORAGE_LOCAL_DIR', '/tmp/creche-pdf');
  }

  /** Clé de stockage (identique worker/API — la clé est persistée dans invoices.pdf_url). */
  key(orgId: string, invoiceId: string): string {
    return `${orgId}/invoices/${invoiceId}.pdf`;
  }

  /** Lecture du PDF (backend local) ou URL signée (backend S3). */
  async read(key: string): Promise<Buffer> {
    if (this.isLocal()) {
      return readFile(join(this.localDir(), key));
    }
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const response = await this.client.send(command);
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  /** URL signée courte durée (backend S3). */
  async presign(key: string): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: 900 });
  }

  /** Le PDF existe-t-il sur le backend local ? (détection d'erreur précoce) */
  exists(key: string): boolean {
    if (!this.isLocal()) return true; // S3 : la lecture échouera proprement si absent
    return existsSync(join(this.localDir(), key));
  }
}
