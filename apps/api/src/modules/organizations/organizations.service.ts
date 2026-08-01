import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { AppError } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto/organizations.dto';

/**
 * Organisations — table racine SANS RLS (pas de organization_id interne).
 * Accès réservé aux super_admin (plateforme). Les directrices gèrent leur
 * organisation via /me et les endpoints tenant (sites, rooms, staff…).
 */
@Injectable()
export class OrganizationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateOrganizationDto, actorId: string): Promise<Record<string, unknown>> {
    const slug = dto.slug.toLowerCase();
    const conflict = await this.pool.query(`SELECT id FROM organizations WHERE slug = $1`, [slug]);
    if (conflict.rows.length > 0) {
      throw new AppError('SLUG_TAKEN', 'Ce slug est déjà utilisé', 'هذا الرمز مستخدم بالفعل', 409);
    }

    const result = await this.pool.query(
      `INSERT INTO organizations
         (slug, name_fr, name_ar, legal_name, establishment_type, registration_number,
          phone, email, address_line1, commune, wilaya, max_children, timezone, settings)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, slug, name_fr, wilaya, establishment_type, max_children, created_at`,
      [
        slug,
        dto.name_fr,
        dto.name_ar ?? null,
        dto.legal_name ?? null,
        dto.establishment_type ?? 'creche',
        dto.registration_number ?? null,
        dto.phone ?? null,
        dto.email ?? null,
        dto.address_line1 ?? null,
        dto.commune ?? null,
        dto.wilaya,
        dto.max_children ?? 150,
        dto.timezone ?? 'Africa/Algiers',
        dto.settings ? JSON.stringify(dto.settings) : '{}',
      ],
    );
    const org = result.rows[0];

    await this.audit.log({
      userId: actorId,
      action: 'create',
      resourceType: 'organization',
      resourceId: org.id,
      resourceLabel: org.slug,
      newValues: { name_fr: org.name_fr, wilaya: org.wilaya },
    });
    return org;
  }

  async list(): Promise<Array<Record<string, unknown>>> {
    const result = await this.pool.query(
      `SELECT id, slug, name_fr, name_ar, establishment_type, wilaya,
              max_children, is_active, subscription_plan, created_at
       FROM organizations
       ORDER BY created_at DESC`,
    );
    return result.rows;
  }

  async getById(id: string): Promise<Record<string, unknown>> {
    const result = await this.pool.query(
      `SELECT id, slug, name_fr, name_ar, legal_name, establishment_type,
              registration_number, phone, email, address_line1, commune, wilaya,
              timezone, locale, subscription_plan, subscription_ends_at,
              max_children, is_active, settings, created_at
       FROM organizations WHERE id = $1`,
      [id],
    );
    if (result.rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Organisation introuvable', 'المؤسسة غير موجودة', 404);
    }
    return result.rows[0];
  }

  async update(id: string, dto: UpdateOrganizationDto, actorId: string): Promise<Record<string, unknown>> {
    const current = await this.pool.query(
      `SELECT id, slug FROM organizations WHERE id = $1`,
      [id],
    );
    if (current.rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Organisation introuvable', 'المؤسسة غير موجودة', 404);
    }

    const result = await this.pool.query(
      `UPDATE organizations SET
         name_fr             = COALESCE($2, name_fr),
         name_ar             = COALESCE($3, name_ar),
         legal_name          = COALESCE($4, legal_name),
         establishment_type  = COALESCE($5, establishment_type),
         phone               = COALESCE($6, phone),
         email               = COALESCE($7, email),
         max_children        = COALESCE($8, max_children),
         settings            = CASE WHEN $9::jsonb IS NULL THEN settings ELSE $9::jsonb END,
         updated_at          = NOW()
       WHERE id = $1
       RETURNING id, slug, name_fr, max_children, updated_at`,
      [
        id,
        dto.name_fr ?? null,
        dto.name_ar ?? null,
        dto.legal_name ?? null,
        dto.establishment_type ?? null,
        dto.phone ?? null,
        dto.email ?? null,
        dto.max_children ?? null,
        dto.settings ? JSON.stringify(dto.settings) : null,
      ],
    );

    await this.audit.log({
      userId: actorId,
      action: 'update',
      resourceType: 'organization',
      resourceId: id,
      resourceLabel: current.rows[0].slug,
      newValues: { ...dto },
    });
    return result.rows[0];
  }
}
