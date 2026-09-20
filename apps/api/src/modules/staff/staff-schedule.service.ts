import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';

export interface CreateShiftInput {
  staff_id: string; room_id?: string; site_id?: string; shift_date: string; start_time: string; end_time: string;
  shift_type?: 'work' | 'on_call' | 'training' | 'leave'; notes?: string;
}

/**
 * Planning du personnel (P2-5, migration 070).
 *
 * Créneaux datés par membre et par salle, sans chevauchement (contrainte
 * d'exclusion en base — jamais contournable par l'API). La couverture d'une
 * journée est confrontée à l'effectif ATTENDU par salle (enfants actifs
 * affectés à la salle, ou sessions du jour si elles existent) et à la règle
 * RATIO_EDUC : la directrice voit, avant le jour J, les créneaux où il
 * manquera une éducatrice. Génération d'une semaine depuis les affectations
 * actives (semaine type DZ dim→jeu) pour ne pas tout saisir à la main.
 */
@Injectable()
export class StaffScheduleService {
  constructor(private readonly tenant: TenantContextService, private readonly audit: AuditService) {}

  async createShift(userId: string, dto: CreateShiftInput) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const staff = (await c.query(`SELECT id FROM staff_profiles WHERE id=$1 AND is_active`, [dto.staff_id])).rows[0];
      if (!staff) throw Errors.notFound();
      let siteId = dto.site_id ?? null;
      if (dto.room_id) {
        const room = (await c.query(`SELECT site_id FROM rooms WHERE id=$1 AND is_active`, [dto.room_id])).rows[0];
        if (!room) throw new AppError('NOT_FOUND', 'Salle introuvable', 'القسم غير موجود', 404);
        siteId = siteId ?? room.site_id;
      }
      if (!siteId) throw new AppError('SHIFT_SITE_REQUIRED', 'site_id ou room_id requis', 'الموقع أو القسم مطلوب', 422);
      // Congé/absence déjà déclarés ce jour → pas de créneau de travail.
      const absent = (await c.query(`SELECT 1 FROM staff_attendance WHERE staff_id=$1 AND attendance_date=$2 AND absence_type IN ('vacation','sick','training','other')`, [dto.staff_id, dto.shift_date])).rows[0];
      if (absent && (dto.shift_type ?? 'work') === 'work') throw new AppError('SHIFT_STAFF_ABSENT', 'Absence déjà déclarée pour ce membre ce jour-là', 'تم التصريح بغياب هذا العضو في هذا اليوم', 409);
      try {
        const r = (await c.query(
          `INSERT INTO staff_shifts(organization_id,staff_id,room_id,site_id,shift_date,start_time,end_time,shift_type,notes,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, staff_id, room_id, site_id, shift_date::text, start_time, end_time, shift_type`,
          [org, dto.staff_id, dto.room_id ?? null, siteId, dto.shift_date, dto.start_time, dto.end_time, dto.shift_type ?? 'work', dto.notes ?? null, userId],
        )).rows[0];
        void this.audit.log({ organizationId: org, userId, action: 'create', resourceType: 'staff_shift', resourceId: r.id, newValues: { staff_id: dto.staff_id, shift_date: dto.shift_date, start_time: dto.start_time, end_time: dto.end_time } });
        return r;
      } catch (e) {
        if ((e as { constraint?: string }).constraint === 'excl_shift_overlap') throw new AppError('SHIFT_OVERLAP', 'Ce membre a déjà un créneau qui chevauche cette plage', 'لهذا العضو فترة عمل متداخلة', 409);
        if ((e as { constraint?: string }).constraint === 'chk_shift_times') throw new AppError('SHIFT_INVALID_TIMES', 'L’heure de fin doit être après l’heure de début', 'وقت النهاية يجب أن يكون بعد البداية', 422);
        throw e;
      }
    });
  }

  async deleteShift(userId: string, id: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const r = (await c.query(`DELETE FROM staff_shifts WHERE id=$1 AND organization_id=$2 RETURNING id, staff_id, shift_date::text`, [id, org])).rows[0];
      if (!r) throw Errors.notFound();
      void this.audit.log({ organizationId: org, userId, action: 'delete', resourceType: 'staff_shift', resourceId: id, oldValues: r });
      return { deleted: true };
    });
  }

  /** Planning d'une période (site optionnel), avec le membre et la salle. */
  async list(from: string, to: string, siteId?: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org, from, to];
      let where = '';
      if (siteId) { params.push(siteId); where = ` AND sh.site_id=$4`; }
      return (await c.query(
        `SELECT sh.id, sh.staff_id, u.first_name, u.last_name, sp.qualification, sh.room_id, r.name_fr AS room_name, sh.site_id,
                sh.shift_date::text, sh.start_time, sh.end_time, sh.shift_type, sh.notes
         FROM staff_shifts sh JOIN staff_profiles sp ON sp.id=sh.staff_id JOIN users u ON u.id=sp.user_id LEFT JOIN rooms r ON r.id=sh.room_id
         WHERE sh.organization_id=$1 AND sh.shift_date BETWEEN $2 AND $3${where}
         ORDER BY sh.shift_date, sh.start_time, u.last_name`, params,
      )).rows;
    });
  }

  /**
   * Génère les créneaux d'une semaine depuis les affectations actives :
   * pour chaque membre encadrant affecté à une salle, un créneau `work`
   * par jour ouvré (défaut dim→jeu, 08:00–17:00). Les créneaux existants
   * sont conservés (ON CONFLICT impossible avec EXCLUDE → on saute les
   * chevauchements, comptés dans `skipped`).
   */
  async generateWeek(userId: string, dto: { week_start: string; days?: number[]; start_time?: string; end_time?: string; site_id?: string }) {
    const org = requireTenant(this.tenant);
    const days = dto.days ?? [7, 1, 2, 3, 4];
    const start = dto.start_time ?? '08:00';
    const end = dto.end_time ?? '17:00';
    return this.tenant.withTenantConnection(async (c) => {
      const params: unknown[] = [org];
      let where = '';
      if (dto.site_id) { params.push(dto.site_id); where = ` AND sa.site_id=$2`; }
      const assignments = (await c.query(
        `SELECT sa.staff_id, sa.room_id, sa.site_id FROM staff_assignments sa JOIN staff_profiles sp ON sp.id=sa.staff_id
         WHERE sa.organization_id=$1 AND sa.is_active AND sp.is_active AND sa.start_date <= ($${params.length + 1}::date + 6) AND (sa.end_date IS NULL OR sa.end_date >= $${params.length + 1}::date)${where}`,
        [...params, dto.week_start],
      )).rows;
      let created = 0, skipped = 0;
      for (const a of assignments) {
        for (let i = 0; i < 7; i++) {
          const d = (await c.query(`SELECT ($1::date + $2::int)::text AS d, EXTRACT(ISODOW FROM ($1::date + $2::int))::int AS dow`, [dto.week_start, i])).rows[0];
          if (!days.includes(d.dow)) continue;
          await c.query('SAVEPOINT shift');
          try {
            await c.query(
              `INSERT INTO staff_shifts(organization_id,staff_id,room_id,site_id,shift_date,start_time,end_time,shift_type,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'work',$8)`,
              [org, a.staff_id, a.room_id, a.site_id, d.d, start, end, userId],
            );
            created++;
            await c.query('RELEASE SAVEPOINT shift');
          } catch (e) {
            await c.query('ROLLBACK TO SAVEPOINT shift');
            if ((e as { constraint?: string }).constraint === 'excl_shift_overlap') skipped++; else throw e;
          }
        }
      }
      void this.audit.log({ organizationId: org, userId, action: 'create', resourceType: 'staff_shift', resourceLabel: `week:${dto.week_start}`, newValues: { created, skipped } });
      return { week_start: dto.week_start, created, skipped };
    });
  }

  /**
   * Couverture prévisionnelle d'un jour : par salle et par heure ouvrée,
   * éducateurs planifiés vs effectif attendu, statut RATIO_EDUC.
   */
  async coverage(date: string, siteId?: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const params = (await c.query(
        `SELECT cr.parameters FROM compliance_rules cr JOIN compliance_rule_sets rs ON rs.id=cr.rule_set_id
         WHERE cr.code='RATIO_EDUC' AND cr.is_active AND rs.status='active' ORDER BY rs.effective_from DESC LIMIT 1`,
      )).rows[0]?.parameters as { max_children_per_educator?: number; min_educators_per_group?: number } | undefined;
      const maxPer = Number(params?.max_children_per_educator ?? 10);
      const minEduc = Number(params?.min_educators_per_group ?? 2);
      const q: unknown[] = [org, date];
      let where = '';
      if (siteId) { q.push(siteId); where = ` AND r.site_id=$3`; }
      const rooms = (await c.query(
        `SELECT r.id AS room_id, r.name_fr AS room_name, r.site_id, r.max_capacity,
           COALESCE((SELECT COUNT(*)::int FROM attendance_sessions s WHERE s.room_id=r.id AND s.session_date=$2 AND s.status IN ('expected','present','departed')), 0) AS from_sessions,
           (SELECT COUNT(*)::int FROM children ch WHERE ch.room_id=r.id AND ch.deleted_at IS NULL AND ch.status='active') AS from_roster
         FROM rooms r WHERE r.organization_id=$1 AND r.is_active${where} ORDER BY r.name_fr`, q,
      )).rows;
      const shifts = (await c.query(
        `SELECT sh.room_id, sh.start_time::text, sh.end_time::text FROM staff_shifts sh JOIN staff_profiles sp ON sp.id=sh.staff_id
         WHERE sh.organization_id=$1 AND sh.shift_date=$2 AND sh.shift_type='work' AND sh.room_id IS NOT NULL
           AND sp.qualification IN ('educator_qualified','director','nurse')`, [org, date],
      )).rows as Array<{ room_id: string; start_time: string; end_time: string }>;
      const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
      const result = rooms.map((r) => {
        const expected = Number(r.from_sessions) > 0 ? Number(r.from_sessions) : Number(r.from_roster);
        const mine = shifts.filter((s) => s.room_id === r.room_id);
        const slots: Array<{ hour: string; educators: number; status: 'ok' | 'warning' | 'breach' }> = [];
        const gaps: string[] = [];
        for (let h = 7; h < 19; h++) {
          const m = h * 60;
          const n = mine.filter((s) => toMin(s.start_time) <= m && toMin(s.end_time) > m).length;
          let status: 'ok' | 'warning' | 'breach' = 'ok';
          if (expected > 0) {
            if (n === 0 || expected > maxPer * n) status = 'breach';
            else if (n < minEduc) status = 'warning';
          }
          const hour = `${String(h).padStart(2, '0')}:00`;
          slots.push({ hour, educators: n, status });
          if (status === 'breach') gaps.push(hour);
        }
        const required = expected === 0 ? 0 : Math.max(minEduc, Math.ceil(expected / maxPer));
        return { room_id: r.room_id, room_name: r.room_name, site_id: r.site_id, expected_children: expected, required_educators: required, slots, gaps };
      });
      return { date, max_children_per_educator: maxPer, min_educators: minEduc, rooms: result, alerts: result.filter((x) => x.gaps.length > 0) };
    });
  }
}
