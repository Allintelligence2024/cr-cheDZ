#!/usr/bin/env node
// H2b: actual API + PostgreSQL + shipped worker + loopback HTTP provider doubles.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { ensureAppRole, appUrl } from './helpers.mjs';
const url=process.env.DATABASE_URL;
assert.ok(new URL(url).pathname.endsWith('_test'));
assert.equal(process.env.ALLOW_DATABASE_RESET,'1');
for(const args of [['scripts/migrate.mjs','--reset'],['scripts/migrate.mjs'],['scripts/seed.mjs']])execFileSync(process.execPath,args,{env:process.env,stdio:'pipe'});
const db=new pg.Client({connectionString:url});await db.connect();
let app,pool,worker,server,serverError,passed=0,failed=0,workerLogs='';
const cases=[],calls=[];
const check=async(name,fn)=>{try{await fn();passed++;console.log(`✓ ${name}`);}catch(e){failed++;console.error(`✗ ${name}: ${e.stack}`);}};
async function until(fn,label){for(let i=0;i<150;i++){if(serverError)throw serverError;if(await fn())return;await delay(200);}throw new Error(`Timeout ${label}: ${workerLogs.slice(-1500)}`);}
async function stopWorker(){if(!worker)return;const p=worker;worker=null;if(p.exitCode!==null)return;const done=once(p,'exit');p.kill('SIGTERM');const timer=setTimeout(()=>p.kill('SIGKILL'),10000);try{await done;}finally{clearTimeout(timer);}}
try{
  await ensureAppRole(db);
  const applicationUrl=appUrl();
  const password='Synthetic-H2b-only!',hash=await bcrypt.hash(password,4);
  process.env.DATABASE_URL=applicationUrl;process.env.NODE_ENV='test';process.env.RATE_LIMIT_DISABLED='true';
  const {createApp}=await import('../../apps/api/dist/app.factory.js');
  const {PG_POOL}=await import('../../apps/api/dist/shared/database/database.provider.js');
  app=await createApp();pool=app.get(PG_POOL);await app.listen(0,'127.0.0.1');
  const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
  const req=async(method,path,actor,body)=>{
    const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(actor?.token?{authorization:`Bearer ${actor.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const text=await r.text();return{status:r.status,body:text?JSON.parse(text):null};
  };
  const actor=async(org,role)=>{
    const email=`${randomUUID()}@test.invalid`;
    const id=(await db.query("INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'H2b','Synthetic',$2,'active') RETURNING id",[email,hash])).rows[0].id;
    await db.query('INSERT INTO memberships(organization_id,user_id,role_id) SELECT $1,$2,id FROM roles WHERE slug=$3',[org,id,role]);
    const login=await req('POST','/auth/login',null,{email,password});assert.equal(login.status,200,JSON.stringify(login.body));
    return {id,token:login.body.access_token};
  };
  const make=async(label,attendance=false)=>{
    const org=(await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'H2b','31') RETURNING id",[randomUUID()])).rows[0].id;
    const site=(await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'H2b') RETURNING id",[org])).rows[0].id;
    const director=await actor(org,'director'),parent=await actor(org,'parent_primary');
    const child=(await db.query("INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,$3,'Synthetic','2024-01-01',$4) RETURNING id",[org,site,label,director.id])).rows[0].id;
    const phone=`+21355${String(cases.length).padStart(7,'0')}`;
    const guardian=(await db.query("INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,phone_primary,created_by) VALUES($1,$2,'H2b','Synthetic','parent',$3,$4) RETURNING id",[org,parent.id,phone,director.id])).rows[0].id;
    await db.query('INSERT INTO child_guardians(organization_id,child_id,guardian_id) VALUES($1,$2,$3)',[org,child,guardian]);
    await db.query("INSERT INTO feature_flags(organization_id,flag_key,is_enabled) VALUES($1,'whatsapp_notifications',true)",[org]);
    await db.query("INSERT INTO devices(organization_id,registered_by,name,device_fingerprint,platform,fcm_token) VALUES($1,$2,'H2b',$3,'android',$4)",[org,parent.id,randomUUID(),parent.id]);
    const created=await req('POST',attendance?'/attendance/check-in':'/journal/events',director,attendance?{child_id:child}:{child_id:child,event_type:'meal',meal_quantity:'all'});
    assert.equal(created.status,201,JSON.stringify(created.body));
    const rows=(await db.query('SELECT id,channel,data FROM notification_queue WHERE organization_id=$1',[org])).rows;assert.equal(rows.length,2);
    const inbox=(await db.query('SELECT id,data FROM notification_inbox WHERE organization_id=$1',[org])).rows[0];assert.ok(inbox);
    const f={label,org,child,guardian,parent,director,phone,rows,inbox,event:inbox.data.log_event_id,push:true,wa:true,visible:true};cases.push(f);return f;
  };
  const positive=await make('authorized');
  await check('new WhatsApp payload retains verifiable child and event identity',async()=>{
    const data=positive.rows.find(r=>r.channel==='whatsapp').data;
    assert.equal(data.child_id,positive.child);assert.equal(data.log_event_id,positive.event);assert.equal(data.event_type,'meal');
  });
  const generic=await make('generic-push');
  await db.query("UPDATE notification_queue SET data=NULL,title_fr='System',body_fr='System test' WHERE organization_id=$1 AND channel='push'",[generic.org]);
  await db.query("UPDATE notification_inbox SET data=NULL,type='notice',title_fr='System',body_fr='System test' WHERE organization_id=$1",[generic.org]);
  const journal=await make('journal-revoked');journal.push=journal.wa=journal.visible=false;
  await db.query('UPDATE child_guardians SET can_view_journal=false WHERE child_id=$1',[journal.child]);
  const receive=await make('receive-revoked');receive.push=receive.wa=receive.visible=false;
  await db.query('UPDATE child_guardians SET can_receive_push=false WHERE child_id=$1',[receive.child]);
  const guardian=await make('guardian-deleted');guardian.push=guardian.wa=guardian.visible=false;
  await db.query('UPDATE guardians SET deleted_at=NOW() WHERE id=$1',[guardian.guardian]);
  const child=await make('child-deleted');child.push=child.wa=child.visible=false;
  await db.query('UPDATE children SET deleted_at=NOW() WHERE id=$1',[child.child]);
  const membership=await make('membership-revoked');membership.push=membership.wa=membership.visible=false;
  await db.query('UPDATE memberships SET is_active=false WHERE organization_id=$1 AND user_id=$2',[membership.org,membership.parent.id]);
  const suspended=await make('user-suspended');suspended.push=suspended.wa=suspended.visible=false;
  await db.query("UPDATE users SET status='suspended' WHERE id=$1",[suspended.parent.id]);
  const hidden=await make('event-hidden');hidden.push=hidden.wa=hidden.visible=false;
  assert.equal((await req('PATCH',`/journal/events/${hidden.event}/visibility`,hidden.director,{visible_to_parents:false})).status,200);
  const privateEvent=await make('event-private');privateEvent.push=privateEvent.wa=privateEvent.visible=false;
  await db.query('UPDATE daily_log_events SET note_is_private=true WHERE id=$1',[privateEvent.event]);
  const reference=await make('foreign-reference');reference.push=reference.wa=reference.visible=false;
  const bad=JSON.stringify({scope:'child_event',child_id:positive.child,log_event_id:positive.event,event_type:'meal',to:reference.phone});
  for(const table of ['notification_queue','notification_inbox'])await db.query(`UPDATE ${table} SET data=$1 WHERE organization_id=$2`,[bad,reference.org]);
  const malformed=await make('malformed-reference');malformed.push=malformed.wa=malformed.visible=false;
  for(const table of ['notification_queue','notification_inbox'])await db.query(`UPDATE ${table} SET data=jsonb_set(data,'{log_event_id}','"not-a-uuid"') WHERE organization_id=$1`,[malformed.org]);
  const legacy=await make('legacy-whatsapp');legacy.wa=false;
  await db.query("UPDATE notification_queue SET data=$1 WHERE organization_id=$2 AND channel='whatsapp'",[JSON.stringify({to:legacy.phone,event_type:'whatsapp'}),legacy.org]);
  const flag=await make('whatsapp-flag-off');flag.wa=false;
  await db.query("UPDATE feature_flags SET is_enabled=false WHERE organization_id=$1 AND flag_key='whatsapp_notifications'",[flag.org]);
  const globalFlag=await make('duplicate-global-flags');globalFlag.wa=false;
  await db.query("DELETE FROM feature_flags WHERE organization_id=$1 AND flag_key='whatsapp_notifications'",[globalFlag.org]);
  // Existing seed can leave multiple NULL-tenant rows. Conflicting values must deny, not crash.
  await db.query("INSERT INTO feature_flags(flag_key,organization_id,is_enabled) VALUES('whatsapp_notifications',NULL,true)");
  const phone=await make('phone-changed');phone.wa=false;
  await db.query("UPDATE guardians SET phone_primary='+213559999999' WHERE id=$1",[phone.guardian]);
  const pref=await make('push-preference-off');pref.push=false;
  await db.query("INSERT INTO notification_preferences(organization_id,user_id,channel,event_type,is_enabled) VALUES($1,$2,'push','meal',false)",[pref.org,pref.parent.id]);
  const waPref=await make('whatsapp-preference-off');waPref.wa=false;
  await db.query("INSERT INTO notification_preferences(organization_id,user_id,channel,event_type,is_enabled) VALUES($1,$2,'whatsapp','meal',false)",[waPref.org,waPref.parent.id]);
  const unknown=await make('unknown-scope');unknown.push=unknown.wa=unknown.visible=false;
  for(const table of ['notification_queue','notification_inbox'])await db.query(`UPDATE ${table} SET data=jsonb_set(data,'{scope}','"future_unknown"') WHERE organization_id=$1`,[unknown.org]);
  const late=await make('revoked-after-claim');late.push=late.wa=false;
  let claimObserved=false;
  const mismatched=await make('attendance-child-mismatch',true);mismatched.push=mismatched.wa=mismatched.visible=false;
  await db.query('UPDATE attendance_events SET child_id=$1 WHERE organization_id=$2',[positive.child,mismatched.org]);
  const attendance=await make('attendance-authorized',true);
  await db.query('UPDATE child_guardians SET can_view_journal=false WHERE child_id=$1',[attendance.child]);
  // Filtering must precede LIMIT 100: 101 denied newer rows cannot hide the valid row.
  await db.query(`INSERT INTO notification_inbox(organization_id,user_id,type,title_fr,title_ar,body_fr,body_ar,data)
    SELECT $1,$2,'meal','Hidden','Hidden','Hidden','Hidden',$3::jsonb FROM generate_series(1,101)`,[positive.org,positive.parent.id,JSON.stringify({event_type:'meal',child_id:randomUUID(),log_event_id:randomUUID()})]);
  for(const f of cases)await check(`inbox current rights: ${f.label}`,async()=>{
    const r=await req('GET','/notifications/inbox',f.parent);
    if([401,403].includes(r.status)){assert.equal(f.visible,false);return;}
    assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.items.some(n=>n.id===f.inbox.id),f.visible);
    assert.equal(r.body.items.length,f.visible?1:0);
  });
  await check('mark-read cannot mutate a revoked notification',async()=>{
    assert.equal((await req('POST',`/notifications/inbox/${journal.inbox.id}/read`,journal.parent)).status,204);
    assert.equal((await db.query('SELECT is_read FROM notification_inbox WHERE id=$1',[journal.inbox.id])).rows[0].is_read,false);
  });
  for(const f of [membership,suspended])await check(`producer stops new publication for ${f.label}`,async()=>{
    const before=Number((await db.query('SELECT count(*) n FROM notification_queue WHERE organization_id=$1',[f.org])).rows[0].n);
    assert.equal((await req('POST','/journal/events',f.director,{child_id:f.child,event_type:'meal',meal_quantity:'all'})).status,201);
    assert.equal(Number((await db.query('SELECT count(*) n FROM notification_queue WHERE organization_id=$1',[f.org])).rows[0].n),before);
  });
  server=createServer(async(req,res)=>{
    try {
    let text='';for await(const chunk of req)text+=chunk;
    const body=JSON.parse(text);
    if(req.url==='/claimed'){
      if(!claimObserved && body.some(id=>late.rows.some(row=>row.id===id))){
        assert.ok((await db.query("SELECT 1 FROM notification_queue WHERE organization_id=$1 AND status='processing'",[late.org])).rows.length);
        await db.query('UPDATE child_guardians SET can_view_journal=false WHERE child_id=$1',[late.child]);claimObserved=true;
      }
      res.end('{}');return;
    }
    calls.push({channel:req.url.startsWith('/fcm')?'push':'whatsapp',to:body.to??body.message?.token});
    res.setHeader('content-type','application/json');res.end('{"name":"synthetic-message"}');
    } catch(error) {serverError=error;res.writeHead(500);res.end('{}');}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const mock=`http://127.0.0.1:${server.address().port}`;
  const startWorker=()=>{
    worker=spawn(process.execPath,['--import','./tests/fixtures/notification-provider-bridge.mjs','apps/worker/dist/main.js'],{
      env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'test',DATABASE_URL:applicationUrl,WORKER_SCHEDULER_ENABLED:'false',WORKER_POLL_MS:'40',
        WHATSAPP_TOKEN:'synthetic',WHATSAPP_PHONE_ID:'synthetic',WHATSAPP_API_URL:mock,H2_FAKE_PROVIDER_URL:mock,FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'synthetic'})},stdio:['ignore','pipe','pipe']});
    for(const stream of [worker.stdout,worker.stderr])stream.on('data',b=>{workerLogs=(workerLogs+b).slice(-12000);});
  };
  startWorker();
  await until(async()=>Number((await db.query("SELECT count(*) n FROM notification_queue WHERE status IN ('pending','processing')")).rows[0].n)===0,'worker drains all actual queue rows');
  for(const f of cases)await check(`worker HTTP deliveries and durable reasons: ${f.label}`,async()=>{
    for(const [channel,allowed,to] of [['push',f.push,f.parent.id],['whatsapp',f.wa,f.phone]]){
      assert.equal(calls.filter(c=>c.channel===channel&&c.to===to).length,allowed?1:0,`${channel} network calls`);
      const row=(await db.query('SELECT status,attempts,failure_reason FROM notification_queue WHERE organization_id=$1 AND channel=$2',[f.org,channel])).rows[0];
      assert.equal(row.status,'sent');assert.equal(row.attempts,1);
      assert.equal(row.failure_reason,allowed?null:'NOTIFICATION_ACCESS_REVOKED_OR_UNVERIFIABLE');
    }
  });
  await check('rights revoked after an actual claim also hide the inbox',async()=>{
    assert.equal(claimObserved,true);
    assert.deepEqual((await req('GET','/notifications/inbox',late.parent)).body.items,[]);
  });
  await stopWorker();
  await check('restart does not replay consumed or refused queue rows',async()=>{
    const before=calls.length;
    const job=(await db.query("INSERT INTO background_jobs(job_type,payload) VALUES('payments_expire','{}') RETURNING id")).rows[0].id;
    startWorker();await until(async()=>(await db.query('SELECT status FROM background_jobs WHERE id=$1',[job])).rows[0].status==='done','restart job');
    assert.equal(calls.length,before);assert.equal(Number((await db.query('SELECT count(*) n FROM notification_queue WHERE attempts<>1')).rows[0].n),0);
  });
}finally{
  await stopWorker();if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(app)await app.close();if(pool)await pool.end();await db.end();
}
console.log(`H2b notifications: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
