import { Injectable } from '@nestjs/common';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { requireTenant } from '../../shared/database/tenant-utils';
import { Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import {
  CreateEmergencyContactDto,
  CreateGuardianDto,
  CreatePickupDto,
  LinkGuardianDto,
  UpdateGuardianDto,
  UpdatePickupDto,
} from './dto/guardians.dto';

/**
 * Responsables légaux, liens enfant-responsable (permissions granulaires),
 * contacts d'urgence, personnes autorisées à récupérer.
 * Tables tenant sous RLS — contexte tenant obligatoire.
 */
@Injectable()
export class GuardiansService {
  constructor(
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
  ) {}

  private async childExists(client: { query: (q: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> }, childId: string): Promise<void> {
    const res = await client.query(`SELECT id FROM children WHERE id = $1 AND deleted_at IS NULL`, [childId]);
    if (res.rows.length === 0) throw Errors.notFound();
  }

  // ── Responsables ─────────────────────────────────────────────────────────

  async createGuardian(dto: CreateGuardianDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `INSERT INTO guardians
           (organization_id, user_id, first_name_fr, first_name_ar, last_name_fr,
            last_name_ar, relationship, phone_primary, phone_secondary, email,
            national_id, address, employer, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, first_name_fr, last_name_fr, relationship, phone_primary, version`,
        [
          tenantId, dto.user_id ?? null, dto.first_name_fr, dto.first_name_ar ?? null,
          dto.last_name_fr, dto.last_name_ar ?? null, dto.relationship,
          dto.phone_primary ?? null, dto.phone_secondary ?? null, dto.email ?? null,
          dto.national_id ?? null, dto.address ?? null, dto.employer ?? null, actorId,
        ],
      );
      const guardian = res.rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'guardian',
        resourceId: guardian.id,
        resourceLabel: `${guardian.first_name_fr} ${guardian.last_name_fr}`,
        newValues: { relationship: guardian.relationship },
      });
      return guardian;
    });
  }

  async listGuardians(search?: string): Promise<Array<Record<string, unknown>>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const params: unknown[] = [tenantId];
      let searchClause = '';
      if (search) {
        params.push(`%${search}%`);
        searchClause = `AND (first_name_fr ILIKE $2 OR last_name_fr ILIKE $2 OR phone_primary ILIKE $2)`;
      }
      const res = await client.query(
        `SELECT id, user_id, first_name_fr, last_name_fr, relationship, phone_primary, email, version
         FROM guardians
         WHERE organization_id = $1 AND deleted_at IS NULL ${searchClause}
         ORDER BY last_name_fr, first_name_fr`,
        params,
      );
      return res.rows;
    });
  }

  async updateGuardian(id: string, dto: UpdateGuardianDto, actorId: string): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `UPDATE guardians SET
           first_name_fr  = COALESCE($2, first_name_fr),
           last_name_fr   = COALESCE($3, last_name_fr),
           relationship   = COALESCE($4, relationship),
           phone_primary  = COALESCE($5, phone_primary),
           phone_secondary = COALESCE($6, phone_secondary),
           email          = COALESCE($7, email),
           address        = COALESCE($8, address),
           employer       = COALESCE($9, employer),
           updated_at     = NOW(),
           version        = version + 1
         WHERE id = $1 AND organization_id = $10
         RETURNING id, first_name_fr, last_name_fr, version`,
        [id, dto.first_name_fr ?? null, dto.last_name_fr ?? null, dto.relationship ?? null,
         dto.phone_primary ?? null, dto.phone_secondary ?? null, dto.email ?? null,
         dto.address ?? null, dto.employer ?? null, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'guardian',
        resourceId: id,
        newValues: { ...dto },
      });
      return res.rows[0];
    });
  }

  // ── Liens enfant ↔ responsable (permissions granulaires) ─────────────────

  async linkGuardian(
    childId: string,
    dto: LinkGuardianDto,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childExists(client, childId);
      const guardian = await client.query(`SELECT id FROM guardians WHERE id = $1`, [dto.guardian_id]);
      if (guardian.rows.length === 0) {
        throw Errors.notFound();
      }

      if (dto.is_primary) {
        // Un seul parent principal par enfant.
        await client.query(
          `UPDATE child_guardians SET is_primary = false WHERE child_id = $1`,
          [childId],
        );
      }

      const res = await client.query(
        `INSERT INTO child_guardians
           (organization_id, child_id, guardian_id, is_legal_guardian, is_primary,
            can_view_journal, can_view_health, can_receive_invoices, can_pay_invoices,
            can_pickup, can_authorize_pickup, can_receive_push, receives_invoice_copies,
            priority_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (child_id, guardian_id) DO UPDATE SET
           is_legal_guardian  = EXCLUDED.is_legal_guardian,
           is_primary         = EXCLUDED.is_primary,
           can_view_journal   = EXCLUDED.can_view_journal,
           can_view_health    = EXCLUDED.can_view_health,
           can_receive_invoices = EXCLUDED.can_receive_invoices,
           can_pay_invoices   = EXCLUDED.can_pay_invoices,
           can_pickup         = EXCLUDED.can_pickup,
           can_authorize_pickup = EXCLUDED.can_authorize_pickup,
           can_receive_push   = EXCLUDED.can_receive_push,
           receives_invoice_copies = EXCLUDED.receives_invoice_copies,
           priority_order     = EXCLUDED.priority_order,
           updated_at         = NOW(),
           version            = child_guardians.version + 1
         RETURNING id, child_id, guardian_id, is_primary, can_view_journal, can_view_health, version`,
        [
          tenantId, childId, dto.guardian_id,
          dto.is_legal_guardian ?? true, dto.is_primary ?? false,
          dto.can_view_journal ?? true, dto.can_view_health ?? true,
          dto.can_receive_invoices ?? false, dto.can_pay_invoices ?? false,
          dto.can_pickup ?? true, dto.can_authorize_pickup ?? false,
          dto.can_receive_push ?? true, dto.receives_invoice_copies ?? false,
          dto.priority_order ?? 1,
        ],
      );
      const link = res.rows[0];
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'child_guardian',
        resourceId: link.id,
        newValues: { child_id: childId, guardian_id: dto.guardian_id, is_primary: link.is_primary },
      });
      return link;
    });
  }

  async listChildGuardians(childId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childExists(client, childId);
      const res = await client.query(
        `SELECT cg.id, cg.guardian_id, cg.is_legal_guardian, cg.is_primary,
                cg.can_view_journal, cg.can_view_health, cg.can_receive_invoices,
                cg.can_pay_invoices, cg.can_pickup, cg.can_authorize_pickup,
                cg.can_receive_push, cg.receives_invoice_copies, cg.priority_order, cg.version,
                g.first_name_fr, g.last_name_fr, g.relationship, g.phone_primary, g.email
         FROM child_guardians cg
         JOIN guardians g ON g.id = cg.guardian_id
         WHERE cg.child_id = $1
         ORDER BY cg.priority_order, cg.is_primary DESC`,
        [childId],
      );
      return res.rows;
    });
  }

  async unlinkGuardian(childId: string, guardianId: string, actorId: string): Promise<void> {
    const tenantId = requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `DELETE FROM child_guardians WHERE child_id = $1 AND guardian_id = $2 AND organization_id = $3
         RETURNING id`,
        [childId, guardianId, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'delete',
        resourceType: 'child_guardian',
        resourceId: res.rows[0].id,
        newValues: { child_id: childId, guardian_id: guardianId },
      });
    });
  }

  // ── Contacts d'urgence ───────────────────────────────────────────────────

  async createEmergencyContact(
    childId: string,
    dto: CreateEmergencyContactDto,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childExists(client, childId);
      const res = await client.query(
        `INSERT INTO emergency_contacts
           (organization_id, child_id, first_name, last_name, relationship, phone_primary, phone_secondary, priority_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id, first_name, last_name, relationship, phone_primary`,
        [tenantId, childId, dto.first_name, dto.last_name, dto.relationship,
         dto.phone_primary, dto.phone_secondary ?? null, dto.priority_order ?? 1],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'emergency_contact',
        resourceId: res.rows[0].id,
        newValues: { child_id: childId },
      });
      return res.rows[0];
    });
  }

  async listEmergencyContacts(childId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childExists(client, childId);
      const res = await client.query(
        `SELECT id, first_name, last_name, relationship, phone_primary, phone_secondary, priority_order
         FROM emergency_contacts WHERE child_id = $1 ORDER BY priority_order`,
        [childId],
      );
      return res.rows;
    });
  }

  async deleteEmergencyContact(childId: string, contactId: string, actorId: string): Promise<void> {
    const tenantId = requireTenant(this.tenantContext);
    await this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `DELETE FROM emergency_contacts WHERE id = $1 AND child_id = $2 AND organization_id = $3 RETURNING id`,
        [contactId, childId, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'delete',
        resourceType: 'emergency_contact',
        resourceId: res.rows[0].id,
      });
    });
  }

  // ── Personnes autorisées à récupérer ─────────────────────────────────────

  async createPickup(
    childId: string,
    dto: CreatePickupDto,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childExists(client, childId);
      const res = await client.query(
        `INSERT INTO authorized_pickups
           (organization_id, child_id, first_name, last_name, relationship, phone, national_id, valid_from, valid_until, added_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, first_name, last_name, relationship, phone, valid_from, valid_until, is_active`,
        [tenantId, childId, dto.first_name, dto.last_name, dto.relationship,
         dto.phone ?? null, dto.national_id ?? null, dto.valid_from ?? null,
         dto.valid_until ?? null, actorId],
      );
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'create',
        resourceType: 'authorized_pickup',
        resourceId: res.rows[0].id,
        newValues: { child_id: childId },
      });
      return res.rows[0];
    });
  }

  async listPickups(childId: string): Promise<Array<Record<string, unknown>>> {
    requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      await this.childExists(client, childId);
      const res = await client.query(
        `SELECT id, first_name, last_name, relationship, phone, valid_from, valid_until, is_active
         FROM authorized_pickups WHERE child_id = $1 ORDER BY created_at DESC`,
        [childId],
      );
      return res.rows;
    });
  }

  async updatePickup(
    childId: string,
    pickupId: string,
    dto: UpdatePickupDto,
    actorId: string,
  ): Promise<Record<string, unknown>> {
    const tenantId = requireTenant(this.tenantContext);
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `UPDATE authorized_pickups SET is_active = COALESCE($3, is_active), updated_at = NOW()
         WHERE id = $1 AND child_id = $2 AND organization_id = $4
         RETURNING id, first_name, last_name, is_active`,
        [pickupId, childId, dto.is_active ?? null, tenantId],
      );
      if (res.rows.length === 0) throw Errors.notFound();
      await this.audit.log({
        organizationId: tenantId,
        userId: actorId,
        action: 'update',
        resourceType: 'authorized_pickup',
        resourceId: pickupId,
        newValues: { ...dto },
      });
      return res.rows[0];
    });
  }
}
