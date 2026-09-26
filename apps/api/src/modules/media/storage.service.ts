import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { resolveStorageBackend, type StorageBackend } from '@creche/prod-config';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { containmentPath, openLocalObject, openS3Object, type StorageObject } from '../../shared/storage/object-stream';
import { AppError } from '../../shared/errors';

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
   * Écrit un objet (LOT 2B) — backend local ou S3/MinIO.
   *
   * Primitive de l'upload proxyfié par l'API : le client envoie ses octets à
   * l'API, l'API les écrit dans le stockage. Indispensable depuis que MinIO
   * n'est plus joignable depuis un client (P0 F5) : sans elle, une photo ne
   * pouvait être **téléversée** qu'en écrivant directement dans le stockage,
   * c'est-à-dire jamais depuis un téléphone en production.
   *
   * La clé est construite côté serveur (`storageKey(orgId, …)`) : le client ne
   * choisit pas son périmètre.
   */
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.isLocal()) {
      const filePath = containmentPath(this.localDir(), key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, body);
      return;
    }
    await this.s3.client.send(new PutObjectCommand({
      Bucket: this.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }));
  }

  /**
   * URL signée PUT — conservée pour le développement (MinIO local + tests).
   *
   * ⚠ EN PRODUCTION, REFUSÉE TANT QU'UNE ORIGINE PUBLIQUE N'EST PAS
   * CONFIGURÉE (`S3_PUBLIC_ENDPOINT`, option B du plan) : une URL signée sur
   * `S3_ENDPOINT=http://minio:9000` (MinIO lié à 127.0.0.1) est inexploitable
   * depuis un client, et un 503 explicite vaut mieux qu'une URL qui échoue à
   * l'usage. En production, le chemin supporté est l'upload proxyfié par
   * l'API : `POST /api/v1/media/upload`.
   */
  /**
   * URL signée d'ÉCRITURE (PUT). En production sans origine publique
   * (`S3_PUBLIC_ENDPOINT`), l'URL serait inexploitable : on refuse (503) au
   * lieu de rendre un lien mort. `hint` nomme la route de remplacement, qui
   * diffère selon l'appelant (photos vs clips vidéo).
   */
  async presignPut(
    key: string,
    contentType: string,
    hint = 'POST /api/v1/media/upload',
  ): Promise<{ url: string; key: string }> {
    const publicEndpoint = this.config.get<string>('S3_PUBLIC_ENDPOINT');
    if (this.config.get<string>('NODE_ENV') === 'production' && !publicEndpoint) {
      throw new AppError(
        'UPLOAD_VIA_API_REQUIRED',
        `Le téléversement direct vers le stockage est désactivé (stockage non exposé publiquement). Utilisez ${hint}`,
        'التحميل المباشر إلى التخزين معطّل (التخزين غير متاح للعموم)',
        503,
      );
    }
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
    const safe = filename
      .replace(/[^a-zA-Z0-9._-]/g, '_') // ni « / » ni « \ » : aucun séparateur de chemin
      .replace(/\.{2,}/g, '_')          // pas de « .. » : la clé satisfait le CHECK 049 par construction
      .replace(/^\.+/, '_')
      .slice(-80);
    return `${orgId}/${mediaType}/${Date.now()}-${safe}`;
  }
}
