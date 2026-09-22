import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { CreateEnrollmentRequestDto, DecideDto, OfferPlaceDto } from './dto/enrollment.dto';

/**
 * Pré-inscriptions & liste d'attente (P2-4, migration 070).
 *
 * Cycle : pending → waitlisted (si aucune place libre à la date souhaitée)
 * ou offered (place proposée, expirant) → accepted (l'enfant est créé en
 * `pre_registered`, jamais un doublon) / declined / withdrawn / expired.
 * Le score de priorité est calculé en base et visible (fratrie +50,
 * enfant du personnel +30, ancienneté de la demande +1/semaine, plafond 20)
 * — critères d'attribution explicables aux familles et aux collectivités.
 * La capacité est celle des salles actives du site (max_capacity) moins les
 * enfants actifs/pré-inscrits et les offres en cours.
 */
@Injectable()
export class EnrollmentService {
  constructor(private readonly tenant: TenantContextService, private readonly audit: AuditService) {}

  private static score(r: { has_sibling: boolean; is_staff_child: boolean; created_at: Date }): number {
    const weeks = Math.floor((Date.now() - new Date(r.created_at).getTime()) / (7 * 86400000));
    return (r.has_sibling ? 50 : 0) + (r.is_staff_child ? 30 : 0) + Math.min(20, Math.max(0, weeks));
  }

  /** R5 (remédiation 2026-09-21) : défense en profondeur — les décisions de
   *  capacité (waitlist/offer/decide) exigent le rôle director ACTIF du tenant,
   *  vérifié en service en plus du @Roles du contrôleur (première implémentation
   *  du double contrôle dans ce monorepo — matrice d'autorisation v15). */
  private async requireDirector(
    c: { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
    org: string,
    userId: string,
  ) {
    const r = (await c.query(
      `SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role_id
       WHERE m.user_id=$1 AND m.organization_id=$2 AND m.is_active AND r.slug='director'`,
      [userId, org],
    )).rows;
    if (r.length === 0) throw Errors.forbidden();
  }

  async create(userId: string, dto: CreateEnrollmentRequestDto) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const site = (await c.query(`SELECT id FROM sites WHERE id=$1 AND organization_id=$2`, [dto.site_id, org])).rows[0];
      if (!site) throw Errors.notFound();
      const seq = (await c.query(`SELECT next_org_sequence($1) AS n`, [org])).rows[0].n;
      const score = EnrollmentService.score({ has_sibling: !!dto.has_sibling, is_staff_child: !!dto.is_staff_child, created_at: new Date() });
      const r = (await c.query(
        `INSERT INTO enrollment_requests(organization_id,site_id,reference_number,child_first_name,child_last_name,child_date_of_birth,
           guardian_name,guardian_phone,guardian_email,desired_start_date,schedule_type,has_sibling,is_staff_child,priority_notes,priority_score,notes,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id, reference_number, status, priority_score, site_id, desired_start_date, created_at`,
        [org, dto.site_id, `PRE-${new Date().getFullYear()}-${seq}`, dto.child_first_name.trim(), dto.child_last_name.trim(), dto.child_date_of_birth,
          dto.guardian_name.trim(), dto.guardian_phone, dto.guardian_email ?? null, dto.desired_start_date, dto.schedule_type ?? 'full_time',
          !!dto.has_sibling, !!dto.is_staff_child, dto.priority_notes ?? null, score, dto.notes ?? null, userId],
      )).rows[0];
      void this.audit.log({ organizationId: org, userId, action: 'create', resourceType: 'enrollment_request', resourceId: r.id, resourceLabel: r.reference_number });
      return r;
    });
  }

  /** Capacité disponible d'un site : places des salles actives − enfants actifs/pré-inscrits − offres en cours. */
  async capacity(siteId: string) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      const site = (await c.query(`SELECT id FROM sites WHERE id=$1 AND organization_id=$2`, [siteId, org])).rows[0];
      if (!site) throw Errors.notFound();
      return this.capacityWith(c, org, siteId);
    });
  }

  private async capacityWith(c: { query: (q: string, p?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, org: string, siteId: string) {
    const r = (await c.query(
      `SELECT
         (SELECT COALESCE(SUM(max_capacity),0)::int FROM rooms WHERE organization_id=$1 AND site_id=$2 AND is_active) AS capacity,
         (SELECT COUNT(*)::int FROM children WHERE organization_id=$1 AND site_id=$2 AND deleted_at IS NULL AND status IN ('active','pre_registered','on_leave')) AS enrolled,
         (SELECT COUNT(*)::int FROM enrollment_requests WHERE organization_id=$1 AND site_id=$2 AND status='offered' AND offer_expires_at > NOW()) AS offered,
         (SELECT COUNT(*)::int FROM enrollment_requests WHERE organization_id=$1 AND site_id=$2 AND status IN ('pending','waitlisted')) AS waiting`,
      [org, siteId],
    )).rows[0] as { capacity: number; enrolled: number; offered: number; waiting: number };
    return { site_id: siteId, ...r, available: Math.max(0, r.capacity - r.enrolled - r.offered) };
  }

  /** File d'attente ordonnée : score (recalculé à la lecture — l'ancienneté avance) puis date de demande. */
  async list(filters: { site_id?: string; status?: string }) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      // Les offres expirées basculent à la lecture (pas de job planifié).
      await c.query(`UPDATE enrollment_requests SET status='expired', updated_at=NOW() WHERE organization_id=$1 AND status='offered' AND offer_expires_at <= NOW()`, [org]);
      const params: unknown[] = [org];
      let where = '';
      if (filters.site_id) { params.push(filters.site_id); where += ` AND site_id=$${params.length}`; }
      if (filters.status) { params.push(filters.status); where += ` AND status=$${params.length}`; }
      const rows = (await c.query(
        `SELECT id, reference_number, site_id, child_first_name, child_last_name, child_date_of_birth, guardian_name, guardian_phone,
                desired_start_date::text, schedule_type, has_sibling, is_staff_child, priority_notes, status, offered_room_id, offer_expires_at, child_id, created_at
         FROM enrollment_requests WHERE organization_id=$1${where}`, params,
      )).rows;
      return rows
        .map((r) => ({ ...r, priority_score: EnrollmentService.score(r) }))
        .sort((a, b) => (b.priority_score - a.priority_score) || (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
        .map((r, i) => ({ ...r, rank: r.status === 'pending' || r.status === 'waitlisted' ? i + 1 : null }));
    });
  }

  /** Mise en liste d'attente explicite (aucune place à la date souhaitée). */
  async waitlist(userId: string, id: string) {
    return this.transition(userId, id, ['pending'], 'waitlisted', {});
  }

  /** Proposition d'une place : nécessite une place disponible sur le site. */
  async offer(userId: string, id: string, dto: OfferPlaceDto) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      await this.requireDirector(c, org, userId);
      const req = (await c.query(`SELECT * FROM enrollment_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, org])).rows[0];
      if (!req) throw Errors.notFound();
      if (!['pending', 'waitlisted', 'expired'].includes(req.status)) throw new AppError('ENROLLMENT_INVALID_TRANSITION', `Transition impossible depuis « ${req.status} »`, 'انتقال غير ممكن', 409);
      const room = (await c.query(`SELECT id FROM rooms WHERE id=$1 AND site_id=$2 AND is_active`, [dto.room_id, req.site_id])).rows[0];
      if (!room) throw new AppError('ROOM_NOT_IN_SITE', 'Salle inconnue ou hors du site de la demande', 'القسم غير موجود أو خارج الموقع', 422);
      const cap = await this.capacityWith(c, org, req.site_id);
      if (cap.available <= 0) throw new AppError('SITE_FULL', 'Aucune place disponible sur ce site', 'لا توجد أماكن متاحة في هذا الموقع', 409);
      const days = dto.offer_days ?? 7;
      const r = (await c.query(
        `UPDATE enrollment_requests SET status='offered', offered_room_id=$3, offered_at=NOW(), offer_expires_at=NOW() + ($4 || ' days')::interval, updated_at=NOW(), version=version+1
         WHERE id=$1 AND organization_id=$2 RETURNING id, reference_number, status, offered_room_id, offer_expires_at`,
        [id, org, dto.room_id, String(days)],
      )).rows[0];
      void this.audit.log({ organizationId: org, userId, action: 'update', resourceType: 'enrollment_request', resourceId: id, resourceLabel: req.reference_number, oldValues: { status: req.status }, newValues: { status: 'offered', room_id: dto.room_id } });
      return r;
    });
  }

  /** Décision : acceptée (crée l'enfant pre_registered), déclinée, retirée. */
  async decide(userId: string, id: string, dto: DecideDto) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      await this.requireDirector(c, org, userId);
      const req = (await c.query(`SELECT * FROM enrollment_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, org])).rows[0];
      if (!req) throw Errors.notFound();
      if (['accepted', 'declined', 'withdrawn'].includes(req.status)) throw new AppError('ENROLLMENT_ALREADY_DECIDED', 'Demande déjà close', 'الطلب مغلق مسبقاً', 409);
      let childId: string | null = null;
      if (dto.decision === 'accepted') {
        if (req.status !== 'offered') throw new AppError('ENROLLMENT_NO_OFFER', 'Une place doit être proposée avant acceptation', 'يجب عرض مكان قبل القبول', 409);
        if (new Date(req.offer_expires_at).getTime() <= Date.now()) throw new AppError('ENROLLMENT_OFFER_EXPIRED', 'L’offre a expiré', 'انتهت صلاحية العرض', 409);
        const seq = (await c.query(`SELECT next_org_sequence($1) AS n`, [org])).rows[0].n;
        childId = (await c.query(
          `INSERT INTO children(organization_id,site_id,room_id,reference_number,first_name_fr,last_name_fr,date_of_birth,status,enrollment_date,schedule_type,created_by)
           VALUES($1,$2,$3,$4,$5,$6,$7,'pre_registered',$8,$9,$10) RETURNING id`,
          [org, req.site_id, req.offered_room_id, `ENF-${seq}`, req.child_first_name, req.child_last_name, req.child_date_of_birth, req.desired_start_date, req.schedule_type, userId],
        )).rows[0].id;
      }
      const r = (await c.query(
        `UPDATE enrollment_requests SET status=$3, child_id=$4, decided_at=NOW(), notes=COALESCE($5, notes), updated_at=NOW(), version=version+1
         WHERE id=$1 AND organization_id=$2 RETURNING id, reference_number, status, child_id, decided_at`,
        [id, org, dto.decision, childId, dto.notes ?? null],
      )).rows[0];
      void this.audit.log({ organizationId: org, userId, action: 'update', resourceType: 'enrollment_request', resourceId: id, resourceLabel: req.reference_number, oldValues: { status: req.status }, newValues: { status: dto.decision, child_id: childId } });
      return r;
    });
  }

  private async transition(userId: string, id: string, from: string[], to: string, extra: Record<string, unknown>) {
    const org = requireTenant(this.tenant);
    return this.tenant.withTenantConnection(async (c) => {
      // transition() n'est appelée que par waitlist() — décision de capacité : director-only (R5).
      await this.requireDirector(c, org, userId);
      const req = (await c.query(`SELECT id, reference_number, status FROM enrollment_requests WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [id, org])).rows[0];
      if (!req) throw Errors.notFound();
      if (!from.includes(req.status)) throw new AppError('ENROLLMENT_INVALID_TRANSITION', `Transition impossible depuis « ${req.status} »`, 'انتقال غير ممكن', 409);
      const r = (await c.query(`UPDATE enrollment_requests SET status=$3, updated_at=NOW(), version=version+1 WHERE id=$1 AND organization_id=$2 RETURNING id, reference_number, status`, [id, org, to])).rows[0];
      void this.audit.log({ organizationId: org, userId, action: 'update', resourceType: 'enrollment_request', resourceId: id, resourceLabel: req.reference_number, oldValues: { status: req.status }, newValues: { status: to, ...extra } });
      return r;
    });
  }
}
