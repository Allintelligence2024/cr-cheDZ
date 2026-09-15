#!/usr/bin/env node
/**
 * Phase 25 (audit 2026-09, Phase C) — correctifs de sécurité critique.
 * Chaque scénario était ROUGE avant le correctif correspondant :
 *
 *   C1 — contrôle d'accès staff : les 6 @Get de staff.controller.ts
 *        n'avaient pas de @Roles et RolesGuard était fail-open ; getById
 *        renvoyait `sp.*` (salaire, CNAS, NNI, téléphone).
 *        → parent/educator sur GET /staff → 403 ; la réponse director ne
 *          contient plus national_id/cnas_number/base_salary/phone/notes.
 *   C2 — escalade de rôle : addRoleAssignment acceptait super_admin.
 *        → director + role_id de super_admin → 403 ROLE_FORBIDDEN ;
 *          rôle d'une autre organisation → 400 ROLE_NOT_FOUND ;
 *          rôle normal → 201 (contrôle positif).
 *   C4 — confusion de tokens : un token d'invitation (7 j, même secret)
 *        était accepté comme token d'accès par JwtAuthGuard.
 *        → invitation_token en Bearer sur POST /auth/2fa/enable → 401 ;
 *          le token d'invitation reste valide sur accept-invitation ;
 *          les access tokens portent purpose='access' ; un JWT signé avec
 *          le secret access mais purpose≠'access' → 401.
 *   C3 — préfixe tenant sur storage_key : RegisterMediaDto acceptait la
 *        clé d'un autre tenant.
 *        → storage_key préfixé org B → 400 STORAGE_KEY_TENANT_MISMATCH ;
 *          préfixé org A → 201.
 *   C5 — room_id cross-tenant dans l'import d'enfants : la ligne était
 *        insérée avec la salle d'une autre organisation (FK sans check
 *        tenant).
 *        → dry-run et commit rapportent l'erreur ligne par ligne (FR/AR),
 *          les lignes saines sont insérées.
 *
 * Prérequis : DATABASE_URL PostgreSQL réel, API compilée (dist/).
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};

const DEFAULT_JWT_SECRET = 'dev_jwt_secret_change_in_prod_minimum_32_chars';

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', {
    cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit',
  });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  // Exercise the real development handoff; production denial is covered by phase47.
  process.env.NODE_ENV = 'development';
  process.env.EMAIL_PROVIDER = 'none';

  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const api = async (method, path, token, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body && JSON.stringify(body),
    });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : {} };
  };

  const tag = `csec-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    const roles = Object.fromEntries(
      (await db.query(
        `SELECT slug, id FROM roles WHERE slug IN ('director','educator','accountant','parent_primary','super_admin')`,
      )).rows.map((r) => [r.slug, r.id]),
    );

    const mkOrg = async (slug) => {
      const org = (await db.query(
        `INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'C','31') RETURNING id`, [slug],
      )).rows[0].id;
      const site = (await db.query(
        `INSERT INTO sites(organization_id,name_fr) VALUES($1,'Site') RETURNING id`, [org],
      )).rows[0].id;
      const room = (await db.query(
        `INSERT INTO rooms(organization_id,site_id,name_fr) VALUES($1,$2,'Salle') RETURNING id`, [org, site],
      )).rows[0].id;
      const mkUser = async (who, roleSlug) => {
        const u = (await db.query(
          `INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T',$2,'active') RETURNING id`,
          [`${slug}-${who}@test.dz`, hash],
        )).rows[0].id;
        await db.query(
          `INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`,
          [org, u, roles[roleSlug]],
        );
        return u;
      };
      return { org, site, room, mkUser };
    };

    const A = await mkOrg(`${tag}-a`);
    const B = await mkOrg(`${tag}-b`);
    const dirA = await A.mkUser('director', 'director');
    const eduA = await A.mkUser('educator', 'educator');
    const accA = await A.mkUser('accountant', 'accountant');
    const parA = await A.mkUser('parent', 'parent_primary');
    await B.mkUser('director', 'director');

    // Profil staff sensible (org A) — C1 : ce qui ne doit pas fuiter.
    const staffUser = await A.mkUser('staff', 'educator');
    const staffProfile = (await db.query(
      `INSERT INTO staff_profiles
         (organization_id,user_id,employee_number,national_id,cnas_number,qualification,
          hire_date,contract_type,base_salary,phone,emergency_contact_name,emergency_contact_phone,notes)
       VALUES ($1,$2,'EMP-1','199912345678','CNAS-42','Éducatrice',CURRENT_DATE,'permanent',85000.00,'0550000001','Urgence','0550000002','Note interne')
       RETURNING id`, [A.org, staffUser],
    )).rows[0].id;

    const token = async (who, orgTag) => (await api('POST', '/auth/login', null, { email: `${orgTag}-${who}@test.dz`, password })).body.access_token;
    const tDirA = await token('director', `${tag}-a`);
    const tEduA = await token('educator', `${tag}-a`);
    const tAccA = await token('accountant', `${tag}-a`);
    const tParA = await token('parent', `${tag}-a`);
    const tDirB = await token('director', `${tag}-b`);
    ok('JWT émis (director A/B, educator A, accountant A, parent A)', Boolean(tDirA && tDirB && tEduA && tAccA && tParA));

    // ── C1 : contrôle d'accès staff ─────────────────────────────────────────
    console.log('\nC1) Contrôle d\'accès sur /staff');
    const SENSITIVE_KEYS = ['national_id', 'cnas_number', 'base_salary', 'phone', 'notes', 'emergency_contact_name', 'emergency_contact_phone'];
    const listPar = await api('GET', '/staff', tParA);
    ok('Parent : GET /staff → 403', listPar.status === 403, `status=${listPar.status}`);
    const listEdu = await api('GET', '/staff', tEduA);
    ok('Educator : GET /staff → 403', listEdu.status === 403, `status=${listEdu.status}`);
    const listAcc = await api('GET', '/staff', tAccA);
    ok('Accountant : GET /staff → 200', listAcc.status === 200, `status=${listAcc.status}`);
    const listDir = await api('GET', '/staff', tDirA);
    ok('Director : GET /staff → 200', listDir.status === 200, `status=${listDir.status}`);
    ok('GET /staff : aucun champ sensible', listDir.status === 200 && listDir.body.items.every(
      (it) => SENSITIVE_KEYS.every((k) => !(k in it)),
    ), JSON.stringify(listDir.body.items[0] ?? {}).slice(0, 140));
    const onePar = await api('GET', `/staff/${staffProfile}`, tParA);
    ok('Parent : GET /staff/:id → 403', onePar.status === 403, `status=${onePar.status}`);
    const oneEdu = await api('GET', `/staff/${staffProfile}`, tEduA);
    ok('Educator : GET /staff/:id → 403', oneEdu.status === 403, `status=${oneEdu.status}`);
    const oneDir = await api('GET', `/staff/${staffProfile}`, tDirA);
    ok('Director : GET /staff/:id → 200', oneDir.status === 200, `status=${oneDir.status}`);
    ok('GET /staff/:id : aucun champ sensible (salaire/CNAS/NNI/téléphone/notes)',
      oneDir.status === 200 && SENSITIVE_KEYS.every((k) => !(k in oneDir.body)),
      JSON.stringify(oneDir.body).slice(0, 200));
    const expPar = await api('GET', '/staff/documents/expiring', tParA);
    const expDir = await api('GET', '/staff/documents/expiring', tDirA);
    ok('Parent : documents expirants → 403 ; director → 200', expPar.status === 403 && expDir.status === 200, `par=${expPar.status} dir=${expDir.status}`);
    const attPar = await api('GET', `/staff/${staffProfile}/attendance`, tParA);
    const attDir = await api('GET', `/staff/${staffProfile}/attendance`, tDirA);
    ok('Parent : pointage → 403 ; director → 200', attPar.status === 403 && attDir.status === 200, `par=${attPar.status} dir=${attDir.status}`);

    // ── C2 : escalade de rôle via addRoleAssignment ─────────────────────────
    console.log('\nC2) Escalade de rôle');
    const crossRole = (await db.query(
      `INSERT INTO roles(organization_id,name,slug) VALUES($1,'Tuteur','tuteur') RETURNING id`, [B.org],
    )).rows[0].id;
    const toSuper = await api('POST', `/members/${eduA}/roles`, tDirA, { role_id: roles.super_admin });
    ok('Director : assigner super_admin → 403 ROLE_FORBIDDEN',
      toSuper.status === 403 && toSuper.body.code === 'ROLE_FORBIDDEN', `status=${toSuper.status} ${JSON.stringify(toSuper.body)}`);
    const toCross = await api('POST', `/members/${eduA}/roles`, tDirA, { role_id: crossRole });
    ok('Director : assigner un rôle d\'une autre organisation → 400 ROLE_NOT_FOUND',
      toCross.status === 400 && toCross.body.code === 'ROLE_NOT_FOUND', `status=${toCross.status} ${JSON.stringify(toCross.body)}`);
    const toUnknown = await api('POST', `/members/${eduA}/roles`, tDirA, { role_id: randomUUID() });
    ok('Director : rôle inexistant → 400 ROLE_NOT_FOUND',
      toUnknown.status === 400 && toUnknown.body.code === 'ROLE_NOT_FOUND', `status=${toUnknown.status} ${JSON.stringify(toUnknown.body)}`);
    const toAccountant = await api('POST', `/members/${eduA}/roles`, tDirA, { role_id: roles.accountant });
    ok('Director : assigner accountant → 201 (contrôle positif)', toAccountant.status === 201, `status=${toAccountant.status} ${JSON.stringify(toAccountant.body)}`);
    const invSuper = await api('POST', '/invitations', tDirA, { email: `${tag}-inv-super@test.dz`, role_slug: 'super_admin' });
    ok('Invitation super_admin → 403 ROLE_FORBIDDEN (garde existante conservée)',
      invSuper.status === 403 && invSuper.body.code === 'ROLE_FORBIDDEN', `status=${invSuper.status}`);

    // ── C4 : confusion de tokens ────────────────────────────────────────────
    console.log('\nC4) Confusion de tokens (invitation ≠ access)');
    const inv = await api('POST', '/invitations', tDirA, { email: `${tag}-invited@test.dz`, role_slug: 'educator' });
    ok('Invitation créée (token retourné)', inv.status === 201 && Boolean(inv.body.invitation_token), `status=${inv.status}`);
    const invToken = inv.body.invitation_token;

    const abuse = await api('POST', '/auth/2fa/enable', invToken, {});
    ok('Token d\'invitation en Bearer sur /auth/2fa/enable → 401', abuse.status === 401, `status=${abuse.status} ${JSON.stringify(abuse.body)}`);
    const abuse2 = await api('GET', '/staff', invToken);
    ok('Token d\'invitation en Bearer sur GET /staff → 401', abuse2.status === 401, `status=${abuse2.status}`);

    const { JwtService } = require('@nestjs/jwt');
    const accessSecretJwt = new JwtService({ secret: DEFAULT_JWT_SECRET, signOptions: { expiresIn: '15m' } });
    const wrongPurpose = accessSecretJwt.sign({
      sub: dirA, organizationId: A.org, role: 'director', roles: ['director'], purpose: 'invitation',
    });
    const noPurpose = accessSecretJwt.sign({ sub: dirA, organizationId: A.org, role: 'director', roles: ['director'] });
    const wp = await api('POST', '/auth/2fa/enable', wrongPurpose, {});
    ok('JWT (secret access) avec purpose=invitation → 401', wp.status === 401, `status=${wp.status}`);
    const np = await api('POST', '/auth/2fa/enable', noPurpose, {});
    ok('JWT (secret access) sans purpose → 401', np.status === 401, `status=${np.status}`);

    const accept = await api('POST', '/auth/accept-invitation', null, {
      invitation_token: invToken, first_name: 'Invité', last_name: 'Test', password,
    });
    ok('accept-invitation fonctionne toujours → 200 + session', accept.status === 200 && Boolean(accept.body.access_token), `status=${accept.status}`);
    const decoded = JSON.parse(Buffer.from((accept.body.access_token ?? '').split('.')[1] ?? '', 'base64url').toString());
    ok('Access token émis avec purpose=access', decoded.purpose === 'access', JSON.stringify(decoded.purpose));
    const legit = await api('POST', '/auth/2fa/enable', accept.body.access_token, {});
    ok('Access token légitime sur /auth/2fa/enable → 200', legit.status === 200, `status=${legit.status}`);

    // ── C3 : préfixe tenant sur storage_key ─────────────────────────────────
    console.log('\nC3) Préfixe tenant sur storage_key (médias)');
    const crossKey = await api('POST', '/media', tDirA, {
      storage_key: `${B.org}/photo/x.jpg`, mime_type: 'image/jpeg', original_filename: 'x.jpg',
    });
    ok('Register media avec clé de l\'org B → 400 STORAGE_KEY_TENANT_MISMATCH',
      crossKey.status === 400 && crossKey.body.code === 'STORAGE_KEY_TENANT_MISMATCH',
      `status=${crossKey.status} ${JSON.stringify(crossKey.body)}`);
    const ownKey = await api('POST', '/media', tDirA, {
      storage_key: `${A.org}/photo/ok.jpg`, mime_type: 'image/jpeg', original_filename: 'ok.jpg',
    });
    ok('Register media avec clé préfixée org A → 201', ownKey.status === 201, `status=${ownKey.status} ${JSON.stringify(ownKey.body)}`);

    // Voie sync (offline) : même garde, rejet par opération (pas un 500 global).
    const device = await api('POST', '/devices', tDirA, {
      name: 'tablette test', device_fingerprint: 'fp-12345678', platform: 'android',
    });
    ok('Appareil enregistré', device.status === 201 && Boolean(device.body.device_id), `status=${device.status}`);
    const childForSync = (await db.query(
      `INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,gender,created_by,updated_by)
       VALUES ($1,$2,'Sync','Test','2024-01-01','F',$3,$3) RETURNING id`, [A.org, A.site, dirA],
    )).rows[0].id;
    const crossSync = await api('POST', '/sync/push', tDirA, {
      device_id: device.body.device_id,
      operations: [{
        event_id: randomUUID(), client_sequence: 1, schema_version: 1, command: 'add_photo', entity_type: 'media',
        occurred_at_device: new Date().toISOString(),
        payload: { child_id: childForSync, storage_key: `${B.org}/photo/offline.jpg`, mime_type: 'image/jpeg' },
      }],
    });
    ok('Sync push add_photo avec clé de B → opération rejetée (STORAGE_KEY_TENANT_MISMATCH)',
      crossSync.status === 200 && Array.isArray(crossSync.body.rejected)
        && crossSync.body.rejected[0]?.reason === 'STORAGE_KEY_TENANT_MISMATCH',
      JSON.stringify(crossSync.body).slice(0, 160));

    // ── C5 : room_id cross-tenant dans l'import ─────────────────────────────
    console.log('\nC5) Import d\'enfants — room_id cross-tenant');
    const importRows = [
      { first_name_fr: 'Lina', last_name_fr: 'Ok', date_of_birth: '2024-01-01' },
      { first_name_fr: 'Rania', last_name_fr: 'Cross', date_of_birth: '2024-02-02', room_id: B.room },
      { first_name_fr: 'Selma', last_name_fr: 'Ghost', date_of_birth: '2024-03-03', room_id: randomUUID() },
      { first_name_fr: 'Amel', last_name_fr: 'Room', date_of_birth: '2024-04-04', room_id: A.room },
    ];
    const dry = await api('POST', '/children/import', tDirA, { dry_run: true, rows: importRows });
    const dryRoomErrors = dry.body.errors?.filter((e) => e.field === 'room_id') ?? [];
    ok('Dry-run : 2 erreurs room_id (salle de B + salle inconnue), 0 inséré',
      dry.status === 201 && dry.body.inserted === 0 && dryRoomErrors.length === 2
        && dryRoomErrors.every((e) => e.message_fr.length > 0 && e.message_ar.length > 0),
      JSON.stringify(dry.body));
    const commit = await api('POST', '/children/import', tDirA, { dry_run: false, rows: importRows });
    const roomErrors = commit.body.errors?.filter((e) => e.field === 'room_id') ?? [];
    ok('Commit : 2 insérés, 2 erreurs room_id (lignes 2 et 3)',
      commit.status === 201 && commit.body.inserted === 2 && roomErrors.length === 2
        && roomErrors.map((e) => e.row).sort().join(',') === '2,3',
      JSON.stringify(commit.body));
    const crossRef = await db.query(
      `SELECT COUNT(*)::int AS n FROM children WHERE organization_id = $1 AND room_id = $2`, [A.org, B.room],
    );
    ok('Aucun enfant de A ne référence la salle de B', crossRef.rows[0].n === 0, `n=${crossRef.rows[0].n}`);
    const ownRef = await db.query(
      `SELECT COUNT(*)::int AS n FROM children WHERE organization_id = $1 AND room_id = $2 AND reference_number LIKE 'IMP-%'`, [A.org, A.room],
    );
    ok('L\'enfant avec la salle de A est bien inséré', ownRef.rows[0].n === 1, `n=${ownRef.rows[0].n}`);
  } finally {
    await app.close();
    await db.end();
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} échec(s) :`);
    for (const f of failures) console.error(`   - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ phase25 — tous les scénarios C1/C2/C4/C3/C5 sont verts');
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
