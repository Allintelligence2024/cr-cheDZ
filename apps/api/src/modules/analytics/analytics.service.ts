import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';

/**
 * Analytics pour directrice — lecture seule, RLS via withTenantConnection.
 * Agrégats temps réel + tendances, strictement limités au tenant courant.
 *
 * Endpoints réservés à director / super_admin / accountant (selon sensibilité).
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly tenantContext: TenantContextService) {}

  private dateOrDefault(date: string | undefined, def: string): string {
    return date ?? def;
  }

  async overview(): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const today = (await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d as string;
      const firstOfMonth = today.substring(0, 7) + '-01';

      // Enfants actifs
      const childrenActive = (await client.query(`SELECT COUNT(*)::int AS c FROM children WHERE organization_id=$1 AND deleted_at IS NULL AND status='active'`, [tenantId])).rows[0].c;

      // Capacité totale
      const capacity = (await client.query(`SELECT COALESCE(SUM(max_capacity),0)::int AS c FROM rooms WHERE organization_id=$1 AND is_active=true`, [tenantId])).rows[0].c;

      // Présences aujourd'hui
      const attendanceToday = (await client.query(
        `SELECT 
          COUNT(*) FILTER (WHERE status='present')::int AS present,
          COUNT(*) FILTER (WHERE status='expected')::int AS expected,
          COUNT(*) FILTER (WHERE status='departed')::int AS departed,
          COUNT(*) FILTER (WHERE status='absent')::int AS absent,
          COUNT(*)::int AS total
         FROM attendance_sessions WHERE organization_id=$1 AND session_date=$2`,
        [tenantId, today],
      )).rows[0];

      // Facturation mois en cours
      const billingMonth = (await client.query(
        `SELECT 
          COALESCE(SUM(total_amount),0)::float AS invoiced,
          COALESCE(SUM(paid_amount),0)::float AS paid,
          COALESCE(SUM(balance),0)::float AS balance,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE status='overdue')::int AS overdue,
          COUNT(*) FILTER (WHERE status='sent')::int AS sent,
          COUNT(*) FILTER (WHERE status='partially_paid')::int AS partially_paid,
          COUNT(*) FILTER (WHERE status='paid')::int AS paid_count
         FROM invoices WHERE organization_id=$1 AND invoice_date >= $2::date`,
        [tenantId, firstOfMonth],
      )).rows[0];

      // Balance âgée
      const aged = (await client.query(
        `SELECT 
          COALESCE(SUM(balance) FILTER (WHERE due_date >= CURRENT_DATE - INTERVAL '30 days'),0)::float AS d0_30,
          COALESCE(SUM(balance) FILTER (WHERE due_date < CURRENT_DATE - INTERVAL '30 days' AND due_date >= CURRENT_DATE - INTERVAL '60 days'),0)::float AS d31_60,
          COALESCE(SUM(balance) FILTER (WHERE due_date < CURRENT_DATE - INTERVAL '60 days' AND due_date >= CURRENT_DATE - INTERVAL '90 days'),0)::float AS d61_90,
          COALESCE(SUM(balance) FILTER (WHERE due_date < CURRENT_DATE - INTERVAL '90 days'),0)::float AS d90,
          COALESCE(SUM(balance),0)::float AS total
         FROM invoices WHERE organization_id=$1 AND status IN ('sent','partially_paid','overdue')`,
        [tenantId],
      )).rows[0];

      // Staff
      const staff = (await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE is_active=true)::int AS active
         FROM staff_profiles WHERE organization_id=$1`,
        [tenantId],
      )).rows[0];

      // Incidents 7 jours
      const incidents = (await client.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE incident_severity='high' OR incident_severity='critical')::int AS critical
         FROM daily_log_events WHERE organization_id=$1 AND event_type='incident' AND occurred_at >= NOW() - INTERVAL '7 days'`,
        [tenantId],
      )).rows[0];

      // Occupancy rate
      const occupancyRate = capacity > 0 ? Math.round((childrenActive / capacity) * 100) : 0;

      return {
        date: today,
        kpis: {
          children_active: childrenActive,
          capacity_total: capacity,
          occupancy_rate: occupancyRate,
          attendance_today: attendanceToday,
          billing_month: billingMonth,
          aged_balance: aged,
          staff,
          incidents_7d: incidents,
        },
      };
    });
  }

  async attendanceTrend(from?: string, to?: string, groupBy: 'day' | 'week' | 'month' = 'day', siteId?: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const today = (await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d as string;
      const fromDate = from ?? new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().substring(0, 10);
      const toDate = to ?? today;

      const trunc = groupBy === 'month' ? 'month' : groupBy === 'week' ? 'week' : 'day';

      // Attendance par jour/semaine/mois
      const rows = (await client.query(
        `SELECT 
          date_trunc($3, session_date)::date AS period,
          COUNT(*) FILTER (WHERE status='present')::int AS present,
          COUNT(*) FILTER (WHERE status='departed')::int AS departed,
          COUNT(*) FILTER (WHERE status='absent')::int AS absent,
          COUNT(*) FILTER (WHERE status='expected')::int AS expected,
          COUNT(*)::int AS total
         FROM attendance_sessions
         WHERE organization_id=$1 AND session_date BETWEEN $4::date AND $5::date
           ${siteId ? 'AND site_id = $6' : ''}
         GROUP BY period
         ORDER BY period`,
        siteId ? [tenantId, null, trunc, fromDate, toDate, siteId] : [tenantId, null, trunc, fromDate, toDate],
      )).rows;

      return {
        from: fromDate,
        to: toDate,
        groupBy,
        data: rows,
      };
    });
  }

  async billingTrend(from?: string, to?: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const today = (await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d as string;
      const fromDate = from ?? today.substring(0, 7) + '-01';
      const toDate = to ?? today;

      const rows = (await client.query(
        `SELECT 
          date_trunc('month', invoice_date)::date AS period,
          COALESCE(SUM(total_amount),0)::float AS invoiced,
          COALESCE(SUM(paid_amount),0)::float AS paid,
          COALESCE(SUM(balance),0)::float AS balance,
          COUNT(*)::int AS count,
          COUNT(*) FILTER (WHERE status='paid')::int AS paid_count,
          COUNT(*) FILTER (WHERE status='overdue')::int AS overdue_count
         FROM invoices
         WHERE organization_id=$1 AND invoice_date BETWEEN $2::date AND $3::date
         GROUP BY period
         ORDER BY period`,
        [tenantId, fromDate, toDate],
      )).rows;

      return { from: fromDate, to: toDate, data: rows };
    });
  }

  async revenueTrend(from?: string, to?: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const today = (await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d as string;
      const fromDate = from ?? new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().substring(0, 10);
      const toDate = to ?? today;

      // Revenue = paiements encaissés par jour (payment_allocations ou invoices paid_amount change)
      // On utilise invoices paid_amount par date de paiement approximée via updated_at si balance diminue
      // Simplifié : somme des paiements via payment_allocations si table existe, sinon via invoices
      let rows: any[] = [];
      try {
        rows = (await client.query(
          `SELECT 
            date_trunc('day', allocated_at)::date AS period,
            COALESCE(SUM(amount),0)::float AS revenue,
            COUNT(*)::int AS count
           FROM payment_allocations
           WHERE organization_id=$1 AND allocated_at BETWEEN $2::date AND $3::date
           GROUP BY period
           ORDER BY period`,
          [tenantId, fromDate, toDate],
        )).rows;
      } catch {
        // Fallback si payment_allocations pas dispo
        rows = (await client.query(
          `SELECT 
            date_trunc('day', updated_at)::date AS period,
            COALESCE(SUM(paid_amount),0)::float AS revenue,
            COUNT(*)::int AS count
           FROM invoices
           WHERE organization_id=$1 AND status='paid' AND updated_at BETWEEN $2::date AND $3::date
           GROUP BY period
           ORDER BY period`,
          [tenantId, fromDate, toDate],
        )).rows;
      }

      return { from: fromDate, to: toDate, data: rows };
    });
  }

  async occupancy(): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const sites = (await client.query(
        `SELECT s.id, s.name_fr, s.name_ar, COALESCE(SUM(r.max_capacity),0)::int AS capacity,
                (SELECT COUNT(*)::int FROM children c WHERE c.organization_id=$1 AND c.deleted_at IS NULL AND c.status='active' AND c.site_id=s.id) AS enrolled
         FROM sites s
         LEFT JOIN rooms r ON r.site_id=s.id AND r.is_active=true
         WHERE s.organization_id=$1
         GROUP BY s.id, s.name_fr, s.name_ar
         ORDER BY s.name_fr`,
        [tenantId],
      )).rows;

      const rooms = (await client.query(
        `SELECT r.id, r.name_fr, r.site_id, s.name_fr AS site_name, r.max_capacity,
                (SELECT COUNT(*)::int FROM children c WHERE c.organization_id=$1 AND c.deleted_at IS NULL AND c.status='active' AND c.room_id=r.id) AS enrolled
         FROM rooms r
         JOIN sites s ON s.id=r.site_id
         WHERE r.organization_id=$1 AND r.is_active=true
         ORDER BY s.name_fr, r.name_fr`,
        [tenantId],
      )).rows;

      return { sites, rooms };
    });
  }

  async ratiosHistory(date?: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const targetDate = date ?? (await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`)).rows[0].d as string;

      // Réutilise la logique de ratios.service.ts mais en SQL direct pour historique
      // Pour MVP : on renvoie les ratios du jour + compliance_checks des 7 derniers jours
      const ratios = (await client.query(
        `SELECT r.id AS room_id, r.name_fr AS room_name, s.name_fr AS site_name,
                COUNT(c.id)::int AS total_children,
                COUNT(*) FILTER (WHERE COALESCE(att.status, 'expected') = 'present')::int AS present
         FROM rooms r
         JOIN sites s ON s.id=r.site_id
         LEFT JOIN children c ON c.room_id=r.id AND c.deleted_at IS NULL AND c.status='active'
         LEFT JOIN attendance_sessions att ON att.child_id=c.id AND att.session_date=$2::date
         WHERE r.organization_id=$1 AND r.is_active=true
         GROUP BY r.id, r.name_fr, s.name_fr
         ORDER BY s.name_fr, r.name_fr`,
        [tenantId, targetDate],
      )).rows;

      const breaches = (await client.query(
        `SELECT checked_at::date AS date, room_id, result, details
         FROM compliance_checks
         WHERE organization_id=$1 AND check_type='ratio' AND checked_at >= NOW() - INTERVAL '30 days'
         ORDER BY checked_at DESC
         LIMIT 50`,
        [tenantId],
      )).rows;

      return { date: targetDate, rooms: ratios, breaches };
    });
  }
}
