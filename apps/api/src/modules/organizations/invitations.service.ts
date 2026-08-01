import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { AppError } from '../../shared/errors';
import { EmailService } from '../../shared/email/email.service';
import { AuditService } from '../privacy/audit.service';
import { CreateInvitationDto } from './dto/invitations.dto';

export interface InvitationResult {
  invitation_id: string;
  email: string;
  role_slug: string;
  status: 'invited' | 'already_member';
  invitation_token?: string;
}

/**
 * Invitations : création d'un utilisateur pending + membership +
 * token signé (7 j) envoyé par email ; acceptation via POST /auth/accept-invitation.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tenantContext: TenantContextService,
    private readonly jwtService: JwtService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreateInvitationDto,
    actorId: string,
  ): Promise<InvitationResult> {
    const orgId = dto.organization_id ?? this.tenantContext.getTenantIdOrNull();
    if (!orgId) {
      throw new AppError(
        'ORGANIZATION_REQUIRED',
        'organization_id requis pour un super_admin',
        'organization_id مطلوب',
        400,
      );
    }
    if (dto.role_slug === 'super_admin') {
      throw new AppError('ROLE_FORBIDDEN', 'Rôle super_admin non invitable', 'لا يمكن دعوة هذا الدور', 403);
    }
    // Vérifier que l'organisation existe (table système).
    const org = await this.pool.query(`SELECT id, name_fr FROM organizations WHERE id = $1 AND is_active = true`, [orgId]);
    if (org.rows.length === 0) {
      throw new AppError('NOT_FOUND', 'Organisation introuvable', 'المؤسسة غير موجودة', 404);
    }
    // Rôle système (ou rôle de l'organisation).
    const role = await this.pool.query(
      `SELECT id, slug FROM roles
       WHERE slug = $1 AND (organization_id IS NULL OR organization_id = $2)
       ORDER BY organization_id NULLS FIRST LIMIT 1`,
      [dto.role_slug, orgId],
    );
    if (role.rows.length === 0) {
      throw new AppError('ROLE_NOT_FOUND', 'Rôle inconnu', 'الدور غير معروف', 400);
    }

    const email = dto.email.toLowerCase().trim();

    // Utilisateur existant ou création (status pending).
    const userRes = await this.pool.query(
      `SELECT id, status FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email],
    );
    let userId: string;
    let userStatus: string;
    if (userRes.rows.length > 0) {
      userId = userRes.rows[0].id;
      userStatus = userRes.rows[0].status;
    } else {
      const created = await this.pool.query(
        `INSERT INTO users (email, first_name, last_name, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
        [email, dto.first_name ?? '', dto.last_name ?? ''],
      );
      userId = created.rows[0].id;
      userStatus = 'pending';
    }

    // Membership : si déjà membre actif → erreur claire.
    const existing = await this.pool.query(
      `SELECT * FROM invite_get_membership($1, $2)`,
      [orgId, userId],
    );
    if (existing.rows.length > 0 && existing.rows[0].is_active && existing.rows[0].joined_at) {
      throw new AppError('ALREADY_MEMBER', 'Cet utilisateur est déjà membre', 'هذا المستخدم عضو بالفعل', 409);
    }

    const membership = await this.pool.query(
      `SELECT invite_upsert_membership($1, $2, $3, $4, $5) AS id`,
      [orgId, userId, role.rows[0].id, dto.site_id ?? null, dto.room_ids ?? null],
    );

    // Token signé 7 jours — contient le but (purpose) pour éviter les usages croisés.
    const token = await this.jwtService.signAsync(
      {
        purpose: 'invitation',
        sub: userId,
        orgId,
        role: role.rows[0].slug,
        email,
      },
      { expiresIn: '7d' },
    );

    await this.email.sendInvitation(email, token, org.rows[0].name_fr);
    await this.audit.log({
      organizationId: orgId,
      userId: actorId,
      action: 'create',
      resourceType: 'membership',
      resourceId: membership.rows[0].id,
      resourceLabel: email,
      newValues: { role: role.rows[0].slug, invited: true },
    });

    return {
      invitation_id: membership.rows[0].id,
      email,
      role_slug: role.rows[0].slug,
      status: userStatus === 'active' ? 'already_member' : 'invited',
      invitation_token: token,
    };
  }

  /** Membres (invités + actifs) du tenant courant. */
  async list(): Promise<Array<Record<string, unknown>>> {
    const orgId = this.tenantContext.getTenantIdOrNull();
    if (!orgId) {
      throw new AppError('ORGANIZATION_REQUIRED', 'Contexte organisation requis', 'سياق المؤسسة مطلوب', 400);
    }
    return this.tenantContext.withTenantConnection(async (client) => {
      const res = await client.query(
        `SELECT m.id, m.user_id, u.email,
                COALESCE(u.first_name, '') AS first_name,
                COALESCE(u.last_name, '') AS last_name,
                r.slug AS role_slug, r.name AS role_name,
                m.site_id, m.room_ids, m.is_active, m.invited_at, m.joined_at
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN roles r ON r.id = m.role_id
         WHERE m.organization_id = $1
         ORDER BY m.created_at DESC`,
        [orgId],
      );
      return res.rows;
    });
  }
}
