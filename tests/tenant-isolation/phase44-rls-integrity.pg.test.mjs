#!/usr/bin/env node
// G2: actual application-role SQL, transaction cleanup and deterministic races.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensureAppRole, appUrl } from './helpers.mjs';

assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
const db = new pg.Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
let passed = 0, failed = 0;
const check = async (name, fn) => { try { await fn(); passed++; console.log(`✓ ${name}`); } catch(e) { failed++; console.error(`✗ ${name}: ${e.stack}`); } };
const connect = async () => { const c = new pg.Client({connectionString:appUrl()}); await c.connect(); return c; };
async function scoped(tenant, fn) {
  const c = await connect();
  try { await c.query('BEGIN'); if(tenant!==undefined)await c.query("SELECT set_config('app.tenant_id',$1,true)",[tenant]); return await fn(c); }
  finally { await c.query('ROLLBACK'); await c.end(); }
}
const rlsDenied = fn => assert.rejects(fn, e => e.code==='42501');
try {
  await ensureAppRole(db);
  const org = async () => (await db.query("INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'G2','31') RETURNING id",[randomUUID()])).rows[0].id;
  const a=await org(), b=await org();
  const user=(await db.query("INSERT INTO users(email,first_name,last_name,status) VALUES($1,'G2','Test','active') RETURNING id",[`${randomUUID()}@test.invalid`])).rows[0].id;
  const defs=[
    {table:'feature_flags',extra:"flag_key",value:'$3',change:'is_enabled=true'},
    {table:'background_jobs',extra:'job_type,payload,scheduled_at',value:"$3,'{}','2099-01-01'",change:"failure_reason='G2 changed'"},
    {table:'outbox_events',extra:'aggregate_type,aggregate_id,event_type,payload',value:"'G2',$1,$3,'{}'",change:'published_at=NOW()'},
  ];
  const insert = (c,d,tenant,id=randomUUID()) => c.query(`INSERT INTO ${d.table}(id,organization_id,${d.extra}) VALUES($1,$2,${d.value}) RETURNING id`,[id,tenant,`g2-${id}`]);
  for(const d of defs) {
    const global=(await insert(db,d,null)).rows[0].id, ownA=(await insert(db,d,a)).rows[0].id, ownB=(await insert(db,d,b)).rows[0].id;
    for(const [label,tenant] of [['A',a],['B',b],['unset',undefined],['empty','']]) {
      const own=tenant===b?ownB:ownA, foreign=tenant===b?ownA:ownB;
      const run=(name,fn)=>check(`${d.table}/${label}: ${name}`,()=>scoped(tenant,fn));
      await run('global SELECT retained',async c=>assert.equal((await c.query(`SELECT id FROM ${d.table} WHERE id=$1`,[global])).rowCount,1));
      await run('global INSERT denied',c=>rlsDenied(()=>insert(c,d,null)));
      await run('global UPDATE denied',async c=>assert.equal((await c.query(`UPDATE ${d.table} SET ${d.change} WHERE id=$1 RETURNING id`,[global])).rowCount,0));
      await run('global DELETE denied',async c=>assert.equal((await c.query(`DELETE FROM ${d.table} WHERE id=$1 RETURNING id`,[global])).rowCount,0));
      await run('global row cannot be adopted',async c=>assert.equal((await c.query(`UPDATE ${d.table} SET organization_id=$2 WHERE id=$1 RETURNING id`,[global,tenant||a])).rowCount,0));
      await run('tenant row cannot become global',async c=>{
        const fn=()=>c.query(`UPDATE ${d.table} SET organization_id=NULL WHERE id=$1 RETURNING id`,[own]);
        if(tenant)await rlsDenied(fn); else assert.equal((await fn()).rowCount,0);
      });
      await run('own CRUD retained, no-context INSERT denied',async c=>{
        if(!tenant)return rlsDenied(()=>insert(c,d,a));
        const id=(await insert(c,d,tenant)).rows[0].id;
        assert.equal((await c.query(`UPDATE ${d.table} SET ${d.change} WHERE id=$1 RETURNING id`,[id])).rowCount,1);
        assert.equal((await c.query(`DELETE FROM ${d.table} WHERE id=$1 RETURNING id`,[id])).rowCount,1);
      });
      await run('foreign row remains unmodifiable',async c=>assert.equal((await c.query(`UPDATE ${d.table} SET ${d.change} WHERE id=$1 RETURNING id`,[foreign])).rowCount,0));
    }
  }
  const registry=(await db.query("INSERT INTO processing_registry(organization_id,processing_name,purpose_fr,legal_basis,data_categories,data_subjects,retention_days) VALUES($1,'G2','G2','consent','{}','{}',30) RETURNING id",[a])).rows[0].id;
  const request=(await db.query("INSERT INTO privacy_requests(organization_id,requester_id,request_type,deadline) VALUES($1,$2,'access',NOW()) RETURNING id",[a,user])).rows[0].id;
  const privacy=[
    ['privacy_violations', (await db.query("INSERT INTO privacy_violations(organization_id,description,notification_deadline,created_by) VALUES($1,'G2',NOW(),$2) RETURNING id",[a,user])).rows[0].id],
    ['privacy_request_exports',(await db.query("INSERT INTO privacy_request_exports(organization_id,request_id,payload,created_by) VALUES($1,$2,'{}',$3) RETURNING id",[a,request,user])).rows[0].id],
    ['privacy_dpias',(await db.query('INSERT INTO privacy_dpias(organization_id,processing_registry_id,created_by) VALUES($1,$2,$3) RETURNING id',[a,registry,user])).rows[0].id],
  ];
  for(const [table,id] of privacy) {
    await check(`${table}: tenant context works`,()=>scoped(a,async c=>assert.equal((await c.query(`SELECT id FROM ${table} WHERE id=$1`,[id])).rowCount,1)));
    await check(`${table}: foreign context empty`,()=>scoped(b,async c=>assert.equal((await c.query(`SELECT id FROM ${table} WHERE id=$1`,[id])).rowCount,0)));
    await check(`${table}: pooled connection after COMMIT is empty, not 22P02`,async()=>{
      const c=await connect();try {
        await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[a]);await c.query(`SELECT id FROM ${table} WHERE id=$1`,[id]);await c.query('COMMIT');
        assert.equal((await c.query(`SELECT id FROM ${table} WHERE id=$1`,[id])).rowCount,0);
      } finally {await c.end();}
    });
    await check(`${table}: whitespace context fails closed without cast error`,()=>scoped('  ',async c=>assert.equal((await c.query(`SELECT id FROM ${table} WHERE id=$1`,[id])).rowCount,0)));
  }
  const site=(await db.query("INSERT INTO sites(organization_id,name_fr) VALUES($1,'G2') RETURNING id",[a])).rows[0].id;
  const child=(await db.query("INSERT INTO children(organization_id,site_id,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,'G2','Test','2024-01-01',$3) RETURNING id",[a,site,user])).rows[0].id;
  // confirmed : depuis la migration 064, les allocations ne portent que sur
  // des paiements confirmés (garde guard_payment_allocation) — aligné sur les
  // flux applicatifs (cash : créé confirmé ; webhook : confirmation puis
  // allocation).
  const payment=async()=> (await db.query("INSERT INTO payments(organization_id,reference_number,child_id,amount,method,status,created_by,site_id) VALUES($1,$2,$3,100,'cash','confirmed',$4,$5) RETURNING id",[a,randomUUID(),child,user,site])).rows[0].id;
  const invoice=async()=> (await db.query("INSERT INTO invoices(organization_id,invoice_number,child_id,period_year,period_month,subtotal,total_amount,due_date,created_by) VALUES($1,$2,$3,2026,9,100,100,'2026-09-30',$4) RETURNING id",[a,randomUUID(),child,user])).rows[0].id;
  const allocate=(c,p,i,amount)=>c.query('INSERT INTO payment_allocations(organization_id,payment_id,invoice_id,amount_allocated,allocated_by) VALUES($1,$2,$3,$4,$5)',[a,p,i,amount,user]);
  for(const amount of [70,40]) await check(`parallel allocation ${amount}+${amount} against payment 100`,async()=>{
    const p=await payment(), i=await invoice(), j=await invoice(), first=await connect(), second=await connect();let pending;
    try {
      for(const c of [first,second]){await c.query('BEGIN');await c.query("SELECT set_config('app.tenant_id',$1,true)",[a]);}
      const pid1=(await first.query('SELECT pg_backend_pid() pid')).rows[0].pid, pid2=(await second.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await allocate(first,p,i,amount);
      let settled=false;
      pending=allocate(second,p,j,amount).then(()=>({ok:true}),error=>({ok:false,code:error.code,message:error.message})).finally(()=>settled=true);
      let blocked=false;const deadline=Date.now()+10000;
      while(!settled && Date.now()<deadline){blocked=(await db.query('SELECT $1::int=ANY(pg_blocking_pids($2)) blocked',[pid1,pid2])).rows[0].blocked;if(blocked)break;await new Promise(r=>setTimeout(r,20));}
      assert.ok(settled||blocked,'second transaction must complete or visibly block on first');
      await first.query('COMMIT'); const result=await pending;
      await second.query(result.ok?'COMMIT':'ROLLBACK');
      const total=Number((await db.query('SELECT sum(amount_allocated) n FROM payment_allocations WHERE payment_id=$1',[p])).rows[0].n);
      if(amount===70){assert.equal(result.ok,false,JSON.stringify({result,total,blocked}));assert.equal(result.code,'P0001');assert.match(result.message,/PAYMENT_ALLOCATION_EXCEEDS_PAYMENT/);assert.equal(total,70);}
      else {assert.equal(result.ok,true,JSON.stringify(result));assert.equal(total,80);}
    } finally {await first.query('ROLLBACK');await second.query('ROLLBACK');await first.end();await second.end();if(pending)await pending;}
  });
  await check('sequential over-allocation was already blocked',async()=>{
    const p=await payment(),i=await invoice(),j=await invoice();
    await scoped(a,async c=>{await allocate(c,p,i,70);await assert.rejects(()=>allocate(c,p,j,70),e=>e.code==='P0001');});
  });
  await check('controlled global flag helper still works',async()=>{
    const key=`g2-helper-${randomUUID()}`;
    try{await scoped(undefined,async c=>{await c.query('SELECT support_set_flag($1,NULL,true)',[key]);assert.equal((await c.query('SELECT is_enabled FROM feature_flags WHERE flag_key=$1',[key])).rows[0].is_enabled,true);});}
    finally{await db.query('DELETE FROM feature_flags WHERE flag_key=$1',[key]);}
  });
  await check('controlled global job claim and leased finish still work',async()=>{
    const id=(await db.query("INSERT INTO background_jobs(organization_id,job_type,payload,priority,scheduled_at) VALUES(NULL,'g2-helper','{}',-2000000000,'1900-01-01') RETURNING id")).rows[0].id;
    try{await scoped(undefined,async c=>{
      const job=(await c.query('SELECT * FROM jobs_claim_leased()')).rows[0];assert.equal(job.id,id);
      assert.equal((await c.query('SELECT jobs_finish_leased($1,$2,true,NULL) ok',[id,job.lease_token])).rows[0].ok,true);
      assert.equal((await c.query('SELECT status FROM background_jobs WHERE id=$1',[id])).rows[0].status,'done');
    });}finally{await db.query('DELETE FROM background_jobs WHERE id=$1',[id]);}
  });
} finally {await db.end();}
console.log(`G2 RLS integrity: ${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
