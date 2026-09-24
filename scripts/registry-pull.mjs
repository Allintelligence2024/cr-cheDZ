import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Registry reads only. Never retry migrations, bootstrap or business commands.
export async function pullRegistryImage(image, { env = process.env, run = spawnSync, pause = delay, warn = console.warn } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run('docker', ['pull', image], { env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status === 0) return result.stdout ?? '';
    const detail = `${result.error?.message ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    const transient = result.error?.code === 'ETIMEDOUT' || /Client\.Timeout|TLS handshake timeout|i\/o timeout|connection reset by peer|temporary failure in name resolution/i.test(detail);
    // L'image EST nommée : H1 tire deux images (postgres + minio) et l'annotation
    // CI citait « unauthorized » sans dire laquelle — inexploitable pour l'ops.
    if (!transient || attempt === 3) throw new Error(`Registry pull failed for ${image}: ${detail}`);
    // No raw environment/credentials in retry annotations. A final failure is
    // still fatal; no alternate registry, tag, digest, or false green fallback.
    warn(`::warning title=H1 registry retry::Transient registry network timeout; retry ${attempt + 1}/3 of the unchanged image.`);
    await pause(attempt * 2000);
  }
}
