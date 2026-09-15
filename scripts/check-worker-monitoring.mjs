#!/usr/bin/env node
// Vrai moteur Prometheus, jamais de faux vert si le moteur manque.
import {spawnSync} from 'node:child_process';
const checks=[['check','rules','infrastructure/monitoring/alerts.yml'],['test','rules','tests/monitoring/worker-alerts.test.yml']];
for(const args of checks) {
  const docker=process.env.MONITORING_USE_DOCKER==='1';
  const r=spawnSync(docker?'docker':(process.env.PROMTOOL ?? 'promtool'),docker?
    ['run','--rm','-v',`${process.cwd()}:/work:ro`,'-w','/work','--entrypoint','/bin/promtool','prom/prometheus:v2.53.0',...args]:args,{stdio:'inherit'});
  if(r.error){console.error('Moteur Prometheus indisponible : PROMTOOL ou MONITORING_USE_DOCKER=1 requis.');process.exit(2);}
  if(r.status!==0)process.exit(r.status || 1);
}
