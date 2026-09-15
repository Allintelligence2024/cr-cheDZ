#!/usr/bin/env node
/** Diagnostic F0, pas un gate déclarant la sync corrigée.
 * Requêtes reconstruites depuis le source Dart (SDK absent), vraie API/PG.
 * Aucun reset : lancer après migrate+seed, sur base *_test dédiée.
 */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import {appUrl,ensureAppRole} from '../tenant-isolation/helpers.mjs';
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
let api,pool;
const findings={diagnostic:'F0',dart_executed:false,observed:{}};
try {
  await ensureAppRole(db);
  const suffix=randomUUID();const email=`f0-${suffix}@test.dz`;
  const org=(await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'F0 Test','31') RETURNING id",[`f0-${suffix}`])).rows[0].id;
  const site=(await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'F0 Site') RETURNING id",[org])).rows[0].id;
  const user=(await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'F0','Test',$2,'active') RETURNING id",[email,await bcrypt.hash('Password123!',4)])).rows[0].id;
  await db.query("INSERT INTO memberships(organization_id,user_id,role_id,is_active) SELECT $1,$2,id,true FROM roles WHERE slug='director'",[org,user]);
  process.env.DATABASE_URL=appUrl();process.env.NODE_ENV='test';process.env.RATE_LIMIT_DISABLED='true';
  const {createApp}=await import('../../apps/api/dist/app.factory.js');const {PG_POOL}=await import('../../apps/api/dist/shared/database/database.provider.js');
  api=await createApp();pool=api.get(PG_POOL);await api.listen(0,'127.0.0.1');
  const base=`http://127.0.0.1:${api.getHttpServer().address().port}/api/v1`;let token;
  async function req(method,path,body){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,body:await r.json()};}
  token=(await req('POST','/auth/login',{email,password:'Password123!'})).body.access_token;assert.ok(token);
  const source=readFileSync('apps/staff-mobile/lib/core/network/sync_client.dart','utf8');
  assert.ok(source.includes("'/sync/push', {'operations': operations}"),'Revoir la reproduction si le client a changé');
  const missingPush=await req('POST','/sync/push',{operations:[]});
  const missingPull=await req('GET','/sync/pull?cursor=0');
  findings.observed.client_without_device={push_status:missingPush.status,pull_status:missingPull.status};
  assert.equal(missingPush.status,400);assert.equal(missingPull.status,400);
  const devices=[];for(let n=0;n<2;n++){
    const r=await req('POST','/devices',{name:`F0 appareil ${n}`,device_fingerprint:randomUUID(),platform:'android'});
    assert.equal(r.status,201);assert.ok(r.body.device_id);devices.push(r.body.device_id);
  }
  const child=await req('POST','/children',{site_id:site,first_name_fr:'Enfant',last_name_fr:'F0 Test',date_of_birth:'2024-01-01',status:'active'});
  assert.equal(child.status,201,JSON.stringify(child.body));
  const empty=await req('GET',`/sync/pull?cursor=0&device_id=${devices[1]}`);assert.equal(empty.status,200);
  findings.observed.child_after_http_create={http_status:201,child_events:empty.body.events.filter(e=>e.type==='child').length};
  assert.equal(findings.observed.child_after_http_create.child_events,0,'Le finding child a changé : revoir F0');
  const op={event_id:randomUUID(),client_sequence:1,schema_version:1,command:'check_in',entity_type:'attendance',
    payload:{child_id:child.body.id,site_id:site},occurred_at_device:new Date().toISOString()};
  const push=await req('POST','/sync/push',{device_id:devices[0],operations:[op]});assert.equal(push.status,200);assert.deepEqual(push.body.accepted,[op.event_id]);
  const pull=await req('GET',`/sync/pull?cursor=0&device_id=${devices[1]}`);assert.equal(pull.status,200);assert.ok(pull.body.events.length);
  findings.observed.cursor_types={push:typeof push.body.next_cursor,pull_with_event:typeof pull.body.next_cursor,sync_seq:typeof pull.body.events[0].sync_seq};
  assert.equal(findings.observed.cursor_types.push,'number');assert.equal(findings.observed.cursor_types.pull_with_event,'string');
  const replay=await req('GET',`/sync/pull?cursor=${pull.body.next_cursor}&device_id=${devices[1]}`);
  findings.observed.cursor_types.pull_empty=typeof replay.body.next_cursor;assert.equal(replay.body.events.length,0);
  const retry=await req('POST','/sync/push',{device_id:devices[0],operations:[op]});assert.deepEqual(retry.body.accepted,[op.event_id]);
  findings.observed.api_idempotence_with_registered_device=true;
  findings.observed.parent_sync='aucun moteur ; endpoints sync réservés aux rôles staff';
  findings.observed.dart_cursor_storage='SharedPreferences sync_cursor global ; pas Drift, pas scope tenant/utilisateur';
  writeFileSync(process.env.SYNC_F0_REPORT ?? '/tmp/creche-sync-f0.json',JSON.stringify(findings,null,2)+'\n');
  console.log('F0 DIAGNOSTIC (défauts reproduits, non corrigés) '+JSON.stringify(findings));
} finally {if(api)await api.close();if(pool)await pool.end();await db.end();}
