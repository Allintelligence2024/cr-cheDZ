import { GoogleAuth } from 'google-auth-library';
import { createSign } from 'node:crypto';
import * as http2 from 'node:http2';
import { Pool } from 'pg';

/** Worker : jobs transactionnels + livraison FCM HTTP v1. */
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const firebaseCredentials = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) as { project_id: string } : null;
const googleAuth = firebaseCredentials ? new GoogleAuth({ credentials: firebaseCredentials, scopes: ['https://www.googleapis.com/auth/firebase.messaging'] }) : null;

const JOB_HANDLERS: Record<string, (payload: unknown, orgId: string | null) => Promise<void>> = {
  send_parent_notification: async () => {},
  compress_media: async () => {},
  generate_invoice_pdf: async () => {},
  send_monthly_invoices: async () => {},
  export_report: async () => {},
};

async function processNextJob(): Promise<boolean> {
 const client=await pool.connect(); let jobId:string|null=null;
 try { await client.query('BEGIN'); const res=await client.query(`SELECT id,job_type,payload,organization_id,attempts FROM background_jobs WHERE status='pending' AND scheduled_at<=NOW() AND attempts<max_attempts ORDER BY priority DESC,scheduled_at LIMIT 1 FOR UPDATE SKIP LOCKED`);
  if(!res.rows[0]){await client.query('ROLLBACK');return false;} const job=res.rows[0] as {id:string;job_type:string;payload:unknown;organization_id:string|null;attempts:number}; jobId=job.id;
  await client.query(`UPDATE background_jobs SET status='processing',started_at=NOW(),attempts=attempts+1 WHERE id=$1`,[job.id]); await client.query('COMMIT');
  const handler=JOB_HANDLERS[job.job_type]; if(!handler) throw new Error(`Type de job inconnu: ${job.job_type}`); await handler(job.payload,job.organization_id);
  await pool.query(`UPDATE background_jobs SET status='done',completed_at=NOW() WHERE id=$1`,[job.id]); return true;
 } catch(error) { if(jobId) await pool.query(`UPDATE background_jobs SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,failed_at=NOW(),failure_reason=$1,scheduled_at=NOW()+(INTERVAL '1 minute'*POWER(2,attempts)) WHERE id=$2`,[String((error as Error).message),jobId]); return true;
 } finally { client.release(); }
}

async function fcmSend(token: string, notification: { title: string; body: string; data: Record<string, string> }): Promise<void> {
 if(!googleAuth || !firebaseCredentials) throw new Error('FCM_NOT_CONFIGURED');
 const client=await googleAuth.getClient(); const headers=await client.getRequestHeaders();
 const response=await fetch(`https://fcm.googleapis.com/v1/projects/${firebaseCredentials.project_id}/messages:send`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({message:{token,notification:{title:notification.title,body:notification.body},data:notification.data,android:{priority:'high'},apns:{headers:{'apns-priority':'10'},payload:{aps:{sound:'default'}}}}})});
 if(!response.ok) throw new Error(`FCM_${response.status}:${(await response.text()).slice(0,300)}`);
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');
/** APNs HTTP/2 direct, avec JWT ES256 Apple renouvelé à chaque livraison. */
async function apnsSend(token: string, notification: { title: string; body: string; data: Record<string, string> }): Promise<void> {
 const keyId=process.env.APNS_KEY_ID; const teamId=process.env.APNS_TEAM_ID; const topic=process.env.APNS_BUNDLE_ID;
 const key=process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, '\n');
 if(!keyId || !teamId || !topic || !key) throw new Error('APNS_NOT_CONFIGURED');
 const header=b64url(JSON.stringify({alg:'ES256',kid:keyId})); const payload=b64url(JSON.stringify({iss:teamId,iat:Math.floor(Date.now()/1000)}));
 const signer=createSign('SHA256'); signer.update(`${header}.${payload}`); signer.end(); const jwt=`${header}.${payload}.${signer.sign({key,dsaEncoding:'ieee-p1363'}).toString('base64url')}`;
 const host=process.env.APNS_PRODUCTION === 'true' ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com';
 await new Promise<void>((resolve,reject)=>{ const client=http2.connect(host); client.on('error',reject); const req=client.request({':method':'POST',':path':`/3/device/${token}`,authorization:`bearer ${jwt}`,'apns-topic':topic,'apns-push-type':'alert','apns-priority':'10','content-type':'application/json'});
  let body=''; req.setEncoding('utf8'); req.on('data',(chunk)=>{body+=chunk;}); req.on('response',(headers)=>{const status=Number(headers[':status']); if(status===200) resolve(); else reject(new Error(`APNS_${status}:${body.slice(0,300)}`));}); req.on('error',reject); req.on('close',()=>client.close()); req.end(JSON.stringify({aps:{alert:{title:notification.title,body:notification.body},sound:'default'},...notification.data})); });
}

/** Claim en SKIP LOCKED, préférence/quiet-hours déjà appliquées à scheduled_at. */
async function drainNotificationQueue(): Promise<void> {
 const client=await pool.connect();
 try { await client.query('BEGIN'); const claimed=await client.query(`SELECT id,organization_id,user_id,title_fr,title_ar,body_fr,body_ar,data FROM notification_queue WHERE status='pending' AND scheduled_at<=NOW() ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED`);
  for(const n of claimed.rows) {
   await client.query(`UPDATE notification_queue SET status='processing',attempts=attempts+1 WHERE id=$1`,[n.id]);
   const devices=await client.query(`SELECT platform, fcm_token, apns_token FROM devices WHERE organization_id=$1 AND registered_by=$2 AND is_active=true AND revoked_at IS NULL AND (fcm_token IS NOT NULL OR apns_token IS NOT NULL)`,[n.organization_id,n.user_id]);
   try {
    const message={title:n.title_fr,body:n.body_fr,data:Object.fromEntries(Object.entries(n.data??{}).map(([k,v])=>[k,String(v)]))};
    let delivered=false;
    for(const d of devices.rows) {
      if(d.fcm_token && googleAuth) { await fcmSend(d.fcm_token,message); delivered=true; }
      else if(d.platform === 'ios' && d.apns_token) { await apnsSend(d.apns_token,message); delivered=true; }
    }
    // Sans jeton/configuration, l'inbox reste la voie fiable ; ne jamais envoyer de données sensibles à un tiers.
    await client.query(`UPDATE notification_queue SET status='sent',sent_at=NOW(),failure_reason=CASE WHEN $2 THEN NULL ELSE 'PUSH_NOT_CONFIGURED_OR_NO_DEVICE' END WHERE id=$1`,[n.id,delivered]);
   } catch(error) { await client.query(`UPDATE notification_queue SET status=CASE WHEN attempts>=max_attempts THEN 'failed' ELSE 'pending' END,failed_at=NOW(),failure_reason=$1,scheduled_at=NOW()+(INTERVAL '1 minute'*POWER(2,attempts)) WHERE id=$2`,[String((error as Error).message),n.id]); }
  }
  await client.query('COMMIT');
 } catch(error) { await client.query('ROLLBACK'); throw error; } finally {client.release();}
}
async function run():Promise<void>{ console.log('[worker] démarré — FCM HTTP v1'); while(true){const had=await processNextJob();await drainNotificationQueue();if(!had) await new Promise(r=>setTimeout(r,2000));}}
run().catch(error=>{console.error('[worker] fatal:',error);process.exit(1)});
