import { ConfigService } from '@nestjs/config';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3ClientService } from '../../shared/storage/s3-client.service';
import { StorageService } from './storage.service';

/**
 * LOT 2 (P0 « F5 ») — stockage média : les deux moitiés du contrat.
 *
 * Ce que ces tests verrouillent, et pourquoi ils ont une valeur :
 * - en production, plus AUCUNE URL signée d'upload ne sort tant qu'une origine
 *   publique (`S3_PUBLIC_ENDPOINT`) n'est pas configurée : l'URL signée sur
 *   `S3_ENDPOINT=http://minio:9000` (service lié à 127.0.0.1) est
 *   inexploitable — un 503 explicite vaut mieux qu'une URL qui échoue à
 *   l'usage (c'était l'état du lot 1 pour l'upload) ;
 * - l'écriture d'objet (`put`) fonctionne sur le backend local — c'est la
 *   brique de l'upload proxyfié par l'API (`POST /media/upload`), le chemin
 *   supporté en production ;
 * - la lecture/écriture locale reste confinée à la racine de stockage
 *   (`containmentPath`) : une clé `..` ne peut pas écrire hors du répertoire.
 */
function makeConfig(env: Record<string, string | undefined>): ConfigService {
  return { get: (key: string, fallback?: unknown) => env[key] ?? fallback } as unknown as ConfigService;
}

/** S3ClientService réel (signature locale, aucun appel réseau). */
function makeS3(env: Record<string, string | undefined> = {}): S3ClientService {
  return new S3ClientService(makeConfig({
    S3_BUCKET: 'creche-media',
    S3_ENDPOINT: 'http://127.0.0.1:9',
    S3_REGION: 'us-east-1',
    S3_ACCESS_KEY: 'spec-synthetic',
    S3_SECRET_KEY: 'spec-synthetic-secret',
    ...env,
  }));
}

describe('StorageService — LOT 2 (upload proxyfié par l’API, P0 F5)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'creche-storage-spec-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('presignPut (upload direct par URL signée)', () => {
    it('production sans S3_PUBLIC_ENDPOINT → 503 UPLOAD_VIA_API_REQUIRED (jamais une URL injoignable)', async () => {
      const service = new StorageService(
        makeConfig({ NODE_ENV: 'production', STORAGE_BACKEND: 's3' }),
        makeS3(),
      );

      await expect(service.presignPut('org/photo/a.jpg', 'image/jpeg')).rejects.toMatchObject({
        code: 'UPLOAD_VIA_API_REQUIRED',
        status: 503,
      });
    });

    it('production AVEC origine publique (option B) → URL signée émise', async () => {
      const service = new StorageService(
        makeConfig({ NODE_ENV: 'production', STORAGE_BACKEND: 's3', S3_PUBLIC_ENDPOINT: 'https://storage.creche.dz' }),
        makeS3(),
      );

      const { url, key } = await service.presignPut('org/photo/a.jpg', 'image/jpeg');
      expect(key).toBe('org/photo/a.jpg');
      expect(url).toContain('X-Amz-Signature');
    });

    it('développement → URL signée émise sans origine publique (MinIO local)', async () => {
      const service = new StorageService(makeConfig({ NODE_ENV: 'test', STORAGE_BACKEND: 's3' }), makeS3());

      const { url } = await service.presignPut('org/photo/b.jpg', 'image/jpeg');
      expect(url).toContain('X-Amz-Signature');
    });
  });

  describe('put (brique de POST /media/upload)', () => {
    it('backend local : écrit l’objet au chemin exact, octets identiques', async () => {
      const service = new StorageService(
        makeConfig({ NODE_ENV: 'test', STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: dir }),
        makeS3(),
      );
      const body = Buffer.from('PHOTO-BYTES-LOT-2B', 'utf8');

      await service.put('11111111-1111-4111-8111-111111111111/photo/1-p.jpg', body, 'image/jpeg');

      const written = readFileSync(join(dir, '11111111-1111-4111-8111-111111111111/photo/1-p.jpg'));
      expect(written.equals(body)).toBe(true);
    });

    it('backend local : refuse d’écrire hors de la racine (clé ..)', async () => {
      const service = new StorageService(
        makeConfig({ NODE_ENV: 'test', STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: dir }),
        makeS3(),
      );

      await expect(
        service.put('org/photo/../../../etc/evasion.jpg', Buffer.from('x'), 'image/jpeg'),
      ).rejects.toMatchObject({ code: 'PATH_TRAVERSAL', status: 422 });
    });

    it('storageKey : préfixe l’organisation et assainit le nom de fichier', () => {
      const service = new StorageService(
        makeConfig({ NODE_ENV: 'test', STORAGE_BACKEND: 'local', STORAGE_LOCAL_DIR: dir }),
        makeS3(),
      );

      const key = service.storageKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'photo', '../../etc/passwd');
      expect(key.startsWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/photo/')).toBe(true);
      expect(key.includes('..')).toBe(false);
      expect(key.includes('/etc/')).toBe(false);
    });
  });
});
