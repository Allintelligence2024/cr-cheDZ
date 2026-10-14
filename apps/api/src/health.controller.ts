import { Controller, Get } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from './shared/database/database.provider';
import { Public } from './shared/decorators/public.decorator';

/**
 * Healthcheck public (nginx, orchestrateur, CI) — aucune donnée exposée.
 *
 * 3.8.2 (remédiation 2026-10-04) : la sonde renvoyait `{status:'ok'` quoi
 * qu'il arrive — DB morte, pool saturé, credentials expirés, l'orchestrateur
 * voyait l'API « saine » et continuait à lui envoyer du trafic. Une sonde
 * qui ne prouve rien ne sert à rien.
 *
 * Désormais, `status: 'ok'` n'est renvoyé QUE si la base répond à un
 * `SELECT 1` en moins de 2 s. Sinon : `status: 'degraded'` + le nom du
 * check défaillant (jamais le détail de l'erreur — route publique).
 */
const DB_PROBE_TIMEOUT_MS = 2_000;

@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Public()
  @Get()
  async health(): Promise<{ status: string; version: string; time: string; checks?: Record<string, string> }> {
    const checks: Record<string, string> = {};
    let ok = true;

    try {
      // SELECT 1 : prouve que le pool répond ET que les credentials sont
      // valides. Timeout borné : une sonde qui pend est aussi inutile.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DB_PROBE_TIMEOUT_MS);
      try {
        // NB : `signal` est supporté au runtime par node-postgres ≥ 8 mais
        // absent de ses types `QueryConfig` — d'où le cast.
        await this.pool.query({ text: 'SELECT 1', signal: controller.signal } as never);
        checks.database = 'ok';
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      ok = false;
      checks.database = `error: ${error instanceof Error ? error.name : 'unknown'}`;
    }

    return {
      status: ok ? 'ok' : 'degraded',
      version: '0.1.0',
      time: new Date().toISOString(),
      ...(ok ? {} : { checks }),
    };
  }
}
