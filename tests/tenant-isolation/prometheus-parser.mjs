// Official Python Prometheus client parser, pure-Python wheel pinned by SHA256.
// Test-only; no installation or production dependency. python3 is required.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const sha = 'cca895342e308174341b2cbf99a56bef291fbc0ef7b9e5412a0f26d653ba7094';
const url = 'https://files.pythonhosted.org/packages/32/ae/ec06af4fe3ee72d16973474f122541746196aaa16cea6f66d18b963c6177/prometheus_client-0.22.1-py3-none-any.whl';
export async function prometheusParser() {
  const dir = join(process.cwd(), '.cache', 'prometheus-parser');
  const wheel = join(dir, 'prometheus_client-0.22.1-py3-none-any.whl');
  await mkdir(dir, { recursive: true });
  let bytes = await readFile(wheel).catch(() => null);
  if (!bytes) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Prometheus parser download: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('Prometheus parser checksum mismatch');
    await writeFile(wheel, bytes);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== sha) throw new Error('Cached Prometheus parser checksum mismatch');
  return text => {
    const result = spawnSync('python3', ['-c', `import sys,json
sys.path.insert(0,sys.argv[1])
from prometheus_client.parser import text_string_to_metric_families
families=list(text_string_to_metric_families(sys.stdin.read()))
print(json.dumps([{'name':m.name,'type':m.type,'samples':[{'name':s.name,'labels':s.labels,'value':str(s.value)} for s in m.samples]} for m in families]))`, wheel], { input: text, encoding: 'utf8', timeout: 10000, maxBuffer: 4*1024*1024 });
    if (result.error || result.status !== 0) throw new Error(`Official Prometheus parser rejected exposition: ${result.error?.message ?? result.stderr}`);
    return JSON.parse(result.stdout).flatMap(m => m.samples);
  };
}
