#!/usr/bin/env node
/**
 * Phase 22 — Régression des correctifs d'audit externe (docs/PROMPT_AUDIT.md,
 * correctifs docs/PROMPT_FIX_AUDIT.md). Chaque test cible UN défaut listé par
 * l'audit ; la pertinence a été PROUVÉE PAR MUTATION : chaque test est ROUGE
 * sur le code pré-correctif (fichier restauré temporairement) et VERT après.
 *
 * Cas couverts :
 *   1. Init paiement SUCCÈS → payments.gateway_response PERSISTÉE (relecture
 *      SQL) — le défaut majeur : l'UPDATE passait par la pool brute (sans
 *      app.tenant_id, rôle NOBYPASSRLS → 0 ligne silencieuse) ;
 *   2. UPDATE à rowCount=0 (trigger BEFORE UPDATE … RETURN NULL) → 500
 *      EXPLICITE PAYMENT_STATE_ERROR, jamais de « réussi » non persisté ;
 *      chemin erreur (passerelle injoignable) inchangé : 502 + failed ;
 *   3. RegisterClip storage_key avec `..` / chemin absolu / backslash → 422
 *      AVANT tout accès disque, corps bilingue FR/AR ;
 *   4. Cross-tenant : clip du tenant A pointant vers exports/<tenantB>/… →
 *      refus 4xx à l'enregistrement ET au flux (fichier piège JAMAIS lu —
 *      aucun octet renvoyé) ;
 *   5. storage_backend client ≠ serveur → champ IGNORÉ, colonne = réalité
 *      serveur ; NODE_ENV=production (spawn dédié) + STORAGE_BACKEND=local
 *      → 422 STORAGE_POLICY ;
 *   6. Migration 049 : INSERT SQL direct avec `..` ou chemin absolu refusé
 *      par le CHECK DB (défense en profondeur) ;
 *   7. Worker : localPath() (storeFile/deleteFile — purge vidéo DPIA)
 *      rejette toute clé sortant de la racine de stockage.
 *
 * Prérequis : DATABASE_URL PostgreSQL réel (rôle NOBYPASSRLS via appUrl()),
 * API + worker compilés (dist/).
 */
import { execSync, spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Mock de la passerelle SATIM (comme phase14) : vérifie la signature. */
function startMockGateway(secret) {
  const received = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      const canonical = [parsed.merchant_id, parsed.amount, parsed.currency, parsed.invoice_id, parsed.reference].join('|');
      const expected = createHmac('sha256', secret).update(canonical).digest('hex');
      const okSig = req.headers['x-satim-signature'] === expected;
      received.push({ path: req.url, okSig });
      res.writeHead(okSig ? 200 : 401, { 'content-type': 'application/json' });
      res.end(JSON.stringify(okSig
        ? { redirect_url: `https://pay.satim.mock/pay?t=${randomUUID().slice(0, 8)}`, transaction_id: `TX-${received.length}` }
        : { error: 'BAD_SIGNATURE' }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, received }));
  });
}

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);

  const storeDir = process.env.STORAGE_LOCAL_DIR ?? '/tmp/creche-storage-tests';
  mkdirSync(join(storeDir), { recursive: true });

  const satimSecret = `test-secret-${randomUUID()}`;
  const gateway = await startMockGateway(satimSecret);

  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_BACKEND = 'local';
  process.env.STORAGE_LOCAL_DIR = storeDir;
  process.env.SATIM_MERCHANT_ID = 'merchant-mock';
  process.env.SATIM_SECRET = satimSecret;
  process.env.SATIM_GATEWAY_URL = `http://127.0.0.1:${gateway.port}`;

  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const api = async (method, path, token, body, baseUrl = base) => {
    const r = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  const tag = `p22-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  let prodApi = null;
  try {
    const directorRole = (await db.query(`SELECT id FROM roles WHERE slug='director'`)).rows[0].id;
    await db.query(
      `INSERT INTO users(email,first_name,last_name,password_hash,status,is_super_admin) VALUES($1,'S','A',$2,'active',true)`,
      [`${tag}-super@test.dz`, hash],
    );
    const mkOrg = async (slug) => {
      const org = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P','31') RETURNING id`, [slug])).rows[0].id;
      const site = (await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`, [org])).rows[0].id;
      const room = (await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`, [org, site])).rows[0].id;
      const director = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`, [`${slug}-director@test.dz`, hash])).rows[0].id;
      await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [org, director, directorRole]);
      return { org, site, room, director };
    };
    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const tokenDirA = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password })).body.access_token;
    const tokenDirB = (await api('POST', '/auth/login', null, { email: `${tag}-b-director@test.dz`, password })).body.access_token;
    const tokenSuper = (await api('POST', '/auth/login', null, { email: `${tag}-super@test.dz`, password })).body.access_token;
    ok('JWT émis (directeurs A/B + super_admin)', Boolean(tokenDirA && tokenDirB && tokenSuper));

    // ══ 1/2. Facturation — défaut majeur d'audit ══════════════════════════
    console.log('\n1) Init paiement SUCCÈS → gateway_response persistée');
    await db.query(`INSERT INTO feature_flags (flag_key, organization_id, is_enabled) VALUES ('online_payment', $1, true)`, [A.org]);
    const childA = (await db.query(
      `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by)
       VALUES($1,$2,$3,'P22-A1','Yanis','Test','2024-01-01',$4) RETURNING id`,
      [A.org, A.site, A.room, A.director],
    )).rows[0].id;
    const contract = (await api('POST', '/billing/contracts', tokenDirA, { child_id: childA, monthly_base_amount: 10000, start_date: '2026-01-01' })).body;
    const invoice = (await api('POST', '/billing/invoices/generate', tokenDirA, { contract_id: contract.id, period_year: 2026, period_month: 7, due_date: '2026-08-05' })).body;
    ok('Facture A créée (prérequis)', Boolean(invoice.id));

    const init = await api('POST', '/billing/payments/online', tokenDirA, { invoice_id: invoice.id, method: 'cib' });
    ok('Init → 201 + redirect_url (mock)', (init.status === 200 || init.status === 201) && Boolean(init.body.redirect_url), JSON.stringify(init.body).slice(0, 140));
    const persisted = await db.query(`SELECT gateway_response, status FROM payments WHERE id=$1`, [init.body.id]);
    const gw = persisted.rows[0]?.gateway_response;
    const gwObj = typeof gw === 'string' ? JSON.parse(gw) : gw;
    ok('DÉFAUT MAJEUR : gateway_response PERSISTÉE en base (relecture SQL)', Boolean(gwObj && gwObj.redirect_url), `gateway_response=${JSON.stringify(gwObj ?? null).slice(0, 80)}`);
    ok('Statut toujours pending (pas de faux payé)', persisted.rows[0]?.status === 'pending');

    console.log('\n2) UPDATE à 0 ligne → erreur EXPLICITE (jamais de succès silencieux)');
    // Trigger BEFORE UPDATE … RETURN NULL : l'UPDATE ne touche AUCUNE ligne
    // (simulation contrôlée d'un rowCount=0 — perte de contexte, ligne
    // disparue, RLS…). L'assertion rowCount !== 1 DOIT faire échouer la
    // requête avec 500 PAYMENT_STATE_ERROR au lieu de « réussir » en silence.
    await db.query(`CREATE FUNCTION p22_skip_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`);
    await db.query(`CREATE TRIGGER p22_skip_payment_update BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION p22_skip_update()`);
    const initSkipped = await api('POST', '/billing/payments/online', tokenDirA, { invoice_id: invoice.id, method: 'cib' });
    ok('rowCount=0 → 500 PAYMENT_STATE_ERROR (pas de 201 silencieux)', initSkipped.status === 500 && initSkipped.body.code === 'PAYMENT_STATE_ERROR', JSON.stringify(initSkipped.body).slice(0, 140));
    ok('Erreur bilingue FR + AR', Boolean(initSkipped.body.message_fr && initSkipped.body.message_ar));
    await db.query(`DROP TRIGGER p22_skip_payment_update ON payments`);
    await db.query(`DROP FUNCTION p22_skip_update()`);
    const skippedRow = await db.query(`SELECT gateway_response, status FROM payments WHERE id=$1`, [initSkipped.body.id ?? null]);
    ok('Paiement non confirmé (pas de faux état)', !skippedRow.rows[0] || skippedRow.rows[0].status !== 'confirmed');

    console.log('\n2b) Chemin ERREUR inchangé (502 + failed persisté)');
    const invoice2 = (await api('POST', '/billing/invoices/generate', tokenDirA, { contract_id: contract.id, period_year: 2026, period_month: 8, due_date: '2026-09-05' })).body;
    const savedUrl = process.env.SATIM_GATEWAY_URL;
    process.env.SATIM_GATEWAY_URL = 'http://127.0.0.1:1';
    const down = await api('POST', '/billing/payments/online', tokenDirA, { invoice_id: invoice2.id, method: 'cib' });
    process.env.SATIM_GATEWAY_URL = savedUrl;
    ok('Passerelle injoignable → 502 PAYMENT_GATEWAY_ERROR', down.status === 502 && down.body.code === 'PAYMENT_GATEWAY_ERROR');
    const failedRow = (await db.query(`SELECT status, gateway_response FROM payments WHERE external_reference IS NOT NULL AND organization_id=$1 ORDER BY created_at DESC LIMIT 1`, [A.org])).rows[0];
    ok('Paiement failed + erreur persistée', failedRow?.status === 'failed' && Boolean(failedRow.gateway_response));

    // ══ Préparation vidéo (DPIA + flag, comme phase21) ═══════════════════
    const enableVideoFor = async (orgId, tokenDir) => {
      const registry = (await api('GET', '/privacy/registry', tokenDir)).body;
      const video = registry.find((r) => r.processing_name === 'Vidéosurveillance des locaux');
      const dpia = await api('POST', '/privacy/dpias', tokenDir, {
        processing_registry_id: video.id,
        risk_assessment: { level: 'moderate', reference: 'docs/regulatory/DPIA-VIDEOSURVEILLANCE.md' },
        mitigation_measures: ['accès restreint', 'purge 30 j', 'visionnage journalisé'],
      });
      await api('POST', `/privacy/dpias/${dpia.body.id}/approve`, tokenDir, {});
      await api('POST', '/support/flags/video_surveillance', tokenSuper, { organization_id: orgId, is_enabled: true });
    };
    await enableVideoFor(A.org, tokenDirA);
    await enableVideoFor(B.org, tokenDirB);
    const cam = await api('POST', '/video/cameras', tokenDirA, { name: 'Entrée p22', zone: 'entrance' });
    ok('Caméra A créée (prérequis)', cam.status === 201 || cam.status === 200, JSON.stringify(cam.body).slice(0, 100));
    const capturedAt = new Date(Date.now() - 3600_000).toISOString();

    // ══ 3. Clés hostiles rejetées AVANT tout accès disque ═════════════════
    console.log('\n3) storage_key hostiles → 422 avant tout accès disque');
    const hostile = [
      ['traversal ..', `${A.org}/video/${cam.body.id}/../../etc/passwd`],
      ['chemin absolu', `/etc/passwd`],
      ['backslash', `${A.org}/video/${cam.body.id}\\..\\secret.mp4`],
    ];
    for (const [label, key] of hostile) {
      const r = await api('POST', '/video/clips', tokenDirA, {
        camera_id: cam.body.id, captured_at: capturedAt, storage_key: key, mime_type: 'video/mp4', size_bytes: 10,
      });
      // 400 = rejet DTO (ValidationPipe — convention du repo, cf. phase21
      // « zone invalide → 400 ») ; 422 = politique serveur (AppError
      // PATH_TRAVERSAL/STORAGE_POLICY). L'invariant audit : refus 4xx AVANT
      // tout accès disque, corps bilingue — on n'exige pas un statut unique
      // pour ne pas réécrire la convention DTO du projet.
      ok(`${label} → 4xx AVANT tout accès disque (DTO 400 ou politique 422), pas d'insertion`, r.status === 400 || r.status === 422, `status=${r.status} code=${r.body.code}`);
      ok(`${label} → corps bilingue FR/AR`, Boolean(r.body.message_fr && r.body.message_ar), JSON.stringify(r.body).slice(0, 120));
    }
    const hostileRows = await db.query(`SELECT COUNT(*)::int AS n FROM video_clips WHERE organization_id=$1`, [A.org]);
    ok('Aucune ligne insérée pour les clés hostiles', hostileRows.rows[0].n === 0, `n=${hostileRows.rows[0].n}`);

    // ══ 4. Cross-tenant : exports/<B>/… jamais lu par A ══════════════════
    console.log('\n4) Cross-tenant storage (fichier piège du tenant B)');
    const honeyKey = `exports/${B.org}/honey.mp4`;
    const honeyBytes = Buffer.from(`HONEYPOT-SECRET-${randomUUID()}`);
    mkdirSync(dirname(join(storeDir, honeyKey)), { recursive: true });
    writeFileSync(join(storeDir, honeyKey), honeyBytes);
    const crossReg = await api('POST', '/video/clips', tokenDirA, {
      camera_id: cam.body.id, captured_at: capturedAt, storage_key: honeyKey, mime_type: 'video/mp4', size_bytes: honeyBytes.length,
    });
    ok('A enregistre un clip vers exports/<B>/… → 422 STORAGE_POLICY', crossReg.status === 422 && crossReg.body.code === 'STORAGE_POLICY', JSON.stringify(crossReg.body).slice(0, 140));
    ok('Erreur bilingue FR + AR', Boolean(crossReg.body.message_fr && crossReg.body.message_ar));
    // Ligne injectée en SQL direct (simule une corruption pré-049) : le flux
    // de contenu DOIT refuser AVANT de toucher le disque — aucun octet du
    // fichier piège ne peut fuiter.
    const poisoned = (await db.query(
      `INSERT INTO video_clips (organization_id, camera_id, captured_at, storage_backend, storage_key, mime_type, uploaded_by)
       VALUES ($1,$2,$3,'local',$4,'video/mp4',$5) RETURNING id`,
      [A.org, cam.body.id, capturedAt, honeyKey, A.director],
    )).rows[0].id;
    const contentRes = await fetch(`${base}/video/clips/${poisoned}/content`, { headers: { authorization: `Bearer ${tokenDirA}` } });
    const contentText = await contentRes.text();
    let contentBody = {};
    try { contentBody = JSON.parse(contentText); } catch { /* corps binaire */ }
    ok('Flux du clip empoisonné → 4xx (STORAGE_POLICY/PATH_TRAVERSAL), AUCUN octet lu',
      contentRes.status === 422 && ['STORAGE_POLICY', 'PATH_TRAVERSAL'].includes(contentBody.code ?? '') && !contentText.includes('HONEYPOT'),
      `status=${contentRes.status} body=${JSON.stringify(contentBody).slice(0, 120)}`);
    ok('Fichier piège intact sur disque', readFileSync(join(storeDir, honeyKey), 'utf8').includes('HONEYPOT'));
    await db.query(`DELETE FROM video_clips WHERE id=$1`, [poisoned]);

    console.log('\n4b) Export empoisonné (report_exports.storage_key → exports/<B>/…)');
    const poisonedExport = (await db.query(
      `INSERT INTO report_exports (organization_id, report_type, period_label, status, storage_key, requested_by)
       VALUES ($1,'attendance','2026-07','done',$2,$3) RETURNING id`,
      [A.org, honeyKey, A.director],
    )).rows[0].id;
    // Lecture brute (le téléchargement légitime renvoie un binaire xlsx) :
    // l'invariant est « AUCUN octet du fichier piège n'est servi ».
    const dlPoisonedRes = await fetch(`${base}/exports/${poisonedExport}/download`, { headers: { authorization: `Bearer ${tokenDirA}` } });
    const dlPoisonedText = await dlPoisonedRes.text();
    let dlPoisonedBody = {};
    try { dlPoisonedBody = JSON.parse(dlPoisonedText); } catch { /* binaire = fuite */ }
    ok('Download de l’export empoisonné → 422 STORAGE_POLICY, aucun octet du fichier piège',
      dlPoisonedRes.status === 422 && dlPoisonedBody.code === 'STORAGE_POLICY' && !dlPoisonedText.includes('HONEYPOT'),
      `status=${dlPoisonedRes.status} code=${dlPoisonedBody.code} leaked=${dlPoisonedText.includes('HONEYPOT')}`);
    await db.query(`DELETE FROM report_exports WHERE id=$1`, [poisonedExport]);

    // ══ 5. storage_backend : le serveur décide ════════════════════════════
    console.log('\n5) storage_backend dérivé du serveur (champ client ignoré)');
    const goodKey = `${A.org}/video/${cam.body.id}/ok.mp4`;
    const regClientS3 = await api('POST', '/video/clips', tokenDirA, {
      camera_id: cam.body.id, captured_at: capturedAt, storage_key: goodKey,
      storage_backend: 's3', mime_type: 'video/mp4', size_bytes: 10,
    });
    ok('Client envoie s3 alors que le serveur est local → 201 (champ ignoré, pas 422)', regClientS3.status === 201, JSON.stringify(regClientS3.body).slice(0, 120));
    ok('Colonne = réalité SERVEUR (local)', regClientS3.body.storage_backend === 'local', `col=${regClientS3.body.storage_backend}`);

    console.log('\n5b) NODE_ENV=production + STORAGE_BACKEND=local → refus (spawn dédié)');
    const prodPort = 20000 + Math.floor(Math.random() * 20000);
    prodApi = spawn('node', ['apps/api/dist/main.js'], {
      cwd: repo,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        STORAGE_BACKEND: 'local',
        STORAGE_LOCAL_DIR: storeDir,
        APP_PORT: String(prodPort),
        SENTRY_DSN: '',
      },
      stdio: 'ignore',
    });
    let prodBase = null;
    for (let i = 0; i < 40 && !prodBase; i += 1) {
      await sleep(250);
      try {
        const probe = await fetch(`http://127.0.0.1:${prodPort}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        if (probe.status) prodBase = `http://127.0.0.1:${prodPort}/api/v1`;
      } catch { /* pas encore prêt */ }
    }
    ok('API production (spawn) démarrée', Boolean(prodBase));
    if (prodBase) {
      const prodToken = (await api('POST', '/auth/login', null, { email: `${tag}-a-director@test.dz`, password }, prodBase)).body.access_token;
      const prodReg = await api('POST', '/video/clips', prodToken, {
        camera_id: cam.body.id, captured_at: capturedAt, storage_key: `${A.org}/video/${cam.body.id}/prod.mp4`, mime_type: 'video/mp4', size_bytes: 10,
      }, prodBase);
      ok('local en production → 422 STORAGE_POLICY (bilingue)', prodReg.status === 422 && prodReg.body.code === 'STORAGE_POLICY' && Boolean(prodReg.body.message_fr && prodReg.body.message_ar), JSON.stringify(prodReg.body).slice(0, 140));
    }
    prodApi.kill(); prodApi = null;

    // ══ 6. Migration 049 — CHECK DB de défense en profondeur ══════════════
    console.log('\n6) Migration 049 : CHECK SQL sur storage_key');
    const badKeys = [
      `${A.org}/video/${cam.body.id}/../../etc/passwd`,
      `/absolu/secret.mp4`,
      `back\\slash.mp4`,
    ];
    let rejected = 0;
    for (const k of badKeys) {
      try {
        await db.query(
          `INSERT INTO video_clips (organization_id, camera_id, captured_at, storage_backend, storage_key, uploaded_by)
           VALUES ($1,$2,$3,'local',$4,$5)`,
          [A.org, cam.body.id, capturedAt, k, A.director],
        );
      } catch (e) {
        if (/check constraint|video_clips_storage_key_safe/i.test(String(e.message))) rejected += 1;
        else console.error('  erreur inattendue:', e.message);
      }
    }
    ok('INSERT SQL direct avec ../absolu/backslash → refusés par le CHECK (3/3)', rejected === 3, `rejetés=${rejected}/3`);
    let mediaRejected = 0;
    try {
      await db.query(
        `INSERT INTO media_assets (organization_id, uploaded_by, media_type, storage_key, mime_type)
         VALUES ($1,$2,'photo','../escape.jpg','image/jpeg')`,
        [A.org, A.director],
      );
    } catch (e) {
      mediaRejected = /media_assets_storage_key_safe/i.test(String(e.message)) ? 1 : 0;
    }
    ok('media_assets : clé avec .. refusée par le CHECK', mediaRejected === 1);
    const validRow = await db.query(
      `INSERT INTO video_clips (organization_id, camera_id, captured_at, storage_backend, storage_key, uploaded_by)
       VALUES ($1,$2,$3,'local',$4,$5) RETURNING id`,
      [A.org, cam.body.id, capturedAt, `${A.org}/video/${cam.body.id}/valide.mp4`, A.director],
    );
    ok('Clé valide acceptée (CHECK non bloquant)', Boolean(validRow.rows[0].id));
    // Nettoyage des lignes vidéo de test.
    await db.query(`DELETE FROM video_clips WHERE organization_id = ANY($1)`, [[A.org, B.org]]);

    // ══ 7. Garde worker localPath (storeFile/deleteFile — purge vidéo) ═════
    console.log('\n7) Worker : localPath rejette toute clé sortant de la racine');
    const { localPath, storeFile } = await import(pathToFileURL(join(repo, 'apps/worker/dist/pdf.js')).href);
    // Discriminant : on exige le message STORAGE_KEY_ESCAPE du garde (et non
    // n'importe quelle exception — ex. TypeError si le garde était absent).
    ok('localPath existe (garde présente dans le worker compilé)', typeof localPath === 'function');
    let escapeMsg = null;
    try { localPath('../../etc/passwd'); } catch (e) { escapeMsg = String(e.message); }
    ok('localPath("../../etc/passwd") lève STORAGE_KEY_ESCAPE (escape)', /STORAGE_KEY_ESCAPE/.test(escapeMsg ?? ''), escapeMsg ?? 'aucune erreur');
    let absMsg = null;
    try { localPath('/etc/passwd'); } catch (e) { absMsg = String(e.message); }
    ok('localPath("/etc/passwd") lève STORAGE_KEY_ESCAPE (absolu)', /STORAGE_KEY_ESCAPE/.test(absMsg ?? ''), absMsg ?? 'aucune erreur');
    ok('localPath(clé sûre) renvoie le chemin absolu DANS la racine', localPath('org/video/a.mp4') === join(storeDir, 'org/video/a.mp4'), localPath('org/video/a.mp4'));
    const safeKey = `${A.org}/exports/p22-worker.bin`;
    await storeFile(safeKey, Buffer.from('OK'), 'application/octet-stream');
    ok('storeFile(clé sûre) écrit bien DANS la racine', existsSync(join(storeDir, safeKey)));
    const escapeName = `escape-${randomUUID().slice(0, 6)}.bin`;
    let storeEscape = false;
    try { await storeFile(`../${escapeName}`, Buffer.from('X'), 'application/octet-stream'); } catch { storeEscape = true; }
    ok('storeFile(clé en évasion) lève — aucune écriture hors racine', storeEscape && !existsSync(join(dirname(storeDir), escapeName)));
  } finally {
    gateway.server.close();
    if (prodApi) prodApi.kill();
    try {
      await db.query(`DROP TRIGGER IF EXISTS p22_skip_payment_update ON payments`);
      await db.query(`DROP FUNCTION IF EXISTS p22_skip_update()`);
      const orgs = `SELECT id FROM organizations WHERE slug LIKE 'p22-%'`;
      await db.query(`DELETE FROM video_clips WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM video_cameras WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM feature_flags WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM payment_allocations WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM payments WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM invoice_lines WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM invoices WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM contracts WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM children WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM data_access_logs WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM privacy_dpias WHERE organization_id IN (${orgs}) OR approved_by IN (SELECT id FROM users WHERE email LIKE 'p22-%')`);
      await db.query(`DELETE FROM audit_logs WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p22-%')`);
      await db.query(`DELETE FROM background_jobs WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'p22-%')`);
      await db.query(`DELETE FROM memberships WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM org_sequences WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM rooms WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM sites WHERE organization_id IN (${orgs})`);
      await db.query(`DELETE FROM users WHERE email LIKE 'p22-%'`);
      await db.query(`DELETE FROM organizations WHERE slug LIKE 'p22-%'`);
    } catch (cleanupError) {
      console.error('Nettoyage phase22 partiel :', cleanupError.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 22 correctifs d'audit : ${failures.length} assertion(s) — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log("\n✓ Phase 22 correctifs d’audit validés (6 cas) sur PostgreSQL réel NOBYPASSRLS.");
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
