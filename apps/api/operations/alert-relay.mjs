#!/usr/bin/env node
// Relais d'exploitation distinct de l'API et du worker. Aucun accès DB/PII.
import {createServer} from 'node:http';
import {createHash, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, appendFile, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import nodemailer from 'nodemailer';

const ALERTS = new Set(['WorkerScheduledJobOverdue','WorkerSchedulerMonitoringUnavailable','DatabaseMetricsUnavailable']);
const JOBS = new Set(['payments_expire','retention_purge','video_clips_purge']);
const hash = value => createHash('sha256').update(value).digest('hex');
const phone = value => /^\+[1-9]\d{6,14}$/.test(value ?? '');
const email = value => /^[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+$/.test(value ?? '');

export async function relayConfig(env = process.env) {
  const secret = env.ALERT_WEBHOOK_TOKEN_FILE
    ? (await readFile(env.ALERT_WEBHOOK_TOKEN_FILE,'utf8')).trim() : env.ALERT_WEBHOOK_TOKEN;
  if (!secret || secret.length < 32) throw new Error('ALERT_WEBHOOK_TOKEN_REQUIRED');
  const channels = [...new Set(['local',...(env.ALERT_CHANNELS ?? 'local,email,sms,whatsapp').split(',')])];
  if (channels.some(c=>!['local','email','sms','whatsapp'].includes(c))) throw new Error('ALERT_CHANNEL_INVALID');
  const need = (condition, code) => { if(!condition) throw new Error(code); };
  if(channels.includes('email')) {
    need(env.ALERT_SMTP_HOST && email(env.ALERT_EMAIL_FROM) && email(env.ALERT_EMAIL_TO),'ALERT_EMAIL_CONFIG_REQUIRED');
    need(!/[\r\n]/.test(env.ALERT_SMTP_HOST),'ALERT_SMTP_HOST_INVALID');
  }
  if(channels.some(c=>c==='sms'||c==='whatsapp')) {
    need(/^AC[0-9a-f]{32}$/i.test(env.ALERT_TWILIO_ACCOUNT_SID ?? '') && env.ALERT_TWILIO_AUTH_TOKEN,'ALERT_TWILIO_CONFIG_REQUIRED');
  }
  if(channels.includes('sms')) need(phone(env.ALERT_SMS_FROM) && phone(env.ALERT_SMS_TO),'ALERT_SMS_CONFIG_REQUIRED');
  if(channels.includes('whatsapp')) need(phone(env.ALERT_WHATSAPP_FROM) && phone(env.ALERT_WHATSAPP_TO)
    && /^HX[0-9a-f]{32}$/i.test(env.ALERT_WHATSAPP_CONTENT_SID ?? ''),'ALERT_WHATSAPP_TEMPLATE_REQUIRED');
  const testUrl=env.ALERT_TEST_TWILIO_URL;
  if(testUrl) {
    const u=new URL(testUrl);
    need(env.NODE_ENV==='test' && u.protocol==='http:' && ['127.0.0.1','localhost'].includes(u.hostname),'ALERT_TEST_URL_FORBIDDEN');
  }
  return {env,secret,channels,dir:resolve(env.ALERT_STATE_DIR ?? '/var/lib/creche-alerts'),twilio:testUrl ?? 'https://api.twilio.com'};
}

function normalize(body) {
  if(!Array.isArray(body?.alerts) || !body.alerts.length || body.alerts.length>100) throw new Error('ALERT_PAYLOAD_INVALID');
  return body.alerts.map(a=>{
    if(!ALERTS.has(a.labels?.alertname) || !['firing','resolved'].includes(a.status)
      || typeof a.startsAt!=='string' || !Number.isFinite(Date.parse(a.startsAt))
      || (a.status==='resolved' && !Number.isFinite(Date.parse(a.endsAt)))) throw new Error('ALERT_PAYLOAD_INVALID');
    const job=a.labels.job_type;
    if(a.labels.alertname==='WorkerScheduledJobOverdue' && !JOBS.has(job)) throw new Error('ALERT_JOB_INVALID');
    // Ni annotations arbitraires, ni externalURL, ni destinataires du webhook.
    const event={name:a.labels.alertname,job:JOBS.has(job)?job:'monitoring',status:a.status,startsAt:new Date(a.startsAt).toISOString(),
      endsAt:a.status==='resolved'?new Date(a.endsAt).toISOString():null};
    return {...event,id:hash(JSON.stringify([event,a.fingerprint ?? '',a.labels.instance ?? '']))};
  });
}

export async function createAlertRelay(env=process.env) {
  const config=await relayConfig(env);
  await mkdir(config.dir,{recursive:true,mode:0o700});
  const ledgerPath=join(config.dir,'ledger.json'); const journal=join(config.dir,'alerts.jsonl');
  let ledger={};
  try {ledger=JSON.parse(await readFile(ledgerPath,'utf8'));} catch(error) {if(error.code!=='ENOENT') throw error;}
  // Un ledger corrompu n'est pas remplacé silencieusement (SMS dupliqués).
  if(!ledger || Array.isArray(ledger) || typeof ledger!=='object') throw new Error('ALERT_LEDGER_INVALID');
  for(const [id,state] of Object.entries(ledger)) {
    if(!/^[0-9a-f]{64}$/.test(id) || !state || !Number.isFinite(state.at) || !Array.isArray(state.channels)
      || state.channels.some(c=>!['local','email','sms','whatsapp'].includes(c))) throw new Error('ALERT_LEDGER_INVALID');
  }
  const save=async()=>{await writeFile(`${ledgerPath}.tmp`,JSON.stringify(ledger),{mode:0o600}); await rename(`${ledgerPath}.tmp`,ledgerPath);};
  const transport=config.channels.includes('email')?nodemailer.createTransport({
    host:env.ALERT_SMTP_HOST,port:Number(env.ALERT_SMTP_PORT ?? 587),secure:env.ALERT_SMTP_SECURE==='true',
    requireTLS:env.NODE_ENV!=='test',connectionTimeout:5000,greetingTimeout:5000,socketTimeout:10000,
    ...(env.ALERT_SMTP_USER?{auth:{user:env.ALERT_SMTP_USER,pass:env.ALERT_SMTP_PASS}}:{}),
  }):null;
  async function deliver(channel,event) {
    const text=`Crèche DZ | ${event.status.toUpperCase()} | ${event.name} | ${event.job}`;
    if(channel==='local') {
      try {if((await stat(journal)).size>1_048_576) await rename(journal,`${journal}.1`);} catch(e) {if(e.code!=='ENOENT') throw e;}
      await appendFile(journal,JSON.stringify({at:new Date().toISOString(),...event})+'\n',{mode:0o600}); return;
    }
    if(channel==='email') {
      const info=await transport.sendMail({from:env.ALERT_EMAIL_FROM,to:env.ALERT_EMAIL_TO,subject:text,text});
      if(!info.accepted?.length || info.rejected?.length) throw new Error('EMAIL_NOT_ACCEPTED');
      return;
    }
    const form=new URLSearchParams(channel==='sms'?{From:env.ALERT_SMS_FROM,To:env.ALERT_SMS_TO,Body:text}:{
      From:`whatsapp:${env.ALERT_WHATSAPP_FROM}`,To:`whatsapp:${env.ALERT_WHATSAPP_TO}`,
      ContentSid:env.ALERT_WHATSAPP_CONTENT_SID,ContentVariables:JSON.stringify({'1':event.name,'2':event.status,'3':event.job}),
    });
    const response=await fetch(`${config.twilio}/2010-04-01/Accounts/${env.ALERT_TWILIO_ACCOUNT_SID}/Messages.json`,{
      method:'POST',headers:{authorization:`Basic ${Buffer.from(`${env.ALERT_TWILIO_ACCOUNT_SID}:${env.ALERT_TWILIO_AUTH_TOKEN}`).toString('base64')}`,
        'content-type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(10000),
    });
    if(!response.ok) {await response.body?.cancel();throw new Error('PHONE_PROVIDER_REJECTED');}
    const receipt=await response.json();
    if(!/^SM[0-9a-f]{32}$/i.test(receipt.sid ?? '') || ['failed','undelivered'].includes(receipt.status)) throw new Error('PHONE_NOT_ACCEPTED');
    // Accepté par le prestataire, PAS preuve de livraison au téléphone.
  }
  let chain=Promise.resolve(),queued=0,failures=0;
  async function processEvents(events) {
    const now=Date.now();
    for(const [key,value] of Object.entries(ledger)) if(now-value.at>86400000) delete ledger[key];
    let failed=false;
    for(const event of events) {
      // TTL 1 h < repeat_interval AM 4 h : retries dédupliqués, rappels permis.
      let state=ledger[event.id];
      if(!state || now-state.at>3600000) {
        if(Object.keys(ledger).length>=5000) throw new Error('ALERT_LEDGER_FULL');
        state=ledger[event.id]={at:now,channels:[]};
      }
      for(const channel of config.channels) {
        if(state.channels.includes(channel)) continue;
        try {await deliver(channel,event); state.channels.push(channel); await save();}
        catch {failed=true; failures++; console.error(`[alert-relay] CHANNEL_FAILED:${channel}`);}
      }
    }
    await save(); // Ne jamais acquitter si la persistance des reçus est indisponible.
    if(failed) throw new Error('ALERT_DELIVERY_INCOMPLETE');
  }
  const expected=createHash('sha256').update(`Bearer ${config.secret}`).digest();
  const server=createServer(async(req,res)=>{
    if(req.url==='/healthz' && req.method==='GET') {res.writeHead(200).end('ok');return;}
    const actual=createHash('sha256').update(req.headers.authorization ?? '').digest();
    if(!timingSafeEqual(expected,actual)) {res.writeHead(401).end();return;}
    if(req.url==='/status' && req.method==='GET') {
      res.setHeader('content-type','application/json');res.end(JSON.stringify({channels:config.channels,queued,failures,tracked:Object.keys(ledger).length}));return;
    }
    if(req.url!=='/alerts' || req.method!=='POST') {res.writeHead(404).end();return;}
    if(queued>=16) {res.writeHead(429).end();return;}
    queued++;
    try {
      let raw=''; for await(const chunk of req) {raw+=chunk; if(Buffer.byteLength(raw)>65536) {res.writeHead(413).end();return;}}
      let events;
      try {events=normalize(JSON.parse(raw));} catch {res.writeHead(400).end();return;}
      const work=chain.then(()=>processEvents(events)); chain=work.catch(()=>{});
      try {await work;res.writeHead(200).end('accepted');} catch {res.writeHead(503).end('retry');}
    } catch {if(!res.headersSent)res.writeHead(400);res.end();}
    finally {queued--;}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {server,close:async()=>{server.closeIdleConnections();await new Promise(r=>server.close(r));await chain;transport?.close();}};
}

if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  createAlertRelay().then(relay=>{
    relay.server.listen(Number(process.env.ALERT_PORT ?? 8091),'0.0.0.0',()=>console.log('[alert-relay] ready'));
    let stopping=false;
    const stop=()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),30000);timer.unref();relay.close().then(()=>{clearTimeout(timer);process.exit(0);});};
    process.on('SIGTERM',stop);process.on('SIGINT',stop);
  }).catch(()=>{console.error('[alert-relay] CONFIG_OR_STATE_INVALID — vérifier les variables et le volume privé');process.exit(1);});
}
