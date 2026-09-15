#!/usr/bin/env node
// H2a: real HTTP + PostgreSQL, no provider sends and no reset inside the suite.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';
const url = process.env.DATABASE_URL;
assert.ok(new URL(url).pathname.endsWith('_test'), 'Dedicated test database only');
const db = new pg.Client({connectionString:url}); await db.connect();
let app, pool, passed=0, failed=0;
const check = async(name,fn)=>{try{await fn();passed++;console.log(`✓ ${name}`);}catch(e){failed++;console.error(`✗ ${name}: ${e.stack}`);}};
try {
  await ensureAppRole(db);
  const password='Synthetic-H2-only!';
  const hash=await bcrypt.hash(password,4);
  const makeOrg=async()=> (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2 synthetic','31') RETURNING id",[randomUUID()])).rows[0].id;
  const org=await makeOrg(), other=await makeOrg();
  const actor=async(role,organization=org)=>{
    const email=`${randomUUID()}@test.invalid`;
    const id=(await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2','Synthetic',$2,'active') RETURNING id",[email,hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3',[organization,id,role]);
    return {id,email};
  };
  const director=await actor('director'), accountant=await actor('accountant'), parent=await actor('parent_primary'), restricted=await actor('parent_primary'), outsider=await actor('parent_primary'), foreign=await actor('director',other);
  const site=(await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'H2') RETURNING id",[org])).rows[0].id;
  const child=(await db.query(`INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by,notes,special_needs_notes)
    VALUES($1,$2,'Child','Synthetic','2024-01-01',$3,'INTERNAL_CHILD_NOTE','INTERNAL_SPECIAL_NEEDS') RETURNING id`,[org,site,director.id])).rows[0].id;
  const link=async(user,allowed)=>{
    const guardian=(await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,created_by) VALUES($1,$2,'H2','Synthetic','parent','+213555000000',$3) RETURNING id",[org,user.id,director.id])).rows[0].id;
    const id=(await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal,can_view_health,can_receive_invoices)
      VALUES($1,$2,$3,$4,$4,$4) RETURNING id`,[org,child,guardian,allowed])).rows[0].id;
    return {id,guardian};
  };
  const parentLink=await link(parent,true); await link(restricted,false);
  await db.query("INSERT INTO feature_flags(organization_id,flag_key,is_enabled) VALUES($1,'whatsapp_notifications',true)",[org]);
  await db.query("INSERT INTO health_records(organization_id,child_id,blood_type,general_notes) VALUES($1,$2,'O+','HEALTH_SENTINEL')",[org,child]);
  await db.query(`INSERT INTO invoices(organization_id,child_id,invoice_number,period_year,period_month,subtotal,total_amount,due_date,created_by)
    VALUES($1,$2,$3,2026,9,100,100,'2026-09-30',$4)`,[org,child,randomUUID(),director.id]);
  await db.query(`INSERT INTO payments(organization_id,child_id,reference_number,amount,method,status,created_by)
    VALUES($1,$2,$3,100,'cash','confirmed',$4)`,[org,child,randomUUID(),director.id]);
  process.env.DATABASE_URL=appUrl();process.env.NODE_ENV='test';process.env.RATE_LIMIT_DISABLED='true';
  const {createApp}=await import('../../apps/api/dist/app.factory.js');
  const {PG_POOL}=await import('../../apps/api/dist/shared/database/database.provider.js');
  app=await createApp();pool=app.get(PG_POOL);await app.listen(0,'127.0.0.1');
  const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req=async(method,path,user,body)=>{
    const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(user?.token?{authorization:`Bearer ${user.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    return {status:r.status,body:await r.json()};
  };
  for(const a of [director,accountant,parent,restricted,outsider,foreign]){
    const r=await req('POST','/auth/login',null,{email:a.email,password});assert.equal(r.status,200,JSON.stringify(r.body));a.token=r.body.access_token;assert.ok(a.token);
  }
  const event=async(fields)=>{const r=await req('POST','/journal/events',director,{child_id:child,event_type:'meal',meal_quantity:'all',...fields});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.id;};
  await event({});
  const count=async(table,user)=>Number((await db.query(`SELECT count(*) AS n FROM ${table} WHERE organization_id=$1 AND user_id=$2`,[org,user.id])).rows[0].n);
  await check('journal permission blocks push AND WhatsApp queue, not just delivery',async()=>{assert.equal(await count('notification_queue',restricted),0);});
  await check('journal permission blocks inbox publication',async()=>{assert.equal(await count('notification_inbox',restricted),0);});
  await check('authorized guardian still receives push, WhatsApp and inbox; unlinked user receives nothing',async()=>{
    assert.equal(await count('notification_queue',parent),2);assert.equal(await count('notification_inbox',parent),1);assert.equal(await count('notification_queue',outsider),0);
  });
  await event({event_type:'note',note_is_private:true,note_text:'PRIVATE_JOURNAL_SENTINEL'});
  await event({visible_to_parents:false,meal_notes:'HIDDEN_JOURNAL_SENTINEL'});
  await event({event_type:'health_observation',health_observation:'MEDICAL_JOURNAL_SENTINEL',temperature_celsius:38});
  await check('private flag on a mixed event cannot publish or notify',async()=>{
    const before=await count('notification_queue',parent);
    const id=await event({note_is_private:true,note_text:'MIXED_PRIVATE_SENTINEL'});
    assert.equal((await db.query('SELECT visible_to_parents FROM daily_log_events WHERE id=$1',[id])).rows[0].visible_to_parents,false);
    assert.equal(await count('notification_queue',parent),before);
  });
  await check('can_receive_push=false still blocks all publication channels',async()=>{
    const before=await count('notification_queue',parent), inbox=await count('notification_inbox',parent);
    await db.query('UPDATE child_guardians SET can_receive_push=false WHERE id=$1',[parentLink.id]);
    try{await event({});assert.equal(await count('notification_queue',parent),before);assert.equal(await count('notification_inbox',parent),inbox);}
    finally{await db.query('UPDATE child_guardians SET can_receive_push=true WHERE id=$1',[parentLink.id]);}
  });
  await check('attendance notification keeps its independent receive-push permission',async()=>{
    const before=await count('notification_queue',restricted);
    const r=await req('POST','/attendance/check-in',director,{child_id:child});assert.equal(r.status,201,JSON.stringify(r.body));
    assert.equal(await count('notification_queue',restricted),before+2);
  });
  const makeRequest=async(user)=>{const r=await req('POST','/privacy/requests',user,{request_type:'access',subject_id:child});assert.equal(r.status,201,JSON.stringify(r.body));return r.body.id;};
  const request=await makeRequest(parent), limitedRequest=await makeRequest(restricted);
  await check('accountant cannot create an arbitrary child rights request',async()=>{
    assert.equal((await req('POST','/privacy/requests',accountant,{request_type:'access',subject_id:child})).status,403);
  });
  await check('accountant cannot list another requester dossier',async()=>{
    assert.ok(!(await req('GET','/privacy/requests',accountant)).body.some(r=>r.id===request));
  });
  await check('accountant cannot read another requester dossier',async()=>{
    assert.equal((await req('GET',`/privacy/requests/${request}`,accountant)).status,404);
  });
  await check('accountant cannot export another requester medical dossier or persist it',async()=>{
    const before=Number((await db.query('SELECT count(*) n FROM privacy_request_exports WHERE request_id=$1',[request])).rows[0].n);
    assert.equal((await req('POST',`/privacy/requests/${request}/export`,accountant)).status,404);
    assert.equal(Number((await db.query('SELECT count(*) n FROM privacy_request_exports WHERE request_id=$1',[request])).rows[0].n),before);
  });
  await check('legacy accountant-owned request does not grant access to an unrelated child',async()=>{
    const id=(await db.query("INSERT INTO privacy_requests(organization_id,requester_id,request_type,subject_id,deadline) VALUES($1,$2,'access',$3,NOW()+INTERVAL '30 days') RETURNING id",[org,accountant.id,child])).rows[0].id;
    assert.equal((await req('POST',`/privacy/requests/${id}/export`,accountant)).status,403);
  });
  for(const [role,user] of [['parent',parent],['director',director]]) await check(`${role} export excludes hidden/private journal and internal child notes, including persisted JSON`,async()=>{
      const r=await req('POST',`/privacy/requests/${request}/export`,user);assert.equal(r.status,201,JSON.stringify(r.body));
      const payload=r.body.payload;assert.ok(payload.journal_events.length>0);
      assert.equal(payload.health_record.blood_type,'O+');assert.equal(payload.invoices.length,1);assert.equal(payload.payments.length,1);
      for(const marker of ['PRIVATE_JOURNAL_SENTINEL','HIDDEN_JOURNAL_SENTINEL','MIXED_PRIVATE_SENTINEL','INTERNAL_CHILD_NOTE','INTERNAL_SPECIAL_NEEDS'])assert.ok(!JSON.stringify(payload).includes(marker),marker);
      const stored=(await db.query('SELECT payload FROM privacy_request_exports WHERE id=$1',[r.body.export_id])).rows[0].payload;assert.deepEqual(stored,payload);
  });
  await check('limited parent export respects journal, health and invoice permissions',async()=>{
    const r=await req('POST',`/privacy/requests/${limitedRequest}/export`,restricted);assert.equal(r.status,201,JSON.stringify(r.body));
    assert.equal(r.body.payload.health_record,null);
    for(const key of ['journal_events','allergies','vaccinations','medication_authorizations','medication_administrations','invoices','payments'])assert.deepEqual(r.body.payload[key],[],key);
    assert.ok(!JSON.stringify(r.body.payload).includes('HEALTH_SENTINEL'));
  });
  await check('journal permission alone does not expose medical journal observations',async()=>{
    await db.query('UPDATE child_guardians SET can_view_health=false WHERE id=$1',[parentLink.id]);
    try {
      const r=await req('POST',`/privacy/requests/${request}/export`,parent);assert.equal(r.status,201);
      assert.ok(r.body.payload.journal_events.some(e=>e.event_type==='meal'));
      assert.ok(!JSON.stringify(r.body.payload.journal_events).includes('MEDICAL_JOURNAL_SENTINEL'));
    }finally{await db.query('UPDATE child_guardians SET can_view_health=true WHERE id=$1',[parentLink.id]);}
  });
  await check('child internal notes do not leak via the generic privacy child projection',async()=>{
    const r=await req('POST',`/privacy/requests/${limitedRequest}/export`,restricted);assert.equal(r.status,201);
    assert.equal(r.body.payload.child.notes,undefined);assert.equal(r.body.payload.child.special_needs_notes,undefined);
  });
  await check('foreign tenant and unlinked peer cannot access the request',async()=>{
    for(const user of [foreign,outsider])for(const [method,path] of [['GET',`/privacy/requests/${request}`],['POST',`/privacy/requests/${request}/export`]])assert.equal((await req(method,path,user)).status,404);
  });
  await check('Excel medical export is already rejected; accountant finance remains allowed',async()=>{
    assert.equal((await req('POST','/exports',accountant,{report_type:'health',period:'2026-09'})).status,400);
    assert.equal((await req('POST','/exports',accountant,{report_type:'invoices',period:'2026-09'})).status,201);
  });
  await check('existing request does not preserve journal/health privileges after revocation',async()=>{
    await db.query('UPDATE child_guardians SET can_view_journal=false,can_view_health=false,can_receive_invoices=false WHERE id=$1',[parentLink.id]);
    try {
      const r=await req('POST',`/privacy/requests/${request}/export`,parent);assert.equal(r.status,201);
      assert.deepEqual(r.body.payload.journal_events,[]);assert.equal(r.body.payload.health_record,null);assert.deepEqual(r.body.payload.invoices,[]);
    } finally {await db.query('UPDATE child_guardians SET can_view_journal=true,can_view_health=true,can_receive_invoices=true WHERE id=$1',[parentLink.id]);}
  });
  await check('deleted guardian receives no new journal notification',async()=>{
    const before=await count('notification_queue',parent);
    await db.query('UPDATE guardians SET deleted_at=NOW() WHERE id=$1',[parentLink.guardian]);
    try{await event({});assert.equal(await count('notification_queue',parent),before);}
    finally{await db.query('UPDATE guardians SET deleted_at=NULL WHERE id=$1',[parentLink.guardian]);}
  });
  await check('deleted guardianship cannot export a historical own request or create another',async()=>{
    await db.query('UPDATE guardians SET deleted_at=NOW() WHERE id=$1',[parentLink.guardian]);
    try {
      assert.equal((await req('POST',`/privacy/requests/${request}/export`,parent)).status,403);
      assert.equal((await req('POST','/privacy/requests',parent,{request_type:'access',subject_id:child})).status,403);
    }finally{await db.query('UPDATE guardians SET deleted_at=NULL WHERE id=$1',[parentLink.guardian]);}
  });
}finally{if(app)await app.close();if(pool)await pool.end();await db.end();}
console.log(`H2 confidentiality: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
