import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';

export type RatioStatus = 'ok' | 'warning' | 'breach' | 'empty';

export interface RoomRatio {
  room_id: string;
  room_name: string;
  site_name: string;
  max_capacity: number;
  children_present: number;
  educators_assigned: number;
  educators_on_duty: number;
  /** on_duty si le pointage du personnel est utilisé aujourd'hui dans l'établissement, sinon assigned. */
  basis: 'on_duty' | 'assigned';
  educators_counted: number;
  max_children_per_educator: number;
  min_educators: number;
  /** Enfants supplémentaires admissibles avant franchissement (0 si déjà franchi). */
  headroom: number;
  status: RatioStatus;
  reasons: string[];
}

/**
 * Ratios d'encadrement & capacité EN TEMPS RÉEL (P2-1).
 *
 * Source de vérité : présences du jour (attendance_sessions status='present'),
 * affectations actives du personnel encadrant (staff_assignments ×
 * staff_profiles.qualification) et, si l'établissement pointe son personnel
 * (staff_attendance du jour), les éducateurs effectivement présents.
 * Paramètres = règle RATIO_EDUC du jeu de règles actif (décret 19-253 :
 * ≤ 10 enfants/éducateur, ≥ 2 éducateurs par groupe) — jamais codés en dur.
 *
 * Le contrôle périodique (compliance.service, effectifs INSCRITS) reste ;
 * ici on répond à la question de la directrice à 8h45 : « puis-je encore
 * accueillir un enfant dans cette salle ? ».
 */
@Injectable()
export class RatiosService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async today(): Promise<{ date: string; rooms: RoomRatio[]; alerts: RoomRatio[] }> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection((client) => this.compute(client));
  }

  /** Utilisable DANS une transaction métier (check-in) : ratios d'une salle. */
  async forRoom(client: PoolClient, roomId: string): Promise<RoomRatio | null> {
    const r = await this.compute(client, roomId);
    return r.rooms[0] ?? null;
  }

  async compute(client: PoolClient, roomId?: string): Promise<{ date: string; rooms: RoomRatio[]; alerts: RoomRatio[] }> {
    const tenantId = requireTenant(this.tenantContext);
    const today = (await client.query(`SELECT (NOW() AT TIME ZONE 'Africa/Algiers')::date::text AS d`)).rows[0].d as string;
    const params = (await client.query(
      `SELECT cr.parameters FROM compliance_rules cr JOIN compliance_rule_sets rs ON rs.id=cr.rule_set_id
       WHERE cr.code='RATIO_EDUC' AND cr.is_active AND rs.status='active' ORDER BY rs.effective_from DESC LIMIT 1`,
    )).rows[0]?.parameters as { max_children_per_educator?: number; min_educators_per_group?: number } | undefined;
    const maxPerEducator = Number(params?.max_children_per_educator ?? 10);
    const minEducators = Number(params?.min_educators_per_group ?? 2);

    const usesStaffClock = (await client.query(
      `SELECT 1 FROM staff_attendance WHERE organization_id=$1 AND attendance_date=$2 AND check_in IS NOT NULL LIMIT 1`, [tenantId, today],
    )).rowCount! > 0;

    const q: unknown[] = [tenantId, today];
    let roomClause = '';
    if (roomId) { q.push(roomId); roomClause = ` AND r.id=$3`; }
    const rows = (await client.query(
      `SELECT r.id AS room_id, r.name_fr AS room_name, s.name_fr AS site_name, r.max_capacity,
              (SELECT COUNT(*)::int FROM attendance_sessions a
                 WHERE a.organization_id=$1 AND a.session_date=$2 AND a.status='present'
                   AND a.child_id IN (SELECT c.id FROM children c WHERE c.room_id=r.id AND c.deleted_at IS NULL)) AS children_present,
              (SELECT COUNT(DISTINCT sa.staff_id)::int FROM staff_assignments sa JOIN staff_profiles sp ON sp.id=sa.staff_id
                 WHERE sa.organization_id=$1 AND sa.room_id=r.id AND sa.is_active
                   AND sa.start_date <= $2 AND (sa.end_date IS NULL OR sa.end_date >= $2)
                   AND sp.qualification IN ('educator_qualified','director','nurse')) AS educators_assigned,
              (SELECT COUNT(DISTINCT sa.staff_id)::int FROM staff_assignments sa JOIN staff_profiles sp ON sp.id=sa.staff_id
                 JOIN staff_attendance st ON st.staff_id=sa.staff_id AND st.attendance_date=$2 AND st.check_in IS NOT NULL AND st.check_out IS NULL
                 WHERE sa.organization_id=$1 AND sa.room_id=r.id AND sa.is_active
                   AND sa.start_date <= $2 AND (sa.end_date IS NULL OR sa.end_date >= $2)
                   AND sp.qualification IN ('educator_qualified','director','nurse')) AS educators_on_duty
       FROM rooms r JOIN sites s ON s.id=r.site_id
       WHERE r.organization_id=$1 AND r.is_active=true${roomClause}
       ORDER BY s.name_fr, r.name_fr`, q,
    )).rows;

    const rooms: RoomRatio[] = rows.map((r) => {
      const present = Number(r.children_present);
      const basis: RoomRatio['basis'] = usesStaffClock ? 'on_duty' : 'assigned';
      const counted = basis === 'on_duty' ? Number(r.educators_on_duty) : Number(r.educators_assigned);
      const maxCap = Number(r.max_capacity);
      const reasons: string[] = [];
      let status: RatioStatus = present === 0 ? 'empty' : 'ok';
      if (present > 0) {
        if (present > maxCap) { status = 'breach'; reasons.push('CAPACITY_EXCEEDED'); }
        if (counted === 0) { status = 'breach'; reasons.push('NO_EDUCATOR'); }
        else {
          if (present > maxPerEducator * counted) { status = 'breach'; reasons.push('RATIO_EXCEEDED'); }
          if (counted < minEducators) { if (status !== 'breach') status = 'warning'; reasons.push('MIN_EDUCATORS'); }
        }
        if (status === 'ok' && (present >= maxCap * 0.9 || present >= maxPerEducator * counted * 0.9)) { status = 'warning'; reasons.push('NEAR_LIMIT'); }
      }
      const headroomRatio = counted === 0 ? 0 : maxPerEducator * counted - present;
      const headroom = Math.max(0, Math.min(maxCap - present, headroomRatio));
      return {
        room_id: r.room_id, room_name: r.room_name, site_name: r.site_name, max_capacity: maxCap,
        children_present: present, educators_assigned: Number(r.educators_assigned), educators_on_duty: Number(r.educators_on_duty),
        basis, educators_counted: counted, max_children_per_educator: maxPerEducator, min_educators: minEducators, headroom, status, reasons,
      };
    });
    return { date: today, rooms, alerts: rooms.filter((x) => x.status === 'breach' || x.status === 'warning') };
  }

  /**
   * Trace d'un franchissement au moment d'un check-in : ligne compliance_checks
   * (RATIO_EDUC, fail) — une seule par salle et par jour tant que la situation
   * n'est pas revenue à la normale (pas de spam), dans la transaction appelante.
   */
  async recordBreach(client: PoolClient, ratio: RoomRatio): Promise<boolean> {
    if (ratio.status !== 'breach') return false;
    const tenantId = requireTenant(this.tenantContext);
    const rule = (await client.query(
      `SELECT cr.id FROM compliance_rules cr JOIN compliance_rule_sets rs ON rs.id=cr.rule_set_id
       WHERE cr.code='RATIO_EDUC' AND cr.is_active AND rs.status='active' LIMIT 1`,
    )).rows[0];
    if (!rule) return false;
    const dup = await client.query(
      `SELECT 1 FROM compliance_checks WHERE organization_id=$1 AND rule_id=$2 AND checked_by='realtime' AND result='fail'
         AND details->>'room_id'=$3 AND (checked_at AT TIME ZONE 'Africa/Algiers')::date=(NOW() AT TIME ZONE 'Africa/Algiers')::date LIMIT 1`,
      [tenantId, rule.id, ratio.room_id],
    );
    if (dup.rowCount) return false;
    await client.query(
      `INSERT INTO compliance_checks (organization_id, rule_id, result, details, checked_by) VALUES ($1,$2,'fail',$3,'realtime')`,
      [tenantId, rule.id, JSON.stringify({ room_id: ratio.room_id, room: ratio.room_name, children_present: ratio.children_present, educators: ratio.educators_counted, basis: ratio.basis, reasons: ratio.reasons, source: 'check_in' })],
    );
    return true;
  }
}
