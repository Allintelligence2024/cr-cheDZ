import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';

/**
 * Module paie (roadmap v2).
 *
 * - Génération mensuelle idempotente : UNE run par org/période (409 si
 *   existante), UNE entrée par employé actif avec base_salary.
 * - Lignes par type (base/bonus/allowance/deduction) ; totaux contrôlés en
 *   base (net = gross − deductions).
 * - Finalisation (immuabilité) : plus de modification après finalize.
 */
@Injectable()
export class PayrollService {
  constructor(private readonly tenantContext: TenantContextService) {}

  /** Génère la paie du mois : run + entrées (base_salary) + ligne base. */
  async generate(userId: string, dto: { period_year: number; period_month: number }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(
        `SELECT id FROM payroll_runs WHERE organization_id=$1 AND period_year=$2 AND period_month=$3`,
        [tenantId, dto.period_year, dto.period_month],
      )).rows[0];
      if (existing) {
        throw new AppError('PAYROLL_ALREADY_EXISTS', 'La paie de cette période existe déjà', 'رواتب هذه الفترة موجودة بالفعل', 409);
      }
      const staff = (await client.query(
        `SELECT sp.id, sp.user_id, sp.base_salary FROM staff_profiles sp
         WHERE sp.organization_id=$1 AND sp.is_active=true AND sp.base_salary IS NOT NULL`,
        [tenantId],
      )).rows;
      if (staff.length === 0) {
        throw new AppError('PAYROLL_NO_STAFF', 'Aucun employé avec salaire de base', 'لا يوجد موظفون براتب أساسي', 422);
      }
      const run = (await client.query(
        `INSERT INTO payroll_runs (organization_id, period_year, period_month, generated_by)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [tenantId, dto.period_year, dto.period_month, userId],
      )).rows[0];
      for (const s of staff) {
        const gross = Number(s.base_salary);
        const entry = (await client.query(
          `INSERT INTO payroll_entries (organization_id, run_id, staff_id, user_id, period_year, period_month, gross_amount, net_amount)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
          [tenantId, run.id, s.id, s.user_id, dto.period_year, dto.period_month, gross],
        )).rows[0];
        await client.query(
          `INSERT INTO payroll_lines (organization_id, entry_id, line_type, label_fr, label_ar, amount, sort_order)
           VALUES ($1,$2,'base','Salaire de base','الراتب الأساسي',$3,1)`,
          [tenantId, entry.id, gross],
        );
      }
      await this.refreshRunTotals(client, run.id);
      return run;
    });
  }

  /** Ajoute une ligne (prime/indemnité/retenue) à une entrée — draft uniquement. */
  async addLine(entryId: string, dto: { lines: Array<{ line_type: string; label_fr: string; label_ar?: string; amount: number }> }): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const entry = (await client.query(
        `SELECT pe.id, pe.run_id, pe.gross_amount FROM payroll_entries pe
         JOIN payroll_runs pr ON pr.id = pe.run_id
         WHERE pe.id=$1 AND pr.status='draft'`, [entryId],
      )).rows[0];
      if (!entry) {
        const exists = (await client.query(`SELECT id FROM payroll_entries WHERE id=$1`, [entryId])).rows[0];
        if (!exists) throw Errors.notFound();
        throw new AppError('PAYROLL_FINALIZED', 'La paie est finalisée, modification impossible', 'تمت تسوية الرواتب، لا يمكن التعديل', 422);
      }
      const inserted: string[] = [];
      let sort = 2;
      for (const line of dto.lines) {
        const r = (await client.query(
          `INSERT INTO payroll_lines (organization_id, entry_id, line_type, label_fr, label_ar, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          [tenantId, entryId, line.line_type, line.label_fr, line.label_ar ?? null, line.amount, sort],
        )).rows[0];
        inserted.push(r.id);
        sort += 1;
      }
      // Recalcul : gross = somme des non-deductions, deductions = somme des deductions.
      const sums = (await client.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE line_type <> 'deduction'), 0)::numeric AS gross,
           COALESCE(-SUM(amount) FILTER (WHERE line_type = 'deduction'), 0)::numeric AS deductions
         FROM payroll_lines WHERE entry_id=$1`, [entryId],
      )).rows[0];
      await client.query(
        `UPDATE payroll_entries
           SET gross_amount=$2::numeric, deductions_amount=$3::numeric, net_amount=$2::numeric-$3::numeric
         WHERE id=$1`,
        [entryId, sums.gross, sums.deductions],
      );
      await this.refreshRunTotals(client, entry.run_id);
      return { inserted, gross: sums.gross, deductions: sums.deductions, net: Number(sums.gross) - Number(sums.deductions) };
    });
  }

  /** Finalise la paie (immuable ensuite). */
  async finalize(runId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const run = (await client.query(`SELECT * FROM payroll_runs WHERE id=$1`, [runId])).rows[0];
      if (!run) throw Errors.notFound();
      if (run.status !== 'draft') {
        throw new AppError('PAYROLL_FINALIZED', 'La paie est déjà finalisée', 'تمت تسوية الرواتب مسبقاً', 409);
      }
      const r = (await client.query(
        `UPDATE payroll_runs SET status='finalized', finalized_at=NOW() WHERE id=$1 RETURNING *`, [runId],
      )).rows[0];
      return r;
    });
  }

  async listRuns(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT id, period_year, period_month, status, total_gross, total_net, finalized_at, created_at
       FROM payroll_runs WHERE organization_id=$1 ORDER BY period_year DESC, period_month DESC`, [tenantId],
    )).rows);
  }

  async runDetail(runId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const run = (await client.query(`SELECT * FROM payroll_runs WHERE id=$1`, [runId])).rows[0];
      if (!run) throw Errors.notFound();
      const entries = (await client.query(
        `SELECT pe.id, pe.staff_id, pe.gross_amount, pe.deductions_amount, pe.net_amount, pe.status, pe.paid_at,
                u.first_name, u.last_name
         FROM payroll_entries pe JOIN users u ON u.id = pe.user_id
         WHERE pe.run_id=$1 ORDER BY u.last_name, u.first_name`, [runId],
      )).rows;
      for (const e of entries) {
        e.lines = (await client.query(
          `SELECT line_type, label_fr, label_ar, amount FROM payroll_lines WHERE entry_id=$1 ORDER BY sort_order`, [e.id],
        )).rows;
      }
      return { ...run, entries };
    });
  }

  private async refreshRunTotals(client: import('pg').PoolClient, runId: string): Promise<void> {
    const totals = (await client.query(
      `SELECT COALESCE(SUM(gross_amount),0)::numeric AS gross, COALESCE(SUM(net_amount),0)::numeric AS net
       FROM payroll_entries WHERE run_id=$1`, [runId],
    )).rows[0];
    await client.query(
      `UPDATE payroll_runs SET total_gross=$2, total_net=$3 WHERE id=$1`, [runId, totals.gross, totals.net],
    );
  }
}
