import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';

/**
 * Métriques Prometheus minimales (Phase 11) — sans dépendance externe.
 * Compteurs HTTP en mémoire + métriques métier lues en base au scrape.
 * Aucune donnée tenant n'est exposée (compteurs globaux uniquement).
 */
@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, { count: number; sum: number }>();
  private readonly startedAt = Date.now();
  private readonly bucketEdges = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
  private readonly buckets = new Map<string, number>();
  /** Fenêtre glissante des erreurs 5xx (timestamp d'entrée) — suivi pilote. */
  private readonly http5xx: number[] = [];

  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  private key(method: string, route: string, status: number): string {
    return `${method} ${route} ${status}`;
  }

  httpRequest(method: string, route: string, status: number, durationSeconds: number): void {
    const k = this.key(method, route, status);
    this.counters.set(k, (this.counters.get(k) ?? 0) + 1);
    if (status >= 500) {
      this.http5xx.push(Date.now());
      const cutoff = Date.now() - 24 * 3600_000;
      while (this.http5xx.length && this.http5xx[0] < cutoff) this.http5xx.shift();
    }

    const dk = `${method} ${route}`;
    const d = this.durations.get(dk) ?? { count: 0, sum: 0 };
    d.count += 1;
    d.sum += durationSeconds;
    this.durations.set(dk, d);

    for (const edge of this.bucketEdges) {
      if (durationSeconds <= edge) {
        const bk = `${dk} le=${edge}`;
        this.buckets.set(bk, (this.buckets.get(bk) ?? 0) + 1);
      }
    }
    const infKey = `${dk} le=+Inf`;
    this.buckets.set(infKey, (this.buckets.get(infKey) ?? 0) + 1);
  }

  /** Sortie au format texte Prometheus. */
  async scrape(): Promise<string> {
    const out: string[] = [];
    out.push('# HELP http_requests_total Total des requêtes HTTP traitées.');
    out.push('# TYPE http_requests_total counter');
    for (const [k, v] of [...this.counters.entries()].sort()) {
      const [method, route, status] = k.split(' ');
      out.push(`http_requests_total{method="${method}",route="${route}",status="${status}"} ${v}`);
    }

    out.push('# HELP http_request_duration_seconds Durée des requêtes HTTP.');
    out.push('# TYPE http_request_duration_seconds histogram');
    for (const [k, v] of [...this.buckets.entries()].sort()) {
      out.push(`http_request_duration_seconds_bucket{${k}} ${v}`);
    }
    for (const [k, d] of [...this.durations.entries()].sort()) {
      out.push(`http_request_duration_seconds_sum{${k}} ${d.sum.toFixed(6)}`);
      out.push(`http_request_duration_seconds_count{${k}} ${d.count}`);
    }

    out.push('# HELP creche_jobs_pending Jobs en attente dans background_jobs.');
    out.push('# TYPE creche_jobs_pending gauge');
    out.push(`creche_jobs_pending ${await this.count('SELECT COUNT(*)::int AS n FROM background_jobs WHERE status = \'pending\'')}`);
    out.push('# HELP creche_notifications_pending Notifications push en attente.');
    out.push('# TYPE creche_notifications_pending gauge');
    out.push(`creche_notifications_pending ${await this.count('SELECT COUNT(*)::int AS n FROM notification_queue WHERE status = \'pending\'')}`);
    out.push('# HELP creche_invoices_unpaid Factures non soldées.');
    out.push('# TYPE creche_invoices_unpaid gauge');
    out.push(`creche_invoices_unpaid ${await this.count("SELECT COUNT(*)::int AS n FROM invoices WHERE status IN ('sent', 'partially_paid', 'overdue')")}`);
    // ── Suivi pilote (Phase 12) : usage quotidien agrégé, aucune donnée tenant ──
    out.push('# HELP creche_children_active Enfants actifs (toutes organisations).');
    out.push('# TYPE creche_children_active gauge');
    out.push(`creche_children_active ${await this.count("SELECT COUNT(*)::int AS n FROM children WHERE deleted_at IS NULL AND status = 'active'")}`);
    out.push('# HELP creche_checkins_today Pointages d\'arrivée du jour (Africa/Algiers).');
    out.push('# TYPE creche_checkins_today gauge');
    out.push(`creche_checkins_today ${await this.count("SELECT COUNT(*)::int AS n FROM attendance_events e JOIN attendance_sessions s ON s.id = e.session_id WHERE e.event_type = 'check_in' AND s.session_date = (NOW() AT TIME ZONE 'Africa/Algiers')::date")}`);
    out.push('# HELP creche_sync_ops_24h Opérations de synchronisation reçues sur 24 h.');
    out.push('# TYPE creche_sync_ops_24h gauge');
    out.push(`creche_sync_ops_24h ${await this.count("SELECT COUNT(*)::int AS n FROM sync_operations WHERE created_at >= NOW() - INTERVAL '24 hours'")}`);
    out.push('# HELP creche_jobs_failed_24h Jobs en échec sur 24 h.');
    out.push('# TYPE creche_jobs_failed_24h gauge');
    out.push(`creche_jobs_failed_24h ${await this.count("SELECT COUNT(*)::int AS n FROM background_jobs WHERE status = 'failed' AND failed_at >= NOW() - INTERVAL '24 hours'")}`);
    out.push('# HELP creche_http_5xx_24h Requêtes HTTP en erreur 5xx sur 24 h (fenêtre glissante en mémoire).');
    out.push('# TYPE creche_http_5xx_24h gauge');
    out.push(`creche_http_5xx_24h ${this.http5xx24h}`);

    out.push('# HELP process_uptime_seconds Temps de fonctionnement du processus.');
    out.push('# TYPE process_uptime_seconds gauge');
    out.push(`process_uptime_seconds ${((Date.now() - this.startedAt) / 1000).toFixed(1)}`);
    return out.join('\n') + '\n';
  }

  private get http5xx24h(): number {
    const cutoff = Date.now() - 24 * 3600_000;
    while (this.http5xx.length && this.http5xx[0] < cutoff) this.http5xx.shift();
    return this.http5xx.length;
  }

  private async count(sql: string): Promise<number> {
    try {
      const r = await this.pool.query(sql);
      return Number(r.rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  }
}
