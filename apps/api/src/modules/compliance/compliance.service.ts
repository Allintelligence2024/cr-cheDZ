import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';

interface RuleDef {
  code: string;
  message_fr: string;
  message_ar: string;
  severity: 'critical' | 'warning' | 'info';
}

/**
 * Conformité au décret exécutif 19-253 (2019) — Phase 10.
 *
 * Checks automatiques exécutés à la demande (GET /compliance/summary) et
 * enregistrés dans compliance_checks :
 * - CAP_150 : capacité maximale 150 enfants par établissement (org.max_children) ;
 * - RATIO_EDUC : au moins 2 éducateurs qualifiés par groupe et ≤ 10 enfants
 *   par éducateur (règle seed 013) ;
 * - AGE_CRECHE : enfants de 3 mois à 3 ans (établissement de type crèche) ;
 * - DOC_STAFF : personnel encadrant qualifié affecté aux salles avec enfants ;
 * - PRICE_DISPLAY : prestations et tarifs définis (contrats actifs) pour un
 *   établissement accueillant des enfants — exigence d'affichage art. 16.
 *
 * La capacité maximale est ENFORCÉE à la création d'enfant (409
 * CAPACITY_EXCEEDED au-delà de organizations.max_children).
 */
@Injectable()
export class ComplianceService {
  constructor(private readonly tenantContext: TenantContextService) {}

  /** Exécute les checks, persiste compliance_checks et retourne le résumé. */
  async runChecks(): Promise<{ checked_at: string; results: Array<Record<string, unknown>> }> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const rules = await client.query(
        `SELECT cr.id, cr.code, cr.severity, cr.message_fr, cr.message_ar
         FROM compliance_rules cr
         JOIN compliance_rule_sets rs ON rs.id = cr.rule_set_id
         WHERE rs.status = 'active' AND cr.is_active = true`,
      );
      const ruleByCode = new Map(rules.rows.map((r) => [r.code as string, r]));

      const org = (await client.query(
        `SELECT id, name_fr, max_children, establishment_type FROM organizations WHERE id = $1`, [tenantId],
      )).rows[0];
      const children = (await client.query(
        `SELECT c.id, c.date_of_birth, c.room_id,
                (NOW() AT TIME ZONE 'Africa/Algiers')::date - c.date_of_birth AS age_days
         FROM children c
         WHERE c.organization_id = $1 AND c.deleted_at IS NULL AND c.status = 'active'`, [tenantId],
      )).rows;
      const rooms = (await client.query(
        `SELECT r.id, r.name_fr, r.max_capacity, COUNT(c.id)::int AS children_count
         FROM rooms r
         LEFT JOIN children c ON c.room_id = r.id AND c.deleted_at IS NULL AND c.status = 'active'
         WHERE r.organization_id = $1 AND r.is_active = true
         GROUP BY r.id, r.name_fr, r.max_capacity`, [tenantId],
      )).rows;
      const educators = (await client.query(
        `SELECT sa.room_id, COUNT(*)::int AS educator_count
         FROM staff_assignments sa
         JOIN staff_profiles sp ON sp.id = sa.staff_id
         WHERE sa.organization_id = $1 AND sa.is_active = true
           AND sp.qualification IN ('educator_qualified', 'director', 'nurse')
         GROUP BY sa.room_id`, [tenantId],
      )).rows;
      const educatorsByRoom = new Map(educators.map((e) => [e.room_id as string, Number(e.educator_count)]));
      const contractCount = (await client.query(
        `SELECT COUNT(*)::int AS n FROM contracts WHERE organization_id = $1 AND is_active = true`, [tenantId],
      )).rows[0].n as number;

      const results: Array<Record<string, unknown>> = [];
      const add = async (rule: RuleDef | undefined, result: 'pass' | 'fail' | 'warning', details: unknown): Promise<void> => {
        if (!rule) return;
        results.push({
          code: rule.code,
          severity: rule.severity,
          message_fr: rule.message_fr,
          message_ar: rule.message_ar,
          result,
          details,
        });
        await client.query(
          `INSERT INTO compliance_checks (organization_id, rule_id, result, details, checked_by)
           VALUES ($1, $2, $3, $4, 'system')`,
          [tenantId, ruleByCode.get(rule.code)?.id, result, JSON.stringify(details ?? {})],
        );
      };

      // CAP_150
      const cap = Number(org.max_children ?? 150);
      const capResult = children.length > cap ? 'fail' : (children.length >= Math.ceil(cap * 0.9) ? 'warning' : 'pass');
      await add(ruleByCode.get('CAP_150'), capResult, { children: children.length, max_children: cap });

      // RATIO_EDUC (par salle avec enfants)
      for (const room of rooms) {
        const count = Number(room.children_count);
        if (count === 0) continue;
        const educatorsCount = educatorsByRoom.get(room.id) ?? 0;
        const ratioOk = educatorsCount >= 2 && count <= 10 * educatorsCount;
        await add(ruleByCode.get('RATIO_EDUC'), ratioOk ? 'pass' : 'fail', {
          room: room.name_fr,
          children: count,
          educators: educatorsCount,
          rule: 'min 2 éducateurs/groupe, ≤ 10 enfants/éducateur',
        });
      }

      // AGE_CRECHE
      const isCreche = org.establishment_type === 'creche';
      if (isCreche) {
        const outOfRange = children.filter((c) => Number(c.age_days) < 90 || Number(c.age_days) > 36 * 30);
        await add(ruleByCode.get('AGE_CRECHE'), outOfRange.length === 0 ? 'pass' : 'warning', {
          out_of_range: outOfRange.length,
          total: children.length,
        });
      }

      // DOC_STAFF : salles avec enfants sans éducateur qualifié affecté
      let roomsWithoutStaff = 0;
      for (const room of rooms) {
        if (Number(room.children_count) > 0 && (educatorsByRoom.get(room.id) ?? 0) === 0) roomsWithoutStaff += 1;
      }
      await add(ruleByCode.get('DOC_STAFF'), roomsWithoutStaff === 0 ? 'pass' : 'fail', {
        rooms_without_qualified_staff: roomsWithoutStaff,
      });

      // PRICE_DISPLAY : tarifs définis (contrats actifs) si enfants accueillis
      const priceOk = children.length === 0 || contractCount > 0;
      await add(ruleByCode.get('PRICE_DISPLAY'), priceOk ? 'pass' : 'fail', {
        active_contracts: contractCount,
        children: children.length,
      });

      return { checked_at: new Date().toISOString(), results };
    });
  }

  async listChecks(): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => (await client.query(
      `SELECT cc.id, cc.rule_id, cc.result, cc.details, cc.checked_at, cc.acknowledged_at,
              cr.code, cr.severity, cr.message_fr, cr.message_ar
       FROM compliance_checks cc
       JOIN compliance_rules cr ON cr.id = cc.rule_id
       WHERE cc.organization_id = $1
       ORDER BY cc.checked_at DESC LIMIT 100`, [tenantId],
    )).rows);
  }

  async acknowledge(checkId: string, actorId: string): Promise<Record<string, unknown>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const existing = (await client.query(`SELECT id FROM compliance_checks WHERE id=$1`, [checkId])).rows[0];
      if (!existing) throw Errors.notFound();
      const r = await client.query(
        `UPDATE compliance_checks SET acknowledged_by=$2, acknowledged_at=NOW() WHERE id=$1
         RETURNING id, result, acknowledged_at`, [checkId, actorId],
      );
      return r.rows[0];
    });
  }

  /** Vérifie la capacité restante avant création/import d'enfants. */
  async assertCapacity(client: import('pg').PoolClient, tenantId: string, additional = 1): Promise<void> {
    const org = (await client.query(`SELECT max_children FROM organizations WHERE id=$1`, [tenantId])).rows[0];
    const count = (await client.query(
      `SELECT COUNT(*)::int AS n FROM children WHERE organization_id=$1 AND deleted_at IS NULL AND status='active'`, [tenantId],
    )).rows[0].n as number;
    const max = Number(org?.max_children ?? 150);
    if (count + additional > max) {
      throw new AppError(
        'CAPACITY_EXCEEDED',
        `Capacité maximale atteinte (${max} enfants) — décret 19-253`,
        `تم بلوغ السعة القصوى (${max} طفلاً) — المرسوم 19-253`,
        409,
      );
    }
  }
}
