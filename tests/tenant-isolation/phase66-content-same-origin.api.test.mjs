#!/usr/bin/env node
/**
 * Test API — Phase 66 : le contenu est servi par l'API (same-origin).
 *
 * Contexte (audit 2026-09-24, P0 « F5 »). En production l'API rendait au
 * client des URLs **signées S3** bâties sur `S3_ENDPOINT`
 * (`.env.prod.example` : `http://minio:9000`) alors que MinIO est lié à
 * `127.0.0.1` (docker-compose.prod.yml) : photos, PDF, exports et clips
 * étaient inaccessibles depuis un navigateur ou un téléphone. Les suites
 * d'isolation étaient vertes parce qu'elles vérifiaient l'AUTORISATION de
 * l'URL, jamais sa JOIGNABILITÉ. Décision D1 = option A : le contenu est servi
 * par l'API, same-origin (plan de réparation 2026-09-24).
 *
 * Ce que cette suite prouve, et qu'aucune autre ne prouvait :
 *  1. médias (personnel) : le lien rendu est un CHEMIN RELATIF, et un GET sur
 *     ce chemin rend EXACTEMENT les octets du fichier de stockage ;
 *  2. isolation : le même chemin, appelé par une autre organisation → 404 ;
 *  3. objet absent → 404 explicite (jamais 500, jamais 200 vide) ;
 *  4. clé de stockage piégée (`..` sous le préfixe du tenant) → 422, aucune
 *     lecture hors racine ;
 *  5. photos parent : chemin parent-scopé, re-contrôlé à CHAQUE lecture
 *     (consentement révoqué → 422 CONSENT_REVOKED, pas d'octets) ;
 *  6. exports : flux `attachment`, octets identiques, cross-tenant 404 ;
 *  7. PDF de facture (personnel ET parent) : 200 + application/pdf — plus
 *     jamais la redirection 302 vers l'hôte de stockage (`Location` absente) ;
 *  8. clé de facture hors périmètre du tenant → 422 STORAGE_POLICY ; orpheline
 *     → 404 PDF_NOT_READY ;
 *  9. clips vidéo : `content_url` same-origin pour le backend local ET S3,
 *     plus aucun `download_url` signé ;
 * 10. verrou statique : plus AUCUN `presignGet(` dans l'API, et `getSignedUrl`
 *     n'apparaît que pour l'upload (PUT) — la régression F5 ne peut pas
 *     revenir sans casser ce test.
 *
 * Usage : node tests/tenant-isolation/phase66-content-same-origin.api.test.mjs
 * (apps/api compilé ; PostgreSQL réel ; backend de stockage local + fichiers
 * réels écrits dans STORAGE_LOCAL_DIR).
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const STORE = process.env.STORAGE_LOCAL_DIR ?? '/tmp/pgtest/p66store';
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
    return { status: res.status, body: json, headers: res.headers };
  };

  /**
   * GET brut du contenu : octets + en-têtes + corps JSON éventuel (erreur).
   * `redirect: 'manual'` : une redirection serait précisément le bug F5 —
   * on veut la voir dans la réponse, pas la suivre silencieusement.
   */
  const raw = async (path, token) => {
    // Les liens rendus par l'API sont ABSOLUS depuis la racine
    // (`/api/v1/...`) : les préfixer par `base` produirait `/api/v1/api/v1`.
    const target = path.startsWith('http')
      ? path
      : path.startsWith('/api/')
        ? `http://127.0.0.1:${app.getHttpServer().address().port}${path}`
        : `${base}${path}`;
    const res = await fetch(target, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      redirect: 'manual',
    });
    const bytes = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    let json = null;
    if (type.includes('json')) {
      try { json = JSON.parse(bytes.toString('utf8')); } catch { json = null; }
    }
    return { res, bytes, json };
  };

  const writeStoreFile = (key, bytes) => {
    const filePath = join(STORE, key);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, bytes);
    return bytes;
  };

  const tag = `p66-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    rmSync(STORE, { recursive: true, force: true });
    mkdirSync(STORE, { recursive: true });

    // ── Fixtures : 2 organisations, personnel + parents ─────────────────────
    const directorRole = (await admin.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    const parentRole = (await admin.query(`SELECT id FROM roles WHERE slug='parent_primary'`)).rows[0].id;

    const makeOrg = async (suffix, wilaya) => {
      const org = (await admin.query(
        `INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,$2,$3) RETURNING id`,
        [`${tag}-${suffix}`, `P66 ${suffix}`, wilaya],
      )).rows[0].id;
      const site = (await admin.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await admin.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
      const director = (await admin.query(
        `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`,
        [`${tag}-${suffix}-dir@test.dz`, hash],
      )).rows[0].id;
      await admin.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      const child = (await admin.query(
        `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
         VALUES($1,$2,$3,$4,'Yanis','Test','2024-01-01',$5) RETURNING id`,
        [org, site, room, `P66-${suffix}`, director],
      )).rows[0].id;
      return { org, site, room, director, child };
    };
    const A = await makeOrg('a', '31');
    const B = await makeOrg('b', '16');

    /** Parent rattaché à un enfant (child_guardians vivant). */
    const makeParent = async (scope, { viewJournal, invoices }) => {
      const phone = `+213${String(Math.floor(1e8 + Math.random() * 9e8))}`;
      const email = `${tag}-${scope}-parent@test.dz`;
      const user = (await admin.query(
        `INSERT INTO users(email,phone,first_name,last_name,password_hash,status) VALUES($1,$2,'P','T',$3,'active') RETURNING id`,
        [email, phone, hash],
      )).rows[0].id;
      await admin.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [A.org, user, parentRole]);
      const guardian = (await admin.query(
        `INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by)
         VALUES($1,$2,'P','T','parent',$3) RETURNING id`,
        [A.org, user, A.director],
      )).rows[0].id;
      await admin.query(
        `INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_receive_invoices)
         VALUES($1,$2,$3,$4,$5)`,
        [A.org, scope === 'own' ? A.child : A.child, guardian, viewJournal, invoices],
      );
      return { user, guardian, email };
    };
    const parentA = await makeParent('own', { viewJournal: true, invoices: true });

    // Parent hors organisation : il ne doit jamais atteindre le contenu de A.
    const otherUser = (await admin.query(
      `INSERT INTO users(email,phone,first_name,last_name,password_hash,status) VALUES($1,$2,'Q','T',$3,'active') RETURNING id`,
      [`${tag}-b-parent@test.dz`, `+213${String(Math.floor(1e8 + Math.random() * 9e8))}`, hash],
    )).rows[0].id;
    await admin.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [B.org, otherUser, parentRole]);
    await admin.query(
      `INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by)
       VALUES($1,$2,'Q','T','parent',$3)`,
      [B.org, otherUser, B.director],
    );

    const tokenDirA = (await api('POST', '/auth/login', null, { email: `${tag}-a-dir@test.dz`, password })).body.access_token;
    const tokenDirB = (await api('POST', '/auth/login', null, { email: `${tag}-b-dir@test.dz`, password })).body.access_token;
    const tokenParentA = (await api('POST', '/auth/login', null, { email: parentA.email, password })).body.access_token;
    ok('Jetons A / B / parent émis', Boolean(tokenDirA && tokenDirB && tokenParentA));

    // ── 1. Médias personnel : chemin same-origin + octets réels ─────────────
    console.log('\n1) Média du personnel : lien same-origin, octets réellement servis');
    const photoKey = `${A.org}/media/${tag}-photo.jpg`;
    const photoBytes = Buffer.from(`P66-PHOTO-${randomUUID()}`, 'utf8');
    writeStoreFile(photoKey, photoBytes);
    const media = (await admin.query(
      `INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type,original_filename,file_size_bytes,
                                is_visible_to_parents,all_consents_checked,children_in_photo,exif_stripped)
       VALUES($1,$2,$3,'photo',$4,'image/jpeg','photo.jpg',$5,true,true,$6::uuid[],true) RETURNING id`,
      [A.org, A.child, A.director, photoKey, photoBytes.length, [A.child]],
    )).rows[0].id;

    const download = await api('GET', `/media/${media}/download`, tokenDirA);
    ok('Lien de lecture rendu sous forme de chemin relatif (aucun hôte de stockage)',
      download.status === 200
      && download.body.url === `/api/v1/media/${media}/content`
      && !JSON.stringify(download.body).includes('http')
      && !JSON.stringify(download.body).includes('X-Amz-Signature'),
      JSON.stringify(download.body).slice(0, 160));

    const content = await raw(download.body.url, tokenDirA);
    ok('GET sur le lien rendu → 200 et OCTETS IDENTIQUES au fichier stocké',
      content.res.status === 200 && content.bytes.equals(photoBytes),
      `status=${content.res.status} octets=${content.bytes.length}/${photoBytes.length} corps=${JSON.stringify(content.json)?.slice(0, 200)}`);
    ok('En-têtes de flux : type MIME du média + private/no-store (pas de cache partagé de données de santé)',
      content.res.headers.get('content-type')?.includes('image/jpeg') === true
      && content.res.headers.get('cache-control')?.includes('no-store') === true
      && content.res.headers.get('location') === null,
      `ct=${content.res.headers.get('content-type')} cc=${content.res.headers.get('cache-control')}`);

    const logs = await admin.query(`SELECT COUNT(*)::int AS n FROM media_access_logs WHERE media_id=$1`, [media]);
    ok('Chaque lecture journalisée (loi 25-11)', logs.rows[0].n >= 2, `n=${logs.rows[0].n}`);

    const cross = await raw(`/media/${media}/content`, tokenDirB);
    ok('Autre organisation : le MÊME chemin → 404, aucun octet',
      cross.res.status === 404 && (cross.json?.code !== 'MEDIA_CONTENT_MISSING'),
      `status=${cross.res.status} code=${cross.json?.code}`);
    const unauthenticated = await raw(`/media/${media}/content`, null);
    ok('Sans jeton → 401 (le contenu n’est pas public)', unauthenticated.res.status === 401, `status=${unauthenticated.res.status}`);

    // ── 2. Objet absent + clé piégée ────────────────────────────────────────
    console.log('\n2) Objet absent et clé de stockage piégée');
    rmSync(join(STORE, photoKey));
    const missing = await raw(`/media/${media}/content`, tokenDirA);
    const missingBody = missing.json ?? {};
    ok('Fichier absent du stockage → 404 MEDIA_CONTENT_MISSING (jamais 500)',
      missing.res.status === 404 && missingBody.code === 'MEDIA_CONTENT_MISSING',
      `status=${missing.res.status} code=${missingBody.code}`);
    writeStoreFile(photoKey, photoBytes); // restauré pour la suite

    // Défense en profondeur côté base : la contrainte SQL refuse `..` AVANT
    // même l'insertion (migration 049) — les deux couches sont vérifiées.
    let dbRefused = false;
    try {
      await admin.query(
        `INSERT INTO media_assets(organization_id,child_id,uploaded_by,media_type,storage_key,mime_type,is_visible_to_parents,all_consents_checked,children_in_photo,exif_stripped)
         VALUES($1,$2,$3,'photo',$4,'image/jpeg',true,true,$5::uuid[],true)`,
        [A.org, A.child, A.director, `${A.org}/media/../../evasion.jpg`, [A.child]],
      );
    } catch (error) {
      dbRefused = error.code === '23514';
    }
    ok('PostgreSQL refuse la clé `..` (contrainte media_assets_storage_key_safe)', dbRefused);

    // ── 3. Photos parent : consentement courant à chaque lecture ────────────
    console.log('\n3) Photo côté parent : chemin parent-scopé + consentement courant');
    await api('POST', '/parent/consents', tokenParentA, { child_id: A.child, consent_type: 'photo_individual', granted: true });
    const photos = await api('GET', `/parent/children/${A.child}/media`, tokenParentA);
    const parentUrl = photos.body?.[0]?.url;
    ok('Liste parent : chemin parent-scopé (aucun hôte de stockage)',
      photos.status === 200 && parentUrl === `/api/v1/parent/children/${A.child}/media/${media}/content`,
      `url=${String(parentUrl).slice(0, 120)}`);
    const parentContent = await raw(parentUrl, tokenParentA);
    ok('Le parent reçoit réellement les octets de la photo',
      parentContent.res.status === 200 && parentContent.bytes.equals(photoBytes),
      `status=${parentContent.res.status} octets=${parentContent.bytes.length}`);
    const parentCrossOrg = await raw(parentUrl, tokenDirB);
    ok('Personnel d’une autre organisation sur le chemin parent → 403/404', [403, 404].includes(parentCrossOrg.res.status), `status=${parentCrossOrg.res.status}`);

    await api('POST', '/parent/consents', tokenParentA, { child_id: A.child, consent_type: 'photo_individual', granted: false });
    const afterRevoke = await raw(parentUrl, tokenParentA);
    const afterRevokeBody = afterRevoke.json ?? {};
    ok('Consentement révoqué : le MÊME lien → 422 CONSENT_REVOKED, aucun octet',
      afterRevoke.res.status === 422 && afterRevokeBody.code === 'CONSENT_REVOKED'
        && !afterRevoke.bytes.equals(photoBytes),
      `status=${afterRevoke.res.status} code=${afterRevokeBody.code}`);
    await api('POST', '/parent/consents', tokenParentA, { child_id: A.child, consent_type: 'photo_individual', granted: true });

    // ── 4. Exports Excel ────────────────────────────────────────────────────
    console.log('\n4) Exports : flux `attachment`, octets identiques, isolation');
    const exportKey = `${A.org}/exports/${tag}-attendance.xlsx`;
    const exportBytes = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.from(`P66-EXCEL-${randomUUID()}`)]);
    writeStoreFile(exportKey, exportBytes);
    const exportId = (await admin.query(
      `INSERT INTO report_exports(organization_id,report_type,period_label,status,storage_key,file_size_bytes,requested_by)
       VALUES($1,'attendance','2026-07','done',$2,$3,$4) RETURNING id`,
      [A.org, exportKey, exportBytes.length, A.director],
    )).rows[0].id;

    const exportDl = await raw(`/exports/${exportId}/download`, tokenDirA);
    ok('Export → 200, octets identiques, `attachment`, aucune redirection',
      exportDl.res.status === 200
      && exportDl.bytes.equals(exportBytes)
      && exportDl.res.headers.get('content-disposition')?.startsWith('attachment') === true
      && exportDl.res.headers.get('location') === null,
      `status=${exportDl.res.status} disp=${exportDl.res.headers.get('content-disposition')}`);
    const exportCross = await raw(`/exports/${exportId}/download`, tokenDirB);
    ok('Export d’une autre organisation → 404', exportCross.res.status === 404, `status=${exportCross.res.status}`);

    // ── 5. PDF de facture : personnel + parent ──────────────────────────────
    console.log('\n5) PDF de facture (personnel et parent)');
    const contractRes = await api('POST', '/billing/contracts', tokenDirA, { child_id: A.child, monthly_base_amount: 12000, start_date: '2026-01-01' });
    ok('Fixture : contrat créé', contractRes.status === 201 && Boolean(contractRes.body?.id), JSON.stringify(contractRes.body).slice(0, 140));
    const invoiceRes = await api('POST', '/billing/invoices/generate', tokenDirA, { contract_id: contractRes.body.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' });
    ok('Fixture : facture générée', invoiceRes.status === 201 && Boolean(invoiceRes.body?.id), JSON.stringify(invoiceRes.body).slice(0, 140));
    const invoice = invoiceRes.body;
    const invoiceKey = `${A.org}/invoices/${invoice.id}.pdf`;
    const invoiceBytes = Buffer.from(`%PDF-1.4 P66-INVOICE-${randomUUID()}`);
    writeStoreFile(invoiceKey, invoiceBytes);
    await admin.query(`UPDATE invoices SET pdf_url=$1 WHERE id=$2`, [invoiceKey, invoice.id]);

    const staffPdf = await raw(`/billing/invoices/${invoice.id}/pdf`, tokenDirA);
    ok('Personnel : PDF → 200 application/pdf, octets identiques, AUCUNE redirection 302 vers le stockage',
      staffPdf.res.status === 200
      && staffPdf.res.headers.get('content-type')?.includes('application/pdf') === true
      && staffPdf.res.headers.get('location') === null
      && staffPdf.bytes.equals(invoiceBytes),
      `status=${staffPdf.res.status} location=${staffPdf.res.headers.get('location')}`);
    const parentPdf = await raw(`/parent/invoices/${invoice.id}/pdf`, tokenParentA);
    ok('Parent : PDF → 200, mêmes octets', parentPdf.res.status === 200 && parentPdf.bytes.equals(invoiceBytes), `status=${parentPdf.res.status}`);

    // Clé hors périmètre du tenant : ne doit JAMAIS permettre la lecture d'une
    // facture d'une autre organisation (le worker écrit `${org}/invoices/…`).
    const foreignKey = `${B.org}/invoices/${invoice.id}.pdf`;
    writeStoreFile(foreignKey, Buffer.from('%PDF-1.4 AUTRE-ORGANISATION'));
    await admin.query(`UPDATE invoices SET pdf_url=$1 WHERE id=$2`, [foreignKey, invoice.id]);
    const poisoned = await api('GET', `/billing/invoices/${invoice.id}/pdf`, tokenDirA);
    ok('Clé de facture hors périmètre du tenant → 422 STORAGE_POLICY',
      poisoned.status === 422 && poisoned.body?.code === 'STORAGE_POLICY', `status=${poisoned.status} code=${poisoned.body?.code}`);
    const poisonedParent = await api('GET', `/parent/invoices/${invoice.id}/pdf`, tokenParentA);
    ok('Même garde côté parent → 422 STORAGE_POLICY', poisonedParent.status === 422 && poisonedParent.body?.code === 'STORAGE_POLICY', `status=${poisonedParent.status}`);

    await admin.query(`UPDATE invoices SET pdf_url=$1 WHERE id=$2`, [`${A.org}/invoices/${tag}-orpheline.pdf`, invoice.id]);
    const orphan = await api('GET', `/billing/invoices/${invoice.id}/pdf`, tokenDirA);
    ok('PDF orphelin (clé absente du stockage) → 404 PDF_NOT_READY, jamais 500',
      orphan.status === 404 && orphan.body?.code === 'PDF_NOT_READY', `status=${orphan.status} code=${orphan.body?.code}`);

    // ── 5b. Clé de stockage piégée via `invoices.pdf_url` ──────────────────
    // Vector réel : la migration 049 protège video_clips, media_assets,
    // staff_documents et report_exports — PAS `invoices.pdf_url`. Une clé `..`
    // écrite en base (SQL direct, restauration de sauvegarde, future API) doit
    // donc être arrêtée par le containment de la couche lecture.
    console.log('\n5b) Clé de stockage piégée via invoices.pdf_url');
    const traversalInvoiceRes = await api('POST', '/billing/invoices/generate', tokenDirA, { contract_id: contractRes.body.id, period_year: 2026, period_month: 8, due_date: '2026-09-05' });
    ok('Fixture : seconde facture générée', traversalInvoiceRes.status === 201 && Boolean(traversalInvoiceRes.body?.id));
    const escapeKey = `${A.org}/invoices/../../../${tag}-secret.txt`;
    writeFileSync(`/tmp/${tag}-secret.txt`, 'HORS-RACINE');
    await admin.query(`UPDATE invoices SET pdf_url=$1 WHERE id=$2`, [escapeKey, traversalInvoiceRes.body.id]);
    const escaped = await raw(`/billing/invoices/${traversalInvoiceRes.body.id}/pdf`, tokenDirA);
    ok('Clé `..` (hors racine de stockage) → 422 PATH_TRAVERSAL, aucune lecture',
      escaped.res.status === 422 && escaped.json?.code === 'PATH_TRAVERSAL',
      `status=${escaped.res.status} code=${escaped.json?.code}`);
    ok('Le fichier hors racine n’a pas fuité', !escaped.bytes.includes(Buffer.from('HORS-RACINE')));
    rmSync(`/tmp/${tag}-secret.txt`, { force: true });

    // ── 6. Clips vidéo : même contrat pour les deux backends ────────────────
    console.log('\n6) Clips vidéo : `content_url` same-origin, pas de `download_url`');
    // Fixture : flag organisation (`feature_flags`) — la porte DPIA complète est
    // testée par phase21-video-surveillance ; ici on isole le contrat de lecture.
    await admin.query(`INSERT INTO feature_flags(flag_key, organization_id, is_enabled) VALUES('video_surveillance', $1, true)`, [A.org]);
    const camera = (await api('POST', '/video/cameras', tokenDirA, { name: 'Entrée', zone: 'entrance' })).body;
    const clipKey = `${A.org}/video/${camera.id}/${tag}-clip.mp4`;
    const clipBytes = Buffer.from(`P66-CLIP-${randomUUID()}`);
    writeStoreFile(clipKey, clipBytes);
    const clip = (await api('POST', '/video/clips', tokenDirA, {
      camera_id: camera.id,
      captured_at: new Date(Date.now() - 3600_000).toISOString(),
      storage_key: clipKey,
      storage_backend: 'local',
      mime_type: 'video/mp4',
      size_bytes: clipBytes.length,
      duration_seconds: 30,
    })).body;
    const clipDl = await api('GET', `/video/clips/${clip.id}/download`, tokenDirA);
    ok('Visionnage : `content_url` same-origin et plus aucun `download_url` signé',
      clipDl.status === 200
      && clipDl.body.content_url === `/api/v1/video/clips/${clip.id}/content`
      && clipDl.body.download_url === undefined,
      JSON.stringify(clipDl.body).slice(0, 140));
    const clipContent = await raw(clipDl.body.content_url, tokenDirA);
    ok('GET sur `content_url` → octets identiques au clip stocké',
      clipContent.res.status === 200 && clipContent.bytes.equals(clipBytes),
      `status=${clipContent.res.status} octets=${clipContent.bytes.length}`);

    // Backend S3 (endpoint volontairement injoignable) : la réponse ne doit
    // JAMAIS contenir d'URL signée vers l'hôte de stockage.
    await admin.query(`UPDATE video_clips SET storage_backend='s3' WHERE id=$1`, [clip.id]);
    const s3Dl = await api('GET', `/video/clips/${clip.id}/download`, tokenDirA);
    ok('Clip S3 : toujours un chemin same-origin (aucun `http://minio…` rendu au client)',
      s3Dl.status === 200
      && s3Dl.body.content_url === `/api/v1/video/clips/${clip.id}/content`
      && !JSON.stringify(s3Dl.body).includes('http'),
      JSON.stringify(s3Dl.body).slice(0, 140));

    // ── 7. Verrou statique anti-régression ──────────────────────────────────
    console.log('\n7) Verrou statique : aucune signature d’URL de lecture dans l’API');
    const sources = apiSources();
    const withPresignGet = sources.filter((file) => readFileSync(file, 'utf8').includes('presignGet('));
    ok('Aucun `presignGet(` dans apps/api/src (la signature de lecture a disparu)', withPresignGet.length === 0, withPresignGet.join(', '));
    const withSignedUrl = sources.filter((file) => readFileSync(file, 'utf8').includes('getSignedUrl('));
    ok('`getSignedUrl` réservé au seul upload (media/storage.service.ts)',
      withSignedUrl.length === 1 && withSignedUrl[0].endsWith(join('media', 'storage.service.ts')),
      withSignedUrl.join(', '));
    const presignPutFile = readFileSync(join(REPO, 'apps/api/src/modules/media/storage.service.ts'), 'utf8');
    ok('La signature restante est bien un PUT (upload) et est documentée comme telle',
      presignPutFile.includes('PutObjectCommand') && presignPutFile.includes('lot 2B'));

    console.log(`\n${failures.length === 0 ? '✓ Phase 66 validée' : `✗ ${failures.length} échec(s)`}`);
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
