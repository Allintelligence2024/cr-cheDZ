import {createServer as http} from 'node:http';
import {createServer as net} from 'node:net';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAlertRelay} from '../../apps/api/operations/alert-relay.mjs';
export const token='test-alert-relay-token-32-characters-only';
export const sample={version:'4',alerts:[{status:'firing',fingerprint:'1234abcd',startsAt:'2026-09-14T00:00:00Z',
  labels:{alertname:'WorkerScheduledJobOverdue',job_type:'payments_expire',instance:'db:9187'},
  annotations:{description:'NEVER_FORWARD_CHILD_OR_SECRET'},endsAt:'0001-01-01T00:00:00Z'}]};
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));
export async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'alert-relay-')); const mails=[],calls=[];
  const smtp=net(socket=>{socket.write('220 test ESMTP\r\n');let buffer='',data=false,mail='';
    socket.on('data',chunk=>{buffer+=chunk;let i;while((i=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+2);
      if(data){if(line==='.'){data=false;mails.push(mail);mail='';socket.write('250 queued\r\n');}else mail+=line+'\n';}
      else if(line==='DATA'){data=true;socket.write('354 data\r\n');}
      else if(line==='QUIT')socket.end('221 bye\r\n');else socket.write('250 ok\r\n');}});
  });await listen(smtp);
  let rejectSms=false;
  const provider=http(async(req,res)=>{let raw='';for await(const c of req)raw+=c;const form=new URLSearchParams(raw);calls.push(form);
    if(rejectSms&&!form.has('ContentSid')){res.writeHead(503).end('{}');return;}
    res.setHeader('content-type','application/json');res.writeHead(201).end(JSON.stringify({sid:'SM'+'1'.repeat(32),status:'queued'}));
  });await listen(provider);
  const env={NODE_ENV:'test',ALERT_WEBHOOK_TOKEN:token,ALERT_STATE_DIR:dir,ALERT_CHANNELS:'local,email,sms,whatsapp',
    ALERT_SMTP_HOST:'127.0.0.1',ALERT_SMTP_PORT:String(smtp.address().port),ALERT_EMAIL_FROM:'alerts@test.dz',ALERT_EMAIL_TO:'operator@test.dz',
    ALERT_TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),ALERT_TWILIO_AUTH_TOKEN:'test-only',ALERT_TEST_TWILIO_URL:`http://127.0.0.1:${provider.address().port}`,
    ALERT_SMS_FROM:'+12025550101',ALERT_SMS_TO:'+213555000001',ALERT_WHATSAPP_FROM:'+12025550102',ALERT_WHATSAPP_TO:'+213555000001',ALERT_WHATSAPP_CONTENT_SID:'HX'+'2'.repeat(32)};
  let relay=await createAlertRelay(env);await listen(relay.server);
  return {dir,mails,calls,env,get port(){return relay.server.address().port;},rejectSms:v=>{rejectSms=v;},
    post:(body=sample,key=token)=>fetch(`http://127.0.0.1:${relay.server.address().port}/alerts`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)}),
    restart:async()=>{await relay.close();relay=await createAlertRelay(env);await listen(relay.server);},
    close:async()=>{await relay.close();await close(smtp);provider.closeAllConnections();await close(provider);}};
}
