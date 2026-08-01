import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';

/**
 * Tableau de bord de la directrice (Phase 9).
 *
 * Agrégats du jour par salle + alertes opérationnelles, strictement limités
 * au tenant courant (RLS via withTenantConnection) :
 * - enfants encore « expected » (non pointés) ;
 * - documents du personnel expirant sous 30 jours ;
 * - factures impayées (sent / partially_paid / overdue) ;
 * - incidents des dernières 24 h.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async summary(): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const today = (await client.query(
        `SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date AS d`,
      )).rows[0].d as string;

      const rooms = (await client.query(
        `SELECT r.id AS room_id, r.name_fr AS room_name, s.name_fr AS site_name,
                COUNT(c.id)::int AS total_children,
                COUNT(*) FILTER (WHERE COALESCE(att.status, 'expected') = 'present')::int AS present,
                COUNT(*) FILTER (WHERE COALESCE(att.status, 'expected') = 'departed')::int AS departed,
                COUNT(*) FILTER (WHERE COALESCE(att.status, 'expected') = 'absent')::int AS absent,
                COUNT(*) FILTER (WHERE COALESCE(att.status, 'expected') = 'expected')::int AS expected
         FROM rooms r
         JOIN sites s ON s.id = r.site_id
         LEFT JOIN children c
           ON c.room_id = r.id AND c.deleted_at IS NULL AND c.status = 'active'
         LEFT JOIN attendance_sessions att
           ON att.child_id = c.id AND att.session_date = $2
         WHERE r.organization_id = $1 AND r.is_active = true
         GROUP BY r.id, r.name_fr, s.name_fr
         ORDER BY s.name_fr, r.name_fr`,
        [tenantId, today],
      )).rows;

      const notCheckedIn = (await client.query(
        `SELECT c.id, c.reference_number, c.first_name_fr, c.last_name_fr,
                COALESCE(r.name_fr, '—') AS room_name
         FROM children c
         LEFT JOIN rooms r ON r.id = c.room_id
         LEFT JOIN attendance_sessions att
           ON att.child_id = c.id AND att.session_date = $2
         WHERE c.organization_id = $1 AND c.deleted_at IS NULL AND c.status = 'active'
           AND COALESCE(att.status, 'expected') = 'expected'
         ORDER BY c.first_name_fr, c.last_name_fr
         LIMIT 20`,
        [tenantId, today],
      )).rows;

      const documentsExpiring = (await client.query(
        `SELECT sd.id, sd.document_type, sd.title, sd.expiry_date,
                COALESCE(u.first_name, '') AS first_name, COALESCE(u.last_name, '') AS last_name
         FROM staff_documents sd
         JOIN staff_profiles sp ON sp.id = sd.staff_id
         JOIN users u ON u.id = sp.user_id
         WHERE sd.organization_id = $1
           AND sd.expiry_date IS NOT NULL
           AND sd.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
         ORDER BY sd.expiry_date
         LIMIT 20`,
        [tenantId],
      )).rows;

      const unpaidInvoices = (await client.query(
        `SELECT i.id, i.invoice_number, i.total_amount, i.paid_amount, i.balance,
                i.status, i.due_date, c.first_name_fr, c.last_name_fr
         FROM invoices i
         JOIN children c ON c.id = i.child_id
         WHERE i.organization_id = $1
           AND i.status IN ('sent', 'partially_paid', 'overdue')
         ORDER BY i.due_date
         LIMIT 20`,
        [tenantId],
      )).rows;

      const recentIncidents = (await client.query(
        `SELECT e.id, e.child_id, e.occurred_at, e.incident_severity, e.incident_description,
                c.first_name_fr, c.last_name_fr
         FROM daily_log_events e
         JOIN children c ON c.id = e.child_id
         WHERE e.organization_id = $1 AND e.event_type = 'incident'
           AND e.occurred_at >= NOW() - INTERVAL '24 hours'
         ORDER BY e.occurred_at DESC
         LIMIT 10`,
        [tenantId],
      )).rows;

      return {
        date: today,
        rooms,
        alerts: {
          children_not_checked_in: notCheckedIn,
          documents_expiring: documentsExpiring,
          unpaid_invoices: unpaidInvoices,
          recent_incidents: recentIncidents,
        },
      };
    });
  }
}
