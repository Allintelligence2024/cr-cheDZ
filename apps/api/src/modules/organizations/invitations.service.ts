import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { PG_POOL } from '../../shared/database/database.provider';
import { TenantContextService } from '../../shared/database/tenant-context.service';
import { AppError, Errors } from '../../shared/errors';
import { assertRoleAssignable } from '../../shared/roles/assignable-roles';
import { INVITATION_JWT_SERVICE } from '../../shared/auth/invitation-jwt.module';
import { INVITATION_TOKEN_PURPOSE } from '../../shared/auth/jwt-token-options';
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
 * token signé (7 j), remis seulement en development ; transport réel non livré.
 * Acceptation via POST /auth/accept-invitation.
 */
@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly tenantContext: TenantContextService,
    @Inject(INVITATION_JWT_SERVICE) private readonly invitationJwtService: JwtService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async create(
    dto: CreateInvitationDto,
    actorId: string,
  ): Promise<InvitationResult> {
    const tenantId = this.tenantContext.getTenantIdOrNull();
    const actor = (await this.pool.query(
      `SELECT is_super_admin FROM users WHERE id=$1 AND status='active' AND deleted_at IS NULL`, [actorId],
    )).rows[0];
    if (!actor) throw Errors.forbidden();
    if (!actor.is_super_admin) {
      if (!tenantId || (dto.organization_id && dto.organization_id !== tenantId)) throw Errors.forbidden();
      const memberships = await this.pool.query(`SELECT * FROM auth_get_memberships($1) WHERE organization_id=$2`, [actorId, tenantId]);
      const roles = await this.pool.query(`SELECT role_slug FROM auth_user_roles($1) WHERE organization_id=$2`, [actorId, tenantId]);
      if (!memberships.rows[0] || !roles.rows.some(r => r.role_slug === 'director')) throw Errors.forbidden();
    }
    const orgId = dto.organization_id ?? tenantId;
    if (!orgId) {
      throw new AppError(
        'ORGANIZATION_REQUIRED',
        'organization_id requis pour un super_admin',
        'organization_id مطلوب',
        400,
      );
    }
    // Garde centralisée (C2 — audit 2026-09) : super_admin n'est jamais
    // attribuable, ni par invitation ni par affectation multi-rôles.
    assertRoleAssignable(dto.role_slug);
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

    // No domain write before verifying that the delivered transport is available.
    this.email.assertInvitationDeliveryAvailable();
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

    // Token signé 7 jours — SECRET DÉRIVÉ dédié aux invitations (C4) et
    // purpose='invitation' : utilisable uniquement par accept-invitation.
    const token = await this.invitationJwtService.signAsync(
      {
        purpose: INVITATION_TOKEN_PURPOSE,
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
      ...(this.config.get<string>('NODE_ENV') === 'development' ? { invitation_token: token } : {}),
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
