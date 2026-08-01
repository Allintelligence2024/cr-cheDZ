#!/usr/bin/env node
/** Phase 7 GATE — un parent est autorisé par child_guardians, pas par son rôle.
 * Prérequis: DATABASE_URL, API compilée. */
import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { appUrl, ensureAppRole } from './helpers.mjs';
const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures=[]; const ok=(n,v)=>{ console.log(`${v?'✓':'✗'} ${n}`); if(!v) failures.push(n); };
const main=async()=>{
 const url=process.env.DATABASE_URL; if(!url) throw new Error('DATABASE_URL requis');
 execSync('node scripts/migrate.mjs && node scripts/seed.mjs',{cwd:repo,env:{...process.env,DATABASE_URL:url},stdio:'inherit'});
 const db=new pg.Client({connectionString:url}); await db.connect(); await ensureAppRole(db); process.env.DATABASE_URL=appUrl(); process.env.RATE_LIMIT_DISABLED='true';
 const {createApp}=await import(pathToFileURL(join(repo,'apps/api/dist/app.factory.js')).href); const app=await createApp(); await app.listen(0); const base=`http://127.0.0.1:${app.getHttpServer().address().port}/api/v1`;
 const api=async(method,path,token,body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body&&JSON.stringify(body)});return {status:r.status,body:await r.json().catch(()=>({}))};};
 const tag=`p7-${randomUUID().slice(0,8)}`; const password='Password123!'; const hash=await bcrypt.hash(password,12);
 try {
  const role=await db.query(`SELECT id FROM roles WHERE slug='parent_primary'`); const org=await db.query(`INSERT INTO organizations(slug,name_fr,wilaya) VALUES($1,'P7','31') RETURNING id`,[tag]);
  const site=await db.query(`INSERT INTO sites(organization_id,name_fr) VALUES($1,'S') RETURNING id`,[org.rows[0].id]);
  const room=await db.query(`INSERT INTO rooms(organization_id,site_id,name_fr,max_capacity) VALUES($1,$2,'R',10) RETURNING id`,[org.rows[0].id,site.rows[0].id]);
  const creator=await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'D','T',$2,'active') RETURNING id`,[`${tag}-director@test.dz`,hash]);
  const child=await db.query(`INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,created_by) VALUES($1,$2,$3,'P7-1','Yanis','Test','2024-01-01',$4) RETURNING id`,[org.rows[0].id,site.rows[0].id,room.rows[0].id,creator.rows[0].id]);
  const mk=async(email)=>{const u=await db.query(`INSERT INTO users(email,first_name,last_name,password_hash,status) VALUES($1,'P','T',$2,'active') RETURNING id`,[email,hash]); await db.query(`INSERT INTO memberships(organization_id,user_id,role_id,is_active,joined_at) VALUES($1,$2,$3,true,NOW())`,[org.rows[0].id,u.rows[0].id,role.rows[0].id]); const g=await db.query(`INSERT INTO guardians(organization_id,user_id,first_name_fr,last_name_fr,relationship,created_by) VALUES($1,$2,'P','T','parent',$3) RETURNING id`,[org.rows[0].id,u.rows[0].id,creator.rows[0].id]); return {u:u.rows[0].id,g:g.rows[0].id};};
  const allowed=await mk(`${tag}-a@test.dz`), denied=await mk(`${tag}-b@test.dz`);
  await db.query(`INSERT INTO child_guardians(organization_id,child_id,guardian_id,can_view_journal) VALUES($1,$2,$3,true),($1,$2,$4,false)`,[org.rows[0].id,child.rows[0].id,allowed.g,denied.g]);
  const ta=(await api('POST','/auth/login',null,{email:`${tag}-a@test.dz`,password})).body.access_token; const tb=(await api('POST','/auth/login',null,{email:`${tag}-b@test.dz`,password})).body.access_token;
  ok('Parent autorisé voit son enfant',(await api('GET','/parent/children',ta)).body.length===1);
  ok('Parent autorisé accède au fil',(await api('GET',`/parent/children/${child.rows[0].id}/feed`,ta)).status===200);
  const forbidden=await api('GET',`/parent/children/${child.rows[0].id}/feed`,tb); ok('Second parent sans permission bloqué',forbidden.status===403&&forbidden.body.code==='PARENT_ACCESS_DENIED');
  const absent=await api('POST','/parent/absence',tb,{child_id:child.rows[0].id}); ok('Second parent ne signale pas une absence',absent.status===403);
 } finally { await app.close(); await db.end(); }
 if(failures.length) process.exit(1); console.log('✓ Phase 7 parent isolation validée');
}; main().catch(e=>{console.error(e.stack);process.exit(1)});
