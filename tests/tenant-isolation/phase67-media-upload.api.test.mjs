#!/usr/bin/env node
/**
 * Test API — Phase 67 : l'upload média passe par l'API (lot 2B, P0 « F5 »).
 *
 * Contexte (audit 2026-09-24, P0 « F5 », plan de réparation lot 2). Le volet A
 * a rendu la LECTURE same-origin (`GET …/content`). Le volet B traite la
 * moitié écrite du problème : `POST /media/presign-upload` rendait une URL
 * signée bâtie sur `S3_ENDPOINT` (`.env.prod.example` : `http://minio:9000`,
 * service lié à `127.0.0.1` dans `docker-compose.prod.yml`) — sur un téléphone
 * en production, la photo ne montait JAMAIS. Désormais les octets passent par
 * `POST /api/v1/media/upload` et c'est le serveur qui écrit l'objet.
 *
 * Ce que cette suite prouve, et qu'aucune autre ne prouvait :
 *  1. upload nominal : multipart → 201, clé construite CÔTÉ SERVEUR sous le
 *     préfixe de l'organisation, fichier réellement écrit, octets identiques ;
 *  2. chaînage volet A + volet B : le média téléversé est relu par
 *     `GET …/content` (mêmes octets) — la boucle « envoyer puis revoir » tient ;
 *  3. intégrité : SHA-256 annoncé ≠ reçu → 422 et AUCUNE écriture disque ;
 *     signature binaire mentie (texte annoncé `image/jpeg`) → 422 ;
 *     type hors liste blanche → 422 ; fichier absent → 422 (jamais 500) ;
 *  4. plafonds alignés : au-delà du plafond produit → 422 bilingue
 *     `MEDIA_TOO_LARGE` ; au-delà du plafond dur multer → 413 JSON bilingue
 *     (jamais du HTML) — l'upload ne peut pas devenir un vecteur de saturation
 *     mémoire silencieux ;
 *  5. périmètre : `child_id` d'une autre organisation → refus ; rôle parent →
 *     403 ; le contenu reste illisible depuis l'autre organisation (404) ;
 *  6. consentement de bout en bout : `children_in_photo` envoyé en multipart
 *     est bien interprété (sinon la publication aux parents serait impossible),
 *     publication sans consentement → 422 CONSENT_REQUIRED, avec consentement
 *     → visible puis lisible par le parent ;
 *  7. verrou statique : aucun `presignGet(`, et la signature d'upload
 *     (`getSignedUrl` PUT) est REFUSÉE en production sans `S3_PUBLIC_ENDPOINT`
 *     — plus aucune URL injoignable ne peut sortir vers un client.
 *
 * Usage : node tests/tenant-isolation/phase67-media-upload.api.test.mjs
 * (apps/api compilé ; PostgreSQL réel ; backend de stockage local et fichiers
 * réels écrits dans `STORAGE_LOCAL_DIR`).
 */
import { execSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = process.env.STORAGE_LOCAL_DIR ?? '/tmp/pgtest/p67store';
const MiB = 1024 * 1024;
const failures = [];
function ok(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(name);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** Fichiers source de l'API (récursif) — pour le verrou statique. */
function apiSources(dir = join(REPO, 'apps/api/src')) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return apiSources(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** Tous les fichiers présents sous la racine de stockage (chemins relatifs). */
function storedFiles(dir = STORE, root = STORE) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return storedFiles(full, root);
    return [full.slice(root.length + 1)];
  });
}

/** JPEG minimal mais VALIDE (signature SOI + segment + EOI). */
function jpegBytes(seed, padding = 32) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from(seed),
    Buffer.alloc(padding, 0x20),
    Buffer.from([0xff, 0xd9]),
  ]);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  const env = { ...process.env, DATABASE_URL: url };
  execSync('node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: REPO, env, stdio: 'inherit' });

  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  await ensureAppRole(admin);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_BACKEND = 'local';
  process.env.STORAGE_LOCAL_DIR = STORE;

  const { createApp } = await import(pathToFileURL(join(REPO, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;

  const api = async (method, path, token, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json };
  };

  /**
   * Upload multipart brut. `fields` : paires du formulaire ; `file` : octets +
   * type annoncé. Le client ne fournit JAMAIS `storage_key` : c'est le serveur
   * qui décide du périmètre (`storageKey(orgId, …)`).
   */
  const upload = async (token, { bytes, filename = 'photo.jpg', mimetype = 'image/jpeg', fields = {} } = {}) => {
    const form = new FormData();
    if (bytes) form.append('file', new Blob([bytes], { type: mimetype }), filename);
    for (const [key, value] of Object.entries(fields)) {
      if (Array.isArray(value)) value.forEach((v) => form.append(key, v));
      else form.append(key, value);
    }
    const res = await fetch(`${base}/media/upload`, {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const type = res.headers.get('content-type') ?? '';
    const text = await res.text();
    let json = null;
    if (type.includes('json')) { try { json = JSON.parse(text); } catch { json = null; } }
    return { status: res.status, body: json, contentType: type, text };
  };

  /** Lecture d'un contenu same-origin : octets + JSON éventuel. */
  const raw = async (path, token) => {
    const target = path.startsWith('http') ? path : `http://127.0.0.1:${app.getHttpServer().address().port}${path}`;
    const res = await fetch(target, { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: 'manual' });
    const bytes = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    let json = null;
    if (type.includes('json')) { try { json = JSON.parse(bytes.toString('utf8')); } catch { json = null; } }
    return { res, bytes, json };
  };

  const tag = `p67-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    rmSync(STORE, { recursive: true, force: true });
    mkdirSync(STORE, { recursive: true });

    // ── Fixtures : 2 organisations, personnel + parent ─────────────────────
    const directorRole = (await admin.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const parentRole = (await admin.query(`SELECT id FROM roles WHERE slug='parent_primary'`)).rows[0].id;

    const makeOrg = async (suffix) => {
      const org = (await admin.query(
        `INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,$2,'31') RETURNING id`,
        [`${tag}-${suffix}`, `P67 ${suffix}`],
      )).rows[0].id;
      const site = (await admin.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const director = (await admin.query(
        `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`,
        [`${tag}-${suffix}-dir@test.dz`, hash],
      )).rows[0].id;
      await admin.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      const child = (await admin.query(
        `INSERT INTO children(organization_id,site_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
         VALUES($1,$2,$3,'Nour','Test','2024-03-03',$4) RETURNING id`,
        [org, site, `P67-${suffix}`, director],
      )).rows[0].id;
      return { org, site, director, child };
    };
    const A = await makeOrg('a');
    const B = await makeOrg('b');

    const emails = {
      a: (await admin.query(`SELECT email FROM users WHERE id=$1`, [A.director])).rows[0].email,
      b: (await admin.query(`SELECT email FROM users WHERE id=$1`, [B.director])).rows[0].email,
    };
    const connect = async (email) => {
      const res = await api('POST', '/auth/login', null, { email, password });
      if (res.status !== 200 && res.status !== 201) throw new Error(`login ${email} → ${res.status}`);
      return res.body.access_token;
    };
    const tokenA = await connect(emails.a);
    const tokenB = await connect(emails.b);

    // ── 1. Upload nominal (le chemin supporté en production) ───────────────
    console.log('\n1) Upload multipart → écriture serveur, clé dans le périmètre du tenant');
    const jpeg = jpegBytes(`${tag}-nominal`);
    const up = await upload(tokenA, {
      bytes: jpeg,
      fields: { child_id: A.child, checksum: createHash('sha256').update(jpeg).digest('hex') },
    });
    ok('POST /media/upload → 201 (plus jamais d’URL `http://minio…` rendue au mobile)',
      up.status === 201 && !!up.body?.id, `status=${up.status} ${JSON.stringify(up.body)?.slice(0, 120)}`);
    const key = up.body?.storage_key;
    ok('Clé construite côté serveur sous le préfixe de l’organisation',
      typeof key === 'string' && key.startsWith(`${A.org}/photo/`), String(key));
    ok('Le client ne peut PAS imposer sa clé (`storage_key` absent des champs acceptés)',
      up.body?.storage_key === key && !JSON.stringify(up.body).includes('children_in_photo'));
    const onDisk = key ? join(STORE, key) : '';
    ok('Objet réellement écrit dans le stockage', !!onDisk && existsSync(onDisk), onDisk);
    ok('Octets stockés IDENTIQUES aux octets envoyés',
      !!onDisk && existsSync(onDisk) && readFileSync(onDisk).equals(jpeg));

    // ── 2. Chaînage volet A + volet B ──────────────────────────────────────
    console.log('\n2) Le média téléversé se relit par l’API (volet A + volet B)');
    const dl = await api('GET', `/media/${up.body?.id}/download`, tokenA);
    ok('Lien rendu = chemin relatif same-origin',
      dl.status === 200 && dl.body?.url === `/api/v1/media/${up.body?.id}/content`, JSON.stringify(dl.body)?.slice(0, 120));
    const content = await raw(dl.body?.url ?? '', tokenA);
    ok('GET sur le lien → 200 et octets identiques (aller-retour complet)',
      content.res.status === 200 && content.bytes.equals(jpeg),
      `status=${content.res.status} octets=${content.bytes.length}/${jpeg.length}`);
    ok('En-têtes de contenu privés (`private, no-store`)',
      (content.res.headers.get('cache-control') ?? '').includes('private'), content.res.headers.get('cache-control') ?? '');

    // ── 3. Intégrité, type et absence de fichier ───────────────────────────
    console.log('\n3) Refus avant écriture : intégrité, signature binaire, liste blanche');
    const before = storedFiles().length;
    const badChecksum = await upload(tokenA, { bytes: jpeg, fields: { checksum: 'a'.repeat(64) } });
    ok('SHA-256 annoncé ≠ reçu → 422 MEDIA_CHECKSUM_MISMATCH',
      badChecksum.status === 422 && badChecksum.body?.code === 'MEDIA_CHECKSUM_MISMATCH',
      `${badChecksum.status} ${badChecksum.body?.code}`);
    ok('Aucune écriture disque après un checksum invalide', storedFiles().length === before, `${before} → ${storedFiles().length}`);

    const lyingType = await upload(tokenA, { bytes: Buffer.from('<script>alert(1)</script>'), mimetype: 'image/jpeg' });
    ok('Contenu texte annoncé `image/jpeg` → 422 MEDIA_CONTENT_MISMATCH (signature binaire vérifiée)',
      lyingType.status === 422 && lyingType.body?.code === 'MEDIA_CONTENT_MISMATCH',
      `${lyingType.status} ${lyingType.body?.code}`);
    ok('Aucune écriture disque après un type menti', storedFiles().length === before);

    const badMime = await upload(tokenA, { bytes: jpeg, mimetype: 'text/html', filename: 'x.html' });
    ok('Type hors liste blanche (HTML servi same-origin = XSS stocké) → 422 MEDIA_MIME_NOT_ALLOWED',
      badMime.status === 422 && badMime.body?.code === 'MEDIA_MIME_NOT_ALLOWED',
      `${badMime.status} ${badMime.body?.code}`);

    const noFile = await upload(tokenA, { fields: { checksum: 'b'.repeat(64) } });
    ok('Formulaire sans fichier → 422 MEDIA_FILE_REQUIRED (jamais 500)',
      noFile.status === 422 && noFile.body?.code === 'MEDIA_FILE_REQUIRED',
      `${noFile.status} ${noFile.body?.code}`);

    // ── 4. Plafonds : produit (422) et dur (413), toujours bilingues ────────
    console.log('\n4) Plafonds de taille : produit 8 Mio (422), dur 12 Mio (413)');
    const tooBig = await upload(tokenA, { bytes: Buffer.concat([jpegBytes('big', 1), Buffer.alloc(9 * MiB)]), fields: {} });
    ok('9 Mio (> plafond produit 8 Mio) → 422 MEDIA_TOO_LARGE bilingue',
      tooBig.status === 422 && tooBig.body?.code === 'MEDIA_TOO_LARGE'
      && !!tooBig.body?.message_fr && !!tooBig.body?.message_ar,
      `${tooBig.status} ${tooBig.body?.code}`);
    const wayTooBig = await upload(tokenA, { bytes: Buffer.concat([jpegBytes('huge', 1), Buffer.alloc(13 * MiB)]), fields: {} });
    ok('13 Mio (> plafond dur multer) → 413 JSON `PAYLOAD_TOO_LARGE` (jamais une page HTML de proxy)',
      wayTooBig.status === 413 && wayTooBig.body?.code === 'PAYLOAD_TOO_LARGE' && wayTooBig.contentType.includes('json')
      && !!wayTooBig.body?.message_ar,
      `${wayTooBig.status} ${wayTooBig.body?.code ?? wayTooBig.contentType} ${wayTooBig.text.slice(0, 60)}`);
    ok('Aucune écriture disque après les dépassements de taille', storedFiles().length === before);

    // ── 5. Périmètre : tenant, rôle, lecture croisée ───────────────────────
    console.log('\n5) Périmètre : enfant d’une autre organisation, rôle parent, lecture croisée');
    const crossChild = await upload(tokenA, { bytes: jpegBytes('cross'), fields: { child_id: B.child } });
    ok('`child_id` d’une AUTRE organisation → refus (404/422, jamais un média créé)',
      crossChild.status === 404 || crossChild.status === 422,
      `${crossChild.status} ${crossChild.body?.code}`);
    ok('Aucun média créé pour un enfant hors périmètre', crossChild.body?.id === undefined);

    // Parent rattaché à l'enfant A (child_guardians vivant).
    const parentEmail = `${tag}-parent@test.dz`;
    const parentUser = (await admin.query(
      `INSERT INTO users(email,phone,first_name,last_name,password_hash,status)
       VALUES($1,$2,'P','T',$3,'active') RETURNING id`,
      [parentEmail, `+213${String(Math.floor(1e8 + Math.random() * 9e8))}`, hash],
    )).rows[0].id;
    await admin.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`,
      [A.org, parentUser, parentRole]);
    const guardian = (await admin.query(
      `INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by)
       VALUES($1,$2,'P','T','father',$3) RETURNING id`,
      [A.org, parentUser, A.director],
    )).rows[0].id;
    await admin.query(
      `INSERT INTO child_guardians(organization_id,child_id,guardian_id,is_primary,can_pickup) VALUES($1,$2,$3,true,true)`,
      [A.org, A.child, guardian],
    );
    const tokenParent = await connect(parentEmail);
    const parentUpload = await upload(tokenParent, { bytes: jpegBytes('parent') });
    ok('Rôle parent → 403 (l’upload est réservé au personnel)', parentUpload.status === 403, `${parentUpload.status}`);

    const crossRead = await raw(`/api/v1/media/${up.body?.id}/content`, tokenB);
    ok('Le contenu du média A reste illisible depuis l’organisation B (404)',
      crossRead.res.status === 404, `status=${crossRead.res.status}`);

    const anonUpload = await upload(null, { bytes: jpegBytes('anon') });
    ok('Sans jeton → 401 (aucune écriture anonyme dans le stockage)',
      anonUpload.status === 401, `${anonUpload.status}`);

    // ── 6. Consentement de bout en bout (enfants déclarés en multipart) ────
    console.log('\n6) `children_in_photo` en multipart : publication aux parents');
    const declared = await upload(tokenA, {
      bytes: jpegBytes('consent'),
      fields: { child_id: A.child, children_in_photo: JSON.stringify([A.child]), taken_at: '2026-09-24T08:00:00.000Z' },
    });
    const declaredRow = declared.body?.id
      ? (await admin.query(`SELECT children_in_photo, all_consents_checked FROM media_assets WHERE id=$1`, [declared.body.id])).rows[0]
      : null;
    ok('`children_in_photo` JSON en multipart est bien interprété (sinon publication impossible)',
      declared.status === 201 && declaredRow?.children_in_photo?.length === 1,
      `${declared.status} ${JSON.stringify(declaredRow)}`);
    ok('`all_consents_checked` passe à vrai (condition de `photoConsentsAllowed`)',
      declaredRow?.all_consents_checked === true);

    const badVis = await api('PATCH', `/media/${declared.body?.id}/visibility`, tokenA, { is_visible_to_parents: true });
    ok('Publication SANS consentement → 422 CONSENT_REQUIRED',
      badVis.status === 422 && badVis.body?.code === 'CONSENT_REQUIRED', `${badVis.status} ${badVis.body?.code}`);

    await admin.query(
      `INSERT INTO consent_records(organization_id,guardian_id,child_id,consent_type,granted,granted_at,collected_by)
       VALUES($1,$2,$3,'photo_individual',true,NOW(),$4)`,
      [A.org, guardian, A.child, A.director],
    );
    const goodVis = await api('PATCH', `/media/${declared.body?.id}/visibility`, tokenA, { is_visible_to_parents: true });
    ok('Avec consentement photo → publication acceptée (200)',
      goodVis.status === 200, `${goodVis.status} ${JSON.stringify(goodVis.body)?.slice(0, 100)}`);

    const parentPath = `/api/v1/parent/children/${A.child}/media/${declared.body?.id}/content`;
    const parentRead = await raw(parentPath, tokenParent);
    ok('Le parent lit la photo téléversée par l’API (octets identiques)',
      parentRead.res.status === 200 && parentRead.bytes.equals(jpegBytes('consent')),
      `status=${parentRead.res.status} octets=${parentRead.bytes.length}`);

    await admin.query(
      `INSERT INTO consent_records(organization_id,guardian_id,child_id,consent_type,granted,granted_at,revoked_at,collected_by)
       VALUES($1,$2,$3,'photo_individual',true,NOW(),NOW(),$4)`,
      [A.org, guardian, A.child, A.director],
    );
    const revokedRead = await raw(parentPath, tokenParent);
    ok('Consentement révoqué → 422 CONSENT_REVOKED sans octets',
      revokedRead.res.status === 422 && revokedRead.json?.code === 'CONSENT_REVOKED' && revokedRead.bytes.length < 400,
      `status=${revokedRead.res.status} ${revokedRead.json?.code}`);

    // ── 7. Verrou statique anti-régression ─────────────────────────────────
    console.log('\n7) Verrou statique : lecture non signée, upload signé interdit en production');
    const sources = apiSources();
    const withPresignGet = sources.filter((file) => readFileSync(file, 'utf8').includes('presignGet('));
    ok('Aucun `presignGet(` dans apps/api/src', withPresignGet.length === 0, withPresignGet.join(', '));
    const withSignedUrl = sources.filter((file) => readFileSync(file, 'utf8').includes('getSignedUrl('));
    ok('`getSignedUrl` réservé au seul presign d’upload (media/storage.service.ts)',
      withSignedUrl.length === 1 && withSignedUrl[0].endsWith(join('media', 'storage.service.ts')),
      withSignedUrl.join(', '));
    const storageSource = readFileSync(join(REPO, 'apps/api/src/modules/media/storage.service.ts'), 'utf8');
    ok('Presign d’upload refusé en production sans origine publique (503 UPLOAD_VIA_API_REQUIRED)',
      storageSource.includes('UPLOAD_VIA_API_REQUIRED') && storageSource.includes('S3_PUBLIC_ENDPOINT')
      && /NODE_ENV[^\n]*production/.test(storageSource),
      'garde absente');
    const controllerSource = readFileSync(join(REPO, 'apps/api/src/modules/media/media.controller.ts'), 'utf8');
    ok('La route d’upload existe et est réservée au personnel (`@Roles`)',
      controllerSource.includes("@Post('upload')") && /@Roles\(/.test(controllerSource.split("@Post('upload')")[1] ?? ''));
    const nginx = readFileSync(join(REPO, 'infrastructure/nginx/nginx.conf'), 'utf8');
    ok('nginx autorise le plafond dur multer (12M) : l’API peut répondre un 413 bilingue',
      /client_max_body_size\s+12M;/.test(nginx));

    console.log(`\n${failures.length === 0 ? '✓ Phase 67 validée' : `✗ ${failures.length} échec(s)`}`);
    process.exitCode = failures.length === 0 ? 0 : 1;
  } finally {
    await admin.end();
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
