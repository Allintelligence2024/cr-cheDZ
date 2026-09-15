#!/usr/bin/env node
// G1: live HTTP + PostgreSQL; lock barriers force the old counter race.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import { ensureAppRole, appUrl } from './helpers.mjs';

const dbUrl = process.env.DATABASE_URL; assert.ok(new URL(dbUrl).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: dbUrl }); await db.connect();
let app, pool, proxy, passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log(`✓ ${name}`); } catch (e) { failed++; console.error(`✗ ${name}: ${e.stack}`); } }
try {
  await ensureAppRole(db);
  const password = 'Synthetic-G1-only!', pin = '1234';
  const hash = await bcrypt.hash(password, 4), pinHash = await bcrypt.hash(pin, 4);
  const org = (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G1','31') RETURNING id", [randomUUID()])).rows[0].id;
  const makeUser = async () => {
    const email = `${randomUUID()}@test.invalid`, phone = `+213${String(Math.floor(Math.random() * 1e9)).padStart(9,'0')}`;
    const id = (await db.query("INSERT INTO users(email,phone,first_name,last_name,password_hash,parent_pin_hash,status) VALUES($1,$2,'G1','Test',$3,$4,'active') RETURNING id", [email, phone, hash, pinHash])).rows[0].id;
    await db.query("INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug='parent_primary'", [org,id]);
    await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'G1','Test','parent',$2)", [org,id]);
    return { id,email,phone };
  };
  const u = await makeUser();
  Object.assign(process.env, { DATABASE_URL: appUrl(), NODE_ENV:'test', MAX_LOGIN_ATTEMPTS:'5', ACCOUNT_LOCK_MINUTES:'15', RATE_LIMIT_DISABLED:'true', SENTRY_DSN:'' });
  const { createApp } = await import('../../apps/api/dist/app.factory.js');
  const { PG_POOL } = await import('../../apps/api/dist/shared/database/database.provider.js');
  app = await createApp(); pool = app.get(PG_POOL); await app.listen(0,'127.0.0.1');
  const port = app.getHttpServer().address().port;
  const req = async (path,body) => {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/auth/${path}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(20000) });
    return { status:r.status, body:await r.json() };
  };
  const login = (user=u, pass=password) => req('login', {email:user.email,password:pass});
  const pinLogin = (user=u, value=pin) => req('parent/pin/login', {phone:user.phone,pin:value});
  const otp = async (user=u) => { const r = await req('parent/otp/request',{phone:user.phone}); assert.equal(r.status,200); return r.body.development_code; };
  const verify = (code,user=u) => req('parent/otp/verify',{phone:user.phone,code});
  const sessions = async user => Number((await db.query('SELECT count(*) n FROM sessions WHERE user_id=$1',[user.id])).rows[0].n);
  const reset = async (status='active') => db.query('UPDATE users SET status=$2,failed_attempts=0,locked_until=NULL,deleted_at=NULL WHERE id=$1',[u.id,status]);
  const state = async user => (await db.query('SELECT failed_attempts,locked_until FROM users WHERE id=$1',[user.id])).rows[0];
  for (const status of ['active','pending','suspended']) {
    for (const channel of ['password','pin','otp']) await check(`${status}: ${channel} session boundary`, async () => {
      await reset(status); const before = await sessions(u);
      const r = channel==='password' ? await login() : channel==='pin' ? await pinLogin() : await verify(await otp());
      assert.equal(r.status,status==='suspended'?403:200,JSON.stringify(r.body));
      assert.equal(await sessions(u),before+(status==='suspended'?0:1));
      if(status==='suspended') assert.equal(r.body.access_token,undefined); else assert.ok(r.body.refresh_token);
    });
  }
  await check('numeric BCRYPT_ROUNDS environment supports OTP issuance',async()=>{
    process.env.BCRYPT_ROUNDS='4';
    try { assert.equal((await req('parent/otp/request',{phone:u.phone})).status,200); }
    finally { delete process.env.BCRYPT_ROUNDS; }
  });
  const publicError = r => ({status:r.status,code:r.body.code,fr:r.body.message_fr,ar:r.body.message_ar});
  await check('wrong password does not disclose suspended account',async()=>{
    await reset('suspended'); const unknown = await login({email:`${randomUUID()}@test.invalid`},'Wrong-password');
    assert.deepEqual(publicError(await login(u,'Wrong-password')),publicError(unknown));
  });
  await check('wrong password does not disclose locked account',async()=>{
    await reset(); await db.query("UPDATE users SET locked_until=NOW()+INTERVAL '15 minutes' WHERE id=$1",[u.id]);
    assert.deepEqual(publicError(await login(u,'Wrong-password')),publicError(await login({email:`${randomUUID()}@test.invalid`},'Wrong-password')));
  });
  for (const channel of ['password','pin','otp']) await check(`locked: ${channel} cannot create session`,async()=>{
    await reset(); await db.query("UPDATE users SET locked_until=NOW()+INTERVAL '15 minutes' WHERE id=$1",[u.id]);
    const before=await sessions(u), r=channel==='password'?await login():channel==='pin'?await pinLogin():await verify(await otp());
    assert.equal(r.status,423); assert.equal(await sessions(u),before);
  });
  await check('PIN failures cause persistent account lockout',async()=>{
    await reset(); for(let i=0;i<5;i++)assert.equal((await pinLogin(u,'9999')).status,401);
    const row=await state(u); assert.ok(row.failed_attempts>=5); assert.ok(row.locked_until>new Date()); assert.equal((await pinLogin()).status,423);
  });
  await check('expired lock starts a new failure window',async()=>{
    await reset(); await db.query("UPDATE users SET failed_attempts=5,locked_until=NOW()-INTERVAL '1 minute' WHERE id=$1",[u.id]);
    assert.equal((await login(u,'Wrong-password')).status,401); assert.equal((await state(u)).failed_attempts,1); assert.equal((await login()).status,200);
  });
  await check('successful PIN clears previous failed attempts',async()=>{
    await reset(); await db.query('UPDATE users SET failed_attempts=3 WHERE id=$1',[u.id]);
    assert.equal((await pinLogin()).status,200); assert.equal((await state(u)).failed_attempts,0);
  });
  await check('ten concurrent failures cannot lose increments (PG lock barrier)',async()=>{
    await reset(); const locker = new pg.Client({connectionString:dbUrl}); await locker.connect();
    let requests;
    try {
      await locker.query('BEGIN'); await locker.query('LOCK TABLE users IN SHARE MODE');
      requests=Promise.all(Array.from({length:10},()=>login(u,'Wrong-password')));
      const deadline=Date.now()+15000; let waiting=0;
      while(Date.now()<deadline) {
        await locker.query('SELECT pg_stat_clear_snapshot()');
        waiting=Number((await locker.query("SELECT count(*) n FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event_type='Lock' AND query ILIKE '%UPDATE users%'",[process.env.PRODUCTION_ROLE_TESTS==='1'?'creche_app':'creche_app_test'])).rows[0].n);
        if(waiting===10)break; await new Promise(r=>setTimeout(r,20));
      }
      assert.equal(waiting,10,'all ten requests reached the write barrier');
    } finally { await locker.query('ROLLBACK'); await locker.end(); if(requests)await requests; }
    const row=await state(u); assert.ok(row.failed_attempts>=5,JSON.stringify(row)); assert.ok(row.locked_until>new Date()); assert.equal((await login()).status,423);
  });
  await check('one OTP yields at most one session under concurrent verification',async()=>{
    await reset(); const code=await otp(), before=await sessions(u);
    const r=await Promise.all(Array.from({length:8},()=>verify(code)));
    assert.equal(r.filter(x=>x.status===200).length,1); assert.equal(await sessions(u),before+1);
  });
  await check('OTP exhausted by wrong codes stays unusable',async()=>{
    await reset(); const code=await otp(), wrong=code==='000000'?'999999':'000000', before=await sessions(u);
    await Promise.all(Array.from({length:8},()=>verify(wrong)));
    assert.equal((await verify(code)).status,401); assert.equal(await sessions(u),before);
  });
  await check('deleted parent cannot get PIN or OTP session',async()=>{
    await reset(); const code=await otp(), before=await sessions(u); await db.query('UPDATE users SET deleted_at=NOW() WHERE id=$1',[u.id]);
    assert.equal((await pinLogin()).status,401); assert.equal((await verify(code)).status,401); assert.equal(await sessions(u),before); await reset();
  });
  // A real forwarding hop overwrites caller-controlled XFF with socket identity.
  proxy=http.createServer((request,response)=>{
    const upstream=http.request({host:'127.0.0.1',port,path:request.url,method:request.method,headers:{...request.headers,'x-forwarded-for':request.socket.remoteAddress}},r=>{response.writeHead(r.statusCode,r.headers);r.pipe(response);});
    upstream.on('error',()=>{response.statusCode=502;response.end('{}');});request.pipe(upstream);
  });
  await new Promise(r=>proxy.listen(0,'127.0.0.1',r)); process.env.RATE_LIMIT_DISABLED='false';
  const viaProxy = (ip,spoof='203.0.113.9') => new Promise((resolve,reject)=>{
    const body=JSON.stringify({email:`${randomUUID()}@test.invalid`,password:'Wrong-password'});
    const r=http.request({hostname:'127.0.0.1',port:proxy.address().port,path:'/api/v1/auth/login',method:'POST',localAddress:ip,headers:{'content-type':'application/json','content-length':Buffer.byteLength(body),'x-forwarded-for':spoof}},s=>{let text='';s.on('data',d=>text+=d);s.on('end',()=>resolve({status:s.statusCode,body:JSON.parse(text)}));});r.on('error',reject);r.end(body);
  });
  await check('first client reaches its own auth IP limit',async()=>{for(let i=0;i<10;i++)assert.equal((await viaProxy('127.0.0.2')).status,401);assert.equal((await viaProxy('127.0.0.2')).status,429);});
  await check('second client behind same proxy has a separate bucket',async()=>{assert.equal((await viaProxy('127.0.0.3')).status,401);});
  await check('spoofed forwarding headers do not reset a client bucket',async()=>{for(let i=0;i<10;i++)assert.equal((await viaProxy('127.0.0.4',`203.0.113.${i}`)).status,401);assert.equal((await viaProxy('127.0.0.4','198.51.100.1')).status,429);});
  await check('nginx overwrites XFF rather than trusting client chains',async()=>{
    const conf=readFileSync(new URL('../../infrastructure/nginx/nginx.conf',import.meta.url),'utf8');
    assert.ok(!conf.includes('$proxy_add_x_forwarded_for'));assert.ok((conf.match(/proxy_set_header X-Forwarded-For \$remote_addr;/g)||[]).length>=3);
  });
} finally { if(proxy)await new Promise(r=>proxy.close(r)); if(app)await app.close(); if(pool)await pool.end(); await db.end(); }
console.log(`G1 auth hardening: ${passed} passed, ${failed} failed`); if(failed)process.exitCode=1;
