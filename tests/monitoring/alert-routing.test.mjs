import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
test('E2 : Prometheus transmet à Alertmanager indépendamment des workers',()=>{
  const p=readFileSync('infrastructure/monitoring/prometheus.yml','utf8');
  assert.match(p,/alerting:[\s\S]*alertmanager:9093/);
});
test('E2 : récepteur authentifié, durable, aucun port relay exposé publiquement',()=>{
  const a=readFileSync('infrastructure/monitoring/alertmanager.yml','utf8');
  assert.match(a,/alert-relay:8091\/alerts/); assert.match(a,/credentials_file:/);
  const c=readFileSync('infrastructure/docker/docker-compose.prod.yml','utf8').split('  alert-relay:')[1]?.split('  postgres-exporter:')[0];
  assert.ok(c); assert.doesNotMatch(c,/\n    ports:/); assert.match(c,/alerts_data:/);
});
