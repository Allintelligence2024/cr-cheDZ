#!/usr/bin/env node
/**
 * Phase 64 (remédiation 2026-09-21, R14/F12) — tokens web en cookie httpOnly.
 *
 * Contexte : les SPA admin-web / support-consol utilisaient localStorage
 * pour stocker access + refresh tokens — un XSS exfiltrait la session
 * complète. R14 déplace le refresh dans un cookie httpOnly positionné
 * par /auth/login (web_client=true) ; l'access reste en mémoire (state).
 *
 * Cas couverts :
 *   1. login web_client=true → Set-Cookie __Host-creche_refresh présent
 *      (en prod) ou creche_refresh (en dev), httpOnly, SameSite=Lax,
 *      Path=/api/v1/auth ; refresh_token toujours présent dans le body
 *      (rétro-compat mobiles).
 *   2. login sans web_client (mobile) → AUCUN cookie positionné, body
 *      inchangé (compat Flutter).
 *   3. refresh AVEC cookie → l'API lit le cookie, tourne le refresh,
 *      repose le nouveau cookie. Body contient le nouvel access_token.
 *   4. logout → cookie effacé (Set-Cookie avec Max-Age=0 / expires passé),
 *      même si aucun body envoyé.
 *   5. refresh SANS cookie ni body → 401 (le client web n'a pas son
 *      cookie = session expirée ; on n'invente pas de fallback).
 *
 * Prérequis : PG18 réel, API compilée (dist/), DATABASE_URL.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const ok = (n, v, detail) => {
  console.log(`${v ? '✓' : '✗'} ${n}${!v && detail ? ` — ${detail}` : ''}`);
  if (!v) failures.push(n);
};

const main = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL requis (PostgreSQL réel)');
  execSync('node scripts/migrate.mjs --reset && node scripts/migrate.mjs && node scripts/seed.mjs', { cwd: repo, env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await ensureAppRole(db);
  process.env.DATABASE_URL = appUrl();
  process.env.RATE_LIMIT_DISABLED = 'true';
  process.env.NODE_ENV = 'test';
  const { createApp } = await import(pathToFileURL(join(repo, 'apps/api/dist/app.factory.js')).href);
  const app = await createApp();
  await app.listen(0);
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;

  // Helper : fetch qui retourne status, body, headers (Set-Cookie y compris).
  const rawFetch = async (path, init = {}, cookies = null) => {
    const headers = { 'content-type': 'application/json', ...(init.headers ?? {}) };
    if (cookies) headers.cookie = cookies;
    const r = await fetch(base + path, {
      ...init,
      headers,
    });
    const text = await r.text();
    let body = null;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { _raw: text }; }
    return { status: r.status, body, setCookie: r.headers.get('set-cookie') };
  };

  const tag = `auth-${randomUUID().slice(0, 8)}`;
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 12);

  try {
    // Préparer un utilisateur de test (director).
    const roles = Object.fromEntries(
      (await db.query(`SELECT slug, id FROM roles WHERE slug IN ('director')`)).rows.map((r) => [r.slug, r.id]),
    );
    const orgId = (await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'R','31') RETURNING id`, [`${tag}-org`])).rows[0].id;
    const userId = (await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'U','T',$2,'active') RETURNING id`, [`${tag}@x.dz`, hash])).rows[0].id;
    await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`, [orgId, userId, roles.director]);

    // ── Cas 1 : login web_client=true → cookie httpOnly posé
    console.log('\n1) login web_client=true → cookie posé');
    const r1 = await rawFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `${tag}@x.dz`, password, web_client: true }),
    });
    ok('login 200', r1.status === 200, `status=${r1.status}`);
    ok('access_token dans body', typeof r1.body.access_token === 'string', JSON.stringify(r1.body).slice(0, 80));
    ok('refresh_token dans body (rétro-compat)', typeof r1.body.refresh_token === 'string', '');
    const cookieLine = r1.setCookie ?? '';
    ok('Set-Cookie présent', cookieLine.includes('creche_refresh'), `header=${cookieLine.slice(0, 100)}`);
    ok('cookie httpOnly', /HttpOnly/i.test(cookieLine), `header=${cookieLine}`);
    ok('cookie SameSite=Lax', /SameSite=Lax/i.test(cookieLine), `header=${cookieLine}`);
    ok('cookie Path=/api/v1/auth', /Path=\/api\/v1\/auth/i.test(cookieLine), `header=${cookieLine}`);
    const cookieValue = cookieLine.match(/creche_refresh=([^;]+)/)?.[1];
    ok('cookie non vide et >= 16 chars (JWT-like)', cookieValue && cookieValue.length >= 16, `len=${cookieValue?.length ?? 0}`);

    // ── Cas 2 : login SANS web_client → PAS de cookie (mobile Flutter)
    console.log('\n2) login mobile (web_client absent) → PAS de cookie');
    const r2 = await rawFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: `${tag}@x.dz`, password }),
    });
    ok('login 200 mobile', r2.status === 200, `status=${r2.status}`);
    ok('PAS de cookie en mode mobile', r2.setCookie === null || !r2.setCookie.includes('creche_refresh'), `setCookie=${r2.setCookie}`);
    ok('refresh_token dans body (mobile lit du body)', typeof r2.body.refresh_token === 'string', '');

    // ── Cas 3 : refresh AVEC cookie → API lit le cookie, tourne
    console.log('\n3) refresh AVEC cookie → access_token tourné, cookie reposé');
    const cookieHeader = `creche_refresh=${cookieValue}`;
    const r3 = await rawFetch('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    }, cookieHeader);
    ok('refresh 200', r3.status === 200, `status=${r3.status}`);
    ok('nouvel access_token', typeof r3.body.access_token === 'string' && r3.body.access_token.length >= 16, '');
    ok('nouveau refresh_token (rotation)', typeof r3.body.refresh_token === 'string' && r3.body.refresh_token !== cookieValue, '');
    const r3Cookie = r3.setCookie ?? '';
    ok('cookie reposé (rotation)', r3Cookie.includes('creche_refresh'), `header=${r3Cookie.slice(0, 100)}`);
    const newCookieValue = r3Cookie.match(/creche_refresh=([^;]+)/)?.[1];

    // ── Cas 4 : logout → cookie effacé
    console.log('\n4) logout → cookie effacé');
    // /auth/logout exige un access_token valide (via @CurrentUser). On
    // utilise l'access_token reçu du refresh précédent.
    const r4 = await rawFetch('/auth/logout', {
      method: 'POST',
      headers: { authorization: `Bearer ${r3.body.access_token}` },
      body: JSON.stringify({}),
    }, `creche_refresh=${newCookieValue}`);
    ok('logout 204', r4.status === 204, `status=${r4.status}`);
    const r4Cookie = r4.setCookie ?? '';
    ok('Set-Cookie logout efface (Max-Age=0 ou expires passé)',
      /Max-Age=0/i.test(r4Cookie) || /expires=Thu, 01 Jan 1970/i.test(r4Cookie),
      `header=${r4Cookie.slice(0, 100)}`);

    // ── Cas 5 : refresh SANS cookie ni body → 401
    console.log('\n5) refresh sans cookie ni body → 401');
    const r5 = await rawFetch('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    ok('refresh sans cookie → 401', r5.status === 401, `status=${r5.status}`);
  } finally {
    try {
      await db.query(`DELETE FROM audit_logs WHERE user_id=$1`, [userId]);
      await db.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
      await db.query(`DELETE FROM memberships WHERE organization_id=$1`, [orgId]);
      await db.query(`DELETE FROM users WHERE email=$1`, [`${tag}@x.dz`]);
      await db.query(`DELETE FROM organizations WHERE slug=$1`, [`${tag}-org`]);
    } catch (e) {
      console.error('cleanup :', e.message);
    }
    await app.close();
    await db.end();
  }

  if (failures.length) {
    console.error(`\nÉCHEC Phase 64 auth-cookies : ${failures.length} — ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\n✓ Phase 64 auth-cookies validée (R14) sur PostgreSQL réel.');
};

main().catch((e) => { console.error(e.stack); process.exit(1); });
