import { GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import type { Request, Response } from 'express';
import { AppError } from '../errors';

/**
 * Lecture d'objets de stockage et envoi HTTP — LOT 2 (P0 « F5 »).
 *
 * Le problème corrigé : l'API rendait au client des URLs **signées S3** bâties
 * sur `S3_ENDPOINT` (`.env.prod.example` : `http://minio:9000`), alors que
 * MinIO est lié à `127.0.0.1` en production (« jamais exposé publiquement »,
 * docker-compose.prod.yml). Résultat : photos, PDF, exports et clips étaient
 * inaccessibles depuis un navigateur ou un téléphone — chaque suite
 * d'isolation verte, parce qu'elles vérifiaient l'autorisation, jamais la
 * **joignabilité** de l'URL rendue.
 *
 * Décision retenue (option A, plan de réparation 2026-09-24) : le contenu est
 * servi par l'API, **same-origin**, en flux. Conséquences assumées et écrites :
 * - plus aucune URL de stockage ne sort de l'API (donc plus de dépendance à
 *   l'exposition de MinIO, mais aussi plus de `presignGet` dans le code) ;
 * - la bande passante de lecture passe par l'API (acceptable à l'échelle du
 *   pilote ; l'option B — sous-domaine de stockage + TLS — reste ouverte et
 *   n'exigerait que de rebrancher un `presignGet` **configuré sur un hôte
 *   public**, jamais sur l'endpoint interne).
 *
 * L'API web peut donc être atteinte par un simple `<img src>`/lien relatif, à
 * condition d'être authentifiée (JWT) : c'est le prix de la protection.
 */

/** Objet ouvert en lecture : flux + métadonnées réellement connues. */
export interface StorageObject {
  stream: Readable;
  /** Type MIME annoncé par le stockage (S3), sinon null (le callistre décide). */
  contentType: string | null;
  /** Taille si le stockage la connaît (S3) ou si le fichier local existe. */
  contentLength: number | null;
}

/** Clé refusée : chemin hors du répertoire de stockage (anti path-traversal). */
function pathTraversalError(): AppError {
  return new AppError(
    'PATH_TRAVERSAL',
    'Clé de stockage interdite (chemin hors du répertoire de stockage)',
    'مفتاح تخزين مرفوض (مسار خارج مجلد التخزين)',
    422,
  );
}

/**
 * Résout une clé sous la racine de stockage. Garde identique à celle des
 * modules exports/video (audit 2026-09) : `resolve()` + containment — aucune
 * lecture disque n'a lieu avant ce contrôle.
 */
export function containmentPath(root: string, key: string): string {
  const base = resolve(root);
  const filePath = resolve(base, key);
  if (filePath !== base && !filePath.startsWith(base + sep)) throw pathTraversalError();
  return filePath;
}

/** Objet du backend local — `null` si absent (l'appelant décide du 404). */
export async function openLocalObject(root: string, key: string): Promise<StorageObject | null> {
  const filePath = containmentPath(root, key);
  if (!existsSync(filePath)) return null;
  const info = await stat(filePath);
  if (!info.isFile()) return null;
  return { stream: createReadStream(filePath), contentType: null, contentLength: info.size };
}

/** Erreur S3 « objet absent » — la seule que l'on traduit en « pas de contenu ». */
function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}

/**
 * Objet S3/MinIO — `null` si absent. Le flux est transmis tel quel : aucune
 * mise en mémoire complète (contrairement à `PdfStorageService.read()`, qui
 * reste pour les cas où le buffer est réellement nécessaire).
 */
export async function openS3Object(client: S3Client, bucket: string, key: string): Promise<StorageObject | null> {
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) return null;
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType ?? null,
      contentLength: response.ContentLength ?? null,
    };
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export interface SendObjectOptions {
  /** Content-Type de la réponse ; celui du stockage sert de repli. */
  contentType?: string | null;
  /** Nom de fichier proposé (défaut : pas de content-disposition). */
  filename?: string;
  /** `true` = affichage (inline), `false` = téléchargement (attachment). */
  inline?: boolean;
  /** Corps renvoyé si le flux casse AVANT le premier octet. */
  onStreamError?: { code: string; messageFr: string; messageAr: string };
}

/**
 * Envoie un objet de stockage en flux sur la réponse Express.
 *
 * Deux pièges traités explicitement :
 * 1. `content-length` n'est annoncé que s'il est CONNU — l'annoncer faux
 *    tronquerait la réponse (le client couperait au compte annoncé) ;
 * 2. un flux qui casse (fichier disparu entre `stat` et la lecture, coupure
 *    S3) produit un 404 propre si rien n'est encore parti, et une coupure de
 *    connexion sinon — jamais un 200 suivi d'un corps vide silencieux.
 */
export function sendStorageObject(res: Response, request: Request, object: StorageObject, options: SendObjectOptions = {}): void {
  const contentType = options.contentType ?? object.contentType ?? 'application/octet-stream';
  res.setHeader('content-type', contentType);
  if (object.contentLength != null) res.setHeader('content-length', String(object.contentLength));
  res.setHeader('cache-control', 'private, no-store');
  if (options.filename) {
    const disposition = options.inline === false ? 'attachment' : 'inline';
    // Le nom est assaini (jamais de guillemet/CRLF injectable dans un en-tête).
    const safe = options.filename.replace(/[\r\n"\\]/g, '_').slice(0, 200);
    res.setHeader('content-disposition', `${disposition}; filename="${safe}"`);
  }
  object.stream.on('error', (error: Error) => {
    if (!res.headersSent) {
      const body = options.onStreamError ?? {
        code: 'STORAGE_OBJECT_UNREADABLE',
        messageFr: 'Fichier introuvable sur le stockage',
        messageAr: 'الملف غير موجود في التخزين',
      };
      res.status(404).json({
        statusCode: 404,
        code: body.code,
        message_fr: body.messageFr,
        message_ar: body.messageAr,
        timestamp: new Date().toISOString(),
        path: request.path,
      });
    } else {
      res.destroy(error);
    }
  });
  object.stream.pipe(res);
}
