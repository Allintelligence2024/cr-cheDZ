#!/usr/bin/env node
/** E2 : vrais exporter/Prometheus/Alertmanager, PostgreSQL existant et aucun worker.
 * DESTRUCTIF pour les ticks, réservé au cluster de test du gate D, exécuté APRÈS
 * les autres suites. SMTP local réel, SMS/WA via simulateur HTTP sans frais.
 */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,readFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {fixture,token} from '../tests/monitoring/relay-fixture.mjs';

// G5 diagnostic : les logs bruts des jobs privés ne sont pas lisibles par
// l'agent (portée Actions) — la première erreur non traitée est publiée en
// annotation GitHub (message tronqué, jamais de secret) pour rendre le
// prochain échec diagnostiquable via l'API check-runs/annotations.
process.on('unhandledRejection', (error) => {
  const message = String(error?.message ?? error).replace(/\r?\n/g, ' | ').slice(0, 400);
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error title=E2 stack interrompue::${message}`);
  console.error(error);
  process.exit(1);
});

assert.equal(process.env.ALLOW_DATABASE_RESET,'1','Cluster jetable requis');
assert.equal(process.env.PRODUCTION_ROLE_TESTS,'1','Gate exige les vrais rôles de production');
assert.ok(new URL(process.env.DATABASE_URL).pathname.endsWith('_test'));
assert.ok(process.env.APP_DATABASE_URL);
if(spawnSync('docker',['info'],{stdio:'ignore'}).status!==0){console.error('Docker indisponible : gate E2 non exécuté');process.exit(2);}
const checked=spawnSync(process.execPath,['scripts/check-worker-monitoring.mjs'],{env:{...process.env,MONITORING_USE_DOCKER:'1'},stdio:'inherit'});
assert.equal(checked.status,0,'promtool doit passer avant le test réseau');
const db=new pg.Client({connectionString:process.env.DATABASE_URL});await db.connect();
const app=new pg.Client({connectionString:process.env.APP_DATABASE_URL});await app.connect();
const role=(await app.query('SELECT current_user AS name, rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
assert.equal(role.name,'creche_app');assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
const dir=await mkdtemp(join(tmpdir(),'creche-e2-stack-'));await chmod(dir,0o755);
const f=await fixture();const names=[];
const port=async()=>{const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const n=s.address().port;await new Promise(r=>s.close(r));return n;};
const [exporterPort,promPort,amPort]=await Promise.all([port(),port(),port()]);
const run=(name,image,args,extra=[])=>{
  const n=`creche-e2-${process.pid}-${name}`;names.push(n);
  execFileSync('docker',['run','-d','--name',n,'--network','host','--user',`${process.getuid()}:${process.getgid()}`,
    '-v',`${dir}:/etc/e2:ro`,...extra,image,...args],{stdio:['ignore','pipe','pipe']});
};
async function until(check,label,ms=90000){const deadline=Date.now()+ms;while(Date.now()<deadline){try{if(await check())return;}catch{/* démarrage réseau */}await delay(300);}throw new Error(`Timeout: ${label}`);}
async function journal(){return (await readFile(join(f.dir,'alerts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);}
try {
  await db.query('UPDATE scheduler_ticks SET last_success_at=NOW()');
  await writeFile(join(dir,'token'),token,{mode:0o600});
  await writeFile(join(dir,'exporter.env'),`DATA_SOURCE_NAME=${process.env.APP_DATABASE_URL}\nPG_EXPORTER_EXTEND_QUERY_PATH=/etc/e2/queries.yml\nPGSSLMODE=disable\n`,{mode:0o600});
  await writeFile(join(dir,'queries.yml'),await readFile('infrastructure/monitoring/postgres-queries.yml'));
  // Expressions/routage inchangés ; uniquement délais accélérés. Les délais
  // de production sont évalués sans modification par promtool juste au-dessus.
  const rules=(await readFile('infrastructure/monitoring/alerts.yml','utf8')).replace(/for: [25]m/g,'for: 2s');
  await writeFile(join(dir,'alerts.yml'),rules);
  const am=(await readFile('infrastructure/monitoring/alertmanager.yml','utf8'))
    .replace('http://alert-relay:8091',`http://127.0.0.1:${f.port}`).replace('/run/secrets/alert-webhook-token','/etc/e2/token')
    .replace('group_wait: 10s','group_wait: 1s').replace('group_interval: 1m','group_interval: 2s');
  await writeFile(join(dir,'alertmanager.yml'),am);
  const prom=(await readFile('infrastructure/monitoring/prometheus.yml','utf8'))
    .replaceAll('15s','1s').replace('/etc/prometheus/alerts.yml','/etc/e2/alerts.yml')
    .replace('postgres-exporter:9187',`127.0.0.1:${exporterPort}`).replace('alertmanager:9093',`127.0.0.1:${amPort}`)
    // H2k : le job api référence un credentials_file hors dépôt. Prometheus lit
    // ce fichier au chargement de la config ; un placeholder suffit — ce gate
    // N'A pas d'API et ne collecte que la voie E2 (exporter SQL), inchangée.
    .replace('/run/secrets/metrics-collector-token','/etc/e2/metrics-collector-token');
  await writeFile(join(dir,'prometheus.yml'),prom);
  await writeFile(join(dir,'metrics-collector-token'),'e2-gate-placeholder-not-a-real-credential\n',{mode:0o600});
  run('exporter','prometheuscommunity/postgres-exporter:v0.15.0',[`--web.listen-address=127.0.0.1:${exporterPort}`],['--env-file',join(dir,'exporter.env')]);
  await until(async()=>{const text=await(await fetch(`http://127.0.0.1:${exporterPort}/metrics`)).text();return (text.match(/^creche_worker_scheduler_overdue\{/gm)??[]).length===3;},'3 métriques SQL réelles');
  run('am','prom/alertmanager:v0.27.0',['--config.file=/etc/e2/alertmanager.yml','--storage.path=/tmp/am',`--web.listen-address=127.0.0.1:${amPort}`,'--cluster.listen-address=']);
  await until(async()=>(await fetch(`http://127.0.0.1:${amPort}/-/ready`)).ok,'Alertmanager prêt');
  run('prom','prom/prometheus:v2.53.0',['--config.file=/etc/e2/prometheus.yml','--storage.tsdb.path=/tmp/prom',`--web.listen-address=127.0.0.1:${promPort}`]);
  await until(async()=>(await fetch(`http://127.0.0.1:${promPort}/-/ready`)).ok,'Prometheus prêt');
  // AUCUN worker n'est démarré dans ce test. C'est la DB qui porte la fraîcheur.
  await db.query("UPDATE scheduler_ticks SET last_success_at=NOW()-INTERVAL '3 days'");
  await until(async()=>new Set((await journal()).filter(x=>x.status==='firing'&&x.name==='WorkerScheduledJobOverdue').map(x=>x.job)).size===3,'alertes reçues localement sans worker');
  await until(()=>f.mails.length>=3&&f.calls.filter(c=>c.has('ContentSid')).length>=3&&f.calls.filter(c=>!c.has('ContentSid')).length>=3,'e-mail/SMS/WhatsApp transmis');
  await db.query('UPDATE scheduler_ticks SET last_success_at=NOW()');
  await until(async()=>new Set((await journal()).filter(x=>x.status==='resolved'&&x.name==='WorkerScheduledJobOverdue').map(x=>x.job)).size===3,'résolution reçue');
  await until(()=>f.mails.length>=6&&f.calls.filter(c=>c.has('ContentSid')).length>=6&&f.calls.filter(c=>!c.has('ContentSid')).length>=6,'résolutions transmises aux trois canaux');
  execFileSync('docker',['stop',names[0]],{stdio:'ignore'});
  await until(async()=>(await journal()).some(x=>x.status==='firing'&&x.name==='DatabaseMetricsUnavailable'),'perte exporter signalée');
  console.log('✓ E2 STACK : SQL app → exporter → Prometheus → Alertmanager → local/SMTP/SMS/WhatsApp ; firing/résolution/perte exporter. Aucun worker, aucun envoi externe.');
} finally {
  for(const name of names){const logs=spawnSync('docker',['logs',name],{encoding:'utf8'});await writeFile(join(dir,`${name}.log`),(logs.stdout??'')+(logs.stderr??''));spawnSync('docker',['rm','-f',name],{stdio:'ignore'});}
  await f.close();await app.end();await db.end();
  console.log(`Logs E2 : ${dir} (ne contiennent que des fixtures)`);
}
