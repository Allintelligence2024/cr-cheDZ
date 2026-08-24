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
    const gauges = await this.dbGauges();
    const gauge = (name: string): string => (gauges.has(name) ? String(gauges.get(name)) : 'NaN'); // absent = indisponible (jamais de faux 0)
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
    out.push(`creche_jobs_pending ${gauge('jobs_pending')}`);
    out.push('# HELP creche_notifications_pending Notifications push en attente.');
    out.push('# TYPE creche_notifications_pending gauge');
    out.push(`creche_notifications_pending ${gauge('notifications_pending')}`);
    out.push('# HELP creche_invoices_unpaid Factures non soldées.');
    out.push('# TYPE creche_invoices_unpaid gauge');
    out.push(`creche_invoices_unpaid ${gauge('invoices_unpaid')}`);
    // ── Suivi pilote (Phase 12) : usage quotidien agrégé, aucune donnée tenant ──
    out.push('# HELP creche_children_active Enfants actifs (toutes organisations).');
    out.push('# TYPE creche_children_active gauge');
    out.push(`creche_children_active ${gauge('children_active')}`);
    out.push('# HELP creche_checkins_today Pointages d\'arrivée du jour (Africa/Algiers).');
    out.push('# TYPE creche_checkins_today gauge');
    out.push(`creche_checkins_today ${gauge('checkins_today')}`);
    out.push('# HELP creche_sync_ops_24h Opérations de synchronisation reçues sur 24 h.');
    out.push('# TYPE creche_sync_ops_24h gauge');
    out.push(`creche_sync_ops_24h ${gauge('sync_ops_24h')}`);
    out.push('# HELP creche_jobs_failed_24h Jobs en échec sur 24 h.');
    out.push('# TYPE creche_jobs_failed_24h gauge');
    out.push(`creche_jobs_failed_24h ${gauge('jobs_failed_24h')}`);
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

  /**
   * Jauges métier via metrics_global_counts() (migration 050, SECURITY
   * DEFINER) : les COUNT directs sur tables tenant via pool brute
   * renvoyaient 0 sous le rôle NOBYPASSRLS (aucun contexte tenant posé) —
   * même famille de défaut que le P0 paiement. La fonction renvoie des
   * agrégats globaux (compteurs, aucune ligne ni PII).
   */
  private async dbGauges(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    try {
      const r = await this.pool.query<{ metric: string; n: string }>(`SELECT metric, n FROM metrics_global_counts()`);
      for (const row of r.rows) out.set(row.metric, Number(row.n));
    } catch {
      // Métriques indisponibles → jauges absentes (jamais de faux 0).
    }
    return out;
  }
}
