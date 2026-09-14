// Real Vite HTTP transport with a synthetic upstream; no Docker substitute.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer as createHttp, get } from 'node:http';
import { createServer as createVite } from 'vite';
import { resolve } from 'node:path';

test('Vite forwards relative API requests to the configured upstream', async () => {
  let calls = 0;
  const upstream = createHttp((req,res) => { calls++; res.setHeader('content-type','application/json'); res.end(JSON.stringify({path:req.url, marker:'synthetic'})); });
  await new Promise(r => upstream.listen(0,'127.0.0.1',r));
  const previous = process.env.API_PROXY_TARGET;
  process.env.API_PROXY_TARGET = `http://127.0.0.1:${upstream.address().port}`;
  let vite;
  try {
    vite = await createVite({root:resolve('apps/admin-web'), configFile:resolve(process.env.VITE_TEST_CONFIG ?? 'apps/admin-web/vite.config.ts'), server:{host:'0.0.0.0',port:0}, logLevel:'silent'});
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const result = await fetch(`${base}/api/v1/health`);
    assert.equal(result.status,200,'Vite contacted the wrong upstream');
    assert.deepEqual(await result.json(),{path:'/api/v1/health',marker:'synthetic'});
    assert.equal(calls,1);
  } finally {
    if (vite) await vite.close();
    upstream.closeAllConnections(); await new Promise(r => upstream.close(r));
    if (previous === undefined) delete process.env.API_PROXY_TARGET; else process.env.API_PROXY_TARGET = previous;
  }
});


test('Vite permits Arena preview hosts but still rejects arbitrary hosts', async () => {
  const vite = await createVite({root:resolve('apps/admin-web'), configFile:resolve(process.env.VITE_TEST_CONFIG ?? 'apps/admin-web/vite.config.ts'), server:{host:'0.0.0.0',port:0}, logLevel:'silent'});
  try {
    await vite.listen();
    const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const request = host => new Promise((resolveResult,reject) => {
      get(`${base}/`,{headers:{host}}, response => { response.resume(); resolveResult({status:response.statusCode}); }).on('error',reject);
    });
    assert.equal((await request('4000-fixture.e2b.app')).status,200,'Arena preview host refused');
    assert.equal((await request('untrusted.invalid')).status,403,'arbitrary hosts must remain rejected');
  } finally { await vite.close(); }
});
