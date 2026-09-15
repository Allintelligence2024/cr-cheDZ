// Structure de déploiement uniquement ; évaluation PromQL via promtool séparée.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
const root=process.env.MONITORING_TEST_ROOT ?? '.';
const read=p=>readFileSync(join(root,p),'utf8');
test('E2 : Prometheus charge les alertes montées par Compose',()=>{
  assert.match(read('infrastructure/monitoring/prometheus.yml'),/rule_files:\s+- \/etc\/prometheus\/alerts.yml/);
  assert.match(read('infrastructure/docker/docker-compose.prod.yml'),/monitoring\/alerts.yml:\/etc\/prometheus\/alerts.yml:ro/);
  for(const stage of ['prod','staging']) for(const key of ['WORKER_SCHEDULER_ENABLED','WORKER_SCHEDULER_POLL_MS','WORKER_EXPORT_TIMEOUT_MS','WORKER_EXPORT_MAX_AGE_MS']) {
    assert.ok(read(`infrastructure/docker/docker-compose.${stage}.yml`).includes(`${key}: ${'$'}{${key}:-`), `${stage} doit transmettre ${key}`);
  }
});
test('E2 : exporter indépendant des workers, requête de santé câblée après migration',()=>{
  const compose=read('infrastructure/docker/docker-compose.prod.yml');
  const block=compose.split('  postgres-exporter:')[1].split('  grafana:')[0];
  assert.match(block,/PG_EXPORTER_EXTEND_QUERY_PATH: \/etc\/postgres-exporter\/queries.yml/);
  assert.match(block,/monitoring\/postgres-queries.yml:\/etc\/postgres-exporter\/queries.yml:ro/);
  assert.match(block,/migrate:\s+condition: service_completed_successfully/);
  assert.doesNotMatch(block,/worker:/);
  const queries=read('infrastructure/monitoring/postgres-queries.yml');
  assert.match(queries,/^creche_worker_scheduler:/m);
  assert.equal(JSON.parse(queries.match(/^  query: (.+)$/m)[1]),'SELECT job_type, overdue::int AS overdue FROM scheduler_health()');
});
test('E2 : règles de retard et perte de supervision, avec fixtures promtool dédiées',()=>{
  const rules=read('infrastructure/monitoring/alerts.yml');
  for(const name of ['WorkerScheduledJobOverdue','WorkerSchedulerMonitoringUnavailable','DatabaseMetricsUnavailable']) {
    assert.ok(rules.includes(`alert: ${name}`));
    assert.ok(read('tests/monitoring/worker-alerts.test.yml').includes(`alertname: ${name}`));
  }
  assert.match(rules,/expr: creche_worker_scheduler_overdue > 0\s+for: 5m/);
  assert.match(rules,/absent\(up\{job="postgres"\}\)/);
});
