import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAlertRelay,relayConfig} from '../../apps/api/operations/alert-relay.mjs';
import {fixture,sample,token} from './relay-fixture.mjs';
test('E2 : local + SMTP réel de test + SMS/WhatsApp simulés, puis déduplication après redémarrage',async()=>{
  const f=await fixture();try{
    assert.equal((await f.post()).status,200);assert.equal(f.mails.length,1);assert.equal(f.calls.length,2);
    assert.ok(f.calls.some(c=>c.get('ContentSid')===f.env.ALERT_WHATSAPP_CONTENT_SID));
    assert.ok(f.calls.some(c=>c.get('To')===f.env.ALERT_SMS_TO));
    const journal=await readFile(join(f.dir,'alerts.jsonl'),'utf8');assert.ok(journal.includes('payments_expire'));
    assert.ok(!journal.includes('NEVER_FORWARD'));assert.ok(!f.mails.join('').includes('NEVER_FORWARD'));
    await f.restart();assert.equal((await f.post()).status,200);assert.equal(f.mails.length,1);assert.equal(f.calls.length,2);
    const resolved=structuredClone(sample);resolved.alerts[0].status='resolved';resolved.alerts[0].endsAt='2026-09-14T01:00:00Z';
    assert.equal((await f.post(resolved)).status,200);assert.equal(f.mails.length,2);assert.equal(f.calls.length,4);
  }finally{await f.close();}
});
test('E2 : échec SMS → 503/retry ; e-mail et WhatsApp déjà acceptés ne sont pas renvoyés',async()=>{
  const f=await fixture();try{f.rejectSms(true);assert.equal((await f.post()).status,503);
    f.rejectSms(false);await f.restart();assert.equal((await f.post()).status,200);
    assert.equal(f.mails.length,1);assert.equal(f.calls.filter(c=>c.has('ContentSid')).length,1);
    assert.equal(f.calls.filter(c=>!c.has('ContentSid')).length,2);
  }finally{await f.close();}
});
test('E2 : auth, liste fermée des alertes, limites de taille et concurrence',async()=>{
  const f=await fixture();try{
    assert.equal((await f.post(sample,'wrong')).status,401);
    const bad=structuredClone(sample);bad.alerts[0].labels.alertname='arbitrary';assert.equal((await f.post(bad)).status,400);
    assert.equal((await f.post({alerts:[],padding:'x'.repeat(70000)})).status,413);
    assert.ok((await Promise.all([f.post(),f.post()])).every(r=>r.status===200));assert.equal(f.mails.length,1);
  }finally{await f.close();}
});
test('E2 : configuration incomplète / URL fournisseur substituée / état corrompu = refus',async()=>{
  await assert.rejects(relayConfig({}),/TOKEN_REQUIRED/);
  await assert.rejects(relayConfig({ALERT_WEBHOOK_TOKEN:token}),/EMAIL_CONFIG_REQUIRED/);
  await assert.rejects(relayConfig({ALERT_WEBHOOK_TOKEN:token,ALERT_CHANNELS:'local',ALERT_TEST_TWILIO_URL:'http://example.com',NODE_ENV:'production'}),/TEST_URL_FORBIDDEN/);
  const dir=await mkdtemp(join(tmpdir(),'alert-bad-'));await writeFile(join(dir,'ledger.json'),'INVALID');
  await assert.rejects(createAlertRelay({ALERT_WEBHOOK_TOKEN:token,ALERT_CHANNELS:'local',ALERT_STATE_DIR:dir}));
});
