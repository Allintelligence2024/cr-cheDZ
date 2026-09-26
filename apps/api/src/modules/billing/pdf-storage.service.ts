import { resolveStorageBackend, type StorageBackend } from '@creche/prod-config';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { openLocalObject, openS3Object, type StorageObject } from '../../shared/storage/object-stream';

/**
 * Stockage des PDF de facturation.
 *
 * Deux backends explicitement configurés (aucune magie) :
 * - `STORAGE_BACKEND=s3`    (défaut hors production uniquement) : S3/MinIO, lecture en flux par l'API
 *   (LOT 2 — plus d'URL signée rendue au client, cf. shared/storage/object-stream.ts) ;
 * - `STORAGE_BACKEND=local` : répertoire local `STORAGE_LOCAL_DIR`
 *   (pratique pour les tests et les déploiements mono-serveur).
 *
 * Le worker (apps/worker) écrit le PDF, l'API le sert après autorisation.
 * E1 : client S3 mutualisé via S3ClientService.
 */
@Injectable()
export class PdfStorageService {
  private readonly backend: StorageBackend;

  constructor(
    private readonly config: ConfigService,
    private readonly s3: S3ClientService,
  ) {
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

  /** Clé de stockage (identique worker/API — la clé est persistée dans invoices.pdf_url). */
  key(orgId: string, invoiceId: string): string {
    return `${orgId}/invoices/${invoiceId}.pdf`;
  }

  /** Lecture complète du PDF (buffer) — pour les usages qui exigent le buffer. */
  async read(key: string): Promise<Buffer> {
    if (this.isLocal()) {
      return readFile(join(this.localDir(), key));
    }
    const command = new GetObjectCommand({ Bucket: this.s3.bucket, Key: key });
    const response = await this.s3.client.send(command);
    const chunks: Buffer[] = [];
    for await (const chunk of response.Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  /**
   * Ouvre le PDF en FLUX (backend local ou S3) — `null` s'il n'existe pas.
   *
   * LOT 2 (P0 F5) : remplace `presign()`, supprimé. L'API rendait une URL
   * signée bâtie sur `S3_ENDPOINT` (`http://minio:9000` en production, MinIO
   * lié à 127.0.0.1) : aucun navigateur ni téléphone ne pouvait l'ouvrir. Le
   * PDF est désormais servi par l'API elle-même, same-origin.
   */
  open(key: string): Promise<StorageObject | null> {
    if (this.isLocal()) return openLocalObject(this.localDir(), key);
    return openS3Object(this.s3.client, this.s3.bucket, key);
  }

  /** Le PDF existe-t-il sur le backend local ? (détection d'erreur précoce) */
  exists(key: string): boolean {
    if (!this.isLocal()) return true; // S3 : la lecture échouera proprement si absent
    return existsSync(join(this.localDir(), key));
  }
}
