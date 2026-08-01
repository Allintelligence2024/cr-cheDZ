import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../../shared/database/database.provider';
import { AppError, Errors } from '../../shared/errors';
import { AuditService } from '../privacy/audit.service';
import { SessionsService } from './sessions.service';
import { TotpService } from './totp.service';

interface MembershipRow {
  organization_id: string;
  organization_name: string;
  role_id: string;
  role_slug: string;
  role_name: string;
  site_id: string | null;
  room_ids: string[] | null;
}

interface UserRow {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string;
  last_name: string;
  locale: string;
  password_hash: string | null;
  status: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  is_super_admin: boolean;
  failed_attempts: number;
  locked_until: Date | null;
}

export interface LoginResult {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
    organization_id: string | null;
    role: string;
    is_super_admin: boolean;
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: SessionsService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
  ) {}

  // ── Login ────────────────────────────────────────────────────────────────

  async login(
    email: string,
    password: string,
    totpCode: string | undefined,
    deviceId: string | undefined,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const res = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase().trim()],
    );
    const user = res.rows[0];

    // Compteur d'échecs partagé : on incrémente même si l'utilisateur n'existe pas
    // (anti-énumération), mais on ne garde pas de ligne pour un email inconnu.
    if (!user) {
      await this.recordFailedAttempt(null, email);
      throw Errors.invalidCredentials();
    }

    if (user.locked_until && user.locked_until > new Date()) {
      throw Errors.accountLocked(this.config.get<number>('ACCOUNT_LOCK_MINUTES', 15));
    }
    if (user.status !== 'active' && user.status !== 'pending') {
      throw Errors.accountSuspended();
    }

    const passwordOk =
      user.password_hash != null && (await bcrypt.compare(password, user.password_hash));
    if (!passwordOk) {
      await this.recordFailedAttempt(user.id, email);
      throw Errors.invalidCredentials();
    }

    if (user.totp_enabled) {
      if (!totpCode || !user.totp_secret || !this.totp.verify(user.totp_secret, totpCode)) {
        throw Errors.totpInvalid();
      }
    }

    const membership = await this.membershipFor(user);

    await this.pool.query(
      `UPDATE users
       SET failed_attempts = 0, locked_until = NULL,
           last_login_at = NOW(), last_login_ip = $2, version = version + 1
       WHERE id = $1`,
      [user.id, ipAddress ?? null],
    );

    const session = await this.sessions.createSession({
      userId: user.id,
      organizationId: membership?.organization_id ?? null,
      deviceId,
      ipAddress,
      userAgent,
    });

    const accessToken = this.signAccessToken(user, membership);
    await this.audit.log({
      organizationId: membership?.organization_id ?? null,
      userId: user.id,
      sessionId: session.sessionId,
      action: 'login',
      resourceType: 'user',
      resourceId: user.id,
      resourceLabel: user.email ?? undefined,
      newValues: { status: user.status, organization_id: membership?.organization_id ?? null },
      ipAddress,
      userAgent,
    });

    return {
      access_token: accessToken,
      refresh_token: session.refreshToken,
      expires_in: 15 * 60,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        organization_id: membership?.organization_id ?? null,
        role: user.is_super_admin ? 'super_admin' : (membership?.role_slug ?? 'none'),
        is_super_admin: user.is_super_admin,
      },
    };
  }

  // ── Refresh (rotation + détection de réutilisation) ─────────────────────

  async refresh(
    refreshToken: string,
    deviceId: string | undefined,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const hash = SessionsService.hashRefreshToken(refreshToken);
    const res = await this.pool.query(
      `SELECT * FROM auth_refresh_lookup($1)`,
      [hash],
    );
    const row = res.rows[0];
    if (!row) throw Errors.invalidRefreshToken();

    if (row.session_revoked_at) {
      // Session révoquée à cause de la révocation de l'appareil → message dédié,
      // pas de suspicion de compromission.
      if (row.revoked_reason === 'device_revoked') throw Errors.deviceRevoked();

      // Réutilisation d'un refresh déjà révoqué → compromission présumée :
      // on révoque toutes les sessions de l'utilisateur.
      await this.sessions.revokeAllForUser(row.user_id, 'reuse_detected');
      await this.audit.log({
        organizationId: row.organization_id,
        userId: row.user_id,
        action: 'revoke',
        resourceType: 'session',
        resourceLabel: 'reuse_detected',
      });
      throw Errors.sessionReuseDetected();
    }
    if (new Date(row.expires_at) < new Date()) throw Errors.sessionExpired();
    if (row.device_id && row.device_revoked) throw Errors.deviceRevoked();
    if (row.user_status !== 'active') throw Errors.accountSuspended();

    // Rotation : la session courante est révoquée, une nouvelle est créée.
    await this.pool.query(
      `UPDATE sessions SET revoked_at = NOW(), revoked_reason = 'rotated'
       WHERE id = $1 AND revoked_at IS NULL`,
      [row.session_id],
    );

    const userRes = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [row.user_id],
    );
    const user = userRes.rows[0];
    if (!user) throw Errors.invalidRefreshToken();

    const membership = await this.membershipFor(user);
    const session = await this.sessions.createSession({
      userId: user.id,
      organizationId: membership?.organization_id ?? null,
      deviceId: deviceId ?? row.device_id,
      ipAddress,
      userAgent,
    });

    const accessToken = this.signAccessToken(user, membership);
    return {
      access_token: accessToken,
      refresh_token: session.refreshToken,
      expires_in: 15 * 60,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        organization_id: membership?.organization_id ?? null,
        role: user.is_super_admin ? 'super_admin' : (membership?.role_slug ?? 'none'),
        is_super_admin: user.is_super_admin,
      },
    };
  }

  async logout(refreshToken: string, userId: string, ipAddress?: string, userAgent?: string): Promise<void> {
    const hash = SessionsService.hashRefreshToken(refreshToken);
    const revoked = await this.sessions.revokeByRefreshHash(hash, 'logout');
    if (revoked) {
      await this.audit.log({
        userId,
        action: 'logout',
        resourceType: 'session',
        ipAddress,
        userAgent,
      });
    }
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
    ipAddress?: string,
  ): Promise<void> {
    const res = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    const user = res.rows[0];
    if (!user || user.password_hash == null || !(await bcrypt.compare(oldPassword, user.password_hash))) {
      throw new AppError('INVALID_CREDENTIALS', 'Mot de passe actuel incorrect', 'كلمة المرور الحالية غير صحيحة', 400);
    }
    const hash = await bcrypt.hash(newPassword, this.config.get<number>('BCRYPT_ROUNDS', 12));
    await this.pool.query(
      `UPDATE users SET password_hash = $2, version = version + 1 WHERE id = $1`,
      [userId, hash],
    );
    await this.sessions.revokeAllForUser(userId, 'password_changed');
    await this.audit.log({
      userId,
      action: 'update',
      resourceType: 'user',
      resourceId: userId,
      newValues: { password_changed: true },
      ipAddress,
    });
  }

  // ── Invitations (acceptation) ───────────────────────────────────────────

  /**
   * Accepte une invitation (token signé 7 j, purpose='invitation') :
   * active l'utilisateur, fixe mot de passe + nom, marque joined_at et
   * retourne une session complète (access + refresh).
   */
  async acceptInvitation(
    token: string,
    profile: { firstName: string; lastName: string; password: string },
    ctx: { deviceId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<LoginResult> {
    let payload: { purpose?: string; sub?: string; orgId?: string; role?: string };
    try {
      payload = await this.jwtService.verifyAsync(token);
    } catch {
      throw new AppError('INVALID_INVITATION', 'Lien d\'invitation invalide ou expiré', 'رابط الدعوة غير صالح أو منتهي', 400);
    }
    if (payload.purpose !== 'invitation' || !payload.sub || !payload.orgId) {
      throw new AppError('INVALID_INVITATION', 'Lien d\'invitation invalide ou expiré', 'رابط الدعوة غير صالح أو منتهي', 400);
    }

    const res = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [payload.sub],
    );
    const user = res.rows[0];
    if (!user) {
      throw new AppError('INVALID_INVITATION', 'Lien d\'invitation invalide ou expiré', 'رابط الدعوة غير صالح أو منتهي', 400);
    }
    if (user.status === 'active') {
      throw new AppError('INVITATION_ALREADY_USED', 'Cette invitation a déjà été utilisée', 'تم استخدام هذه الدعوة بالفعل', 400);
    }

    const hash = await bcrypt.hash(profile.password, this.config.get<number>('BCRYPT_ROUNDS', 12));
    await this.pool.query(
      `UPDATE users
       SET first_name = $2, last_name = $3, password_hash = $4,
           status = 'active', email_verified_at = NOW(), failed_attempts = 0,
           version = version + 1
       WHERE id = $1`,
      [user.id, profile.firstName, profile.lastName, hash],
    );
    await this.pool.query(`SELECT invite_accept($1, $2)`, [user.id, payload.orgId]);

    await this.audit.log({
      organizationId: payload.orgId,
      userId: user.id,
      action: 'approve',
      resourceType: 'membership',
      resourceLabel: 'invitation_accept',
      newValues: { role: payload.role },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return this.issueTokenPair(user, ctx);
  }

  /** Construit une session complète (access + refresh) pour un utilisateur. */
  private async issueTokenPair(
    user: UserRow,
    ctx: { deviceId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<LoginResult> {
    const membership = await this.membershipFor(user);
    const session = await this.sessions.createSession({
      userId: user.id,
      organizationId: membership?.organization_id ?? null,
      deviceId: ctx.deviceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const accessToken = this.signAccessToken(user, membership);
    return {
      access_token: accessToken,
      refresh_token: session.refreshToken,
      expires_in: 15 * 60,
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
        organization_id: membership?.organization_id ?? null,
        role: user.is_super_admin ? 'super_admin' : (membership?.role_slug ?? 'none'),
        is_super_admin: user.is_super_admin,
      },
    };
  }

  // ── 2FA ─────────────────────────────────────────────────────────────────

  async enableTotp(userId: string): Promise<{ secret: string; otpauth_url: string }> {
    const res = await this.pool.query<UserRow>(`SELECT email, totp_secret FROM users WHERE id = $1`, [userId]);
    const user = res.rows[0];
    const secret = user?.totp_secret ?? this.totp.generateSecret();
    await this.pool.query(
      `UPDATE users SET totp_secret = $2, version = version + 1 WHERE id = $1`,
      [userId, secret],
    );
    return {
      secret,
      otpauth_url: this.totp.otpauthUrl(secret, user?.email ?? userId),
    };
  }

  async verifyTotp(userId: string, code: string): Promise<{ enabled: boolean }> {
    const res = await this.pool.query<UserRow>(`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, [userId]);
    const user = res.rows[0];
    if (!user?.totp_secret || !this.totp.verify(user.totp_secret, code)) {
      throw Errors.totpInvalid();
    }
    if (!user.totp_enabled) {
      await this.pool.query(`UPDATE users SET totp_enabled = true, version = version + 1 WHERE id = $1`, [userId]);
      await this.audit.log({ userId, action: 'update', resourceType: 'user', resourceId: userId, newValues: { totp_enabled: true } });
    }
    return { enabled: true };
  }

  async disableTotp(userId: string, code: string): Promise<{ enabled: boolean }> {
    const res = await this.pool.query<UserRow>(`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, [userId]);
    const user = res.rows[0];
    if (!user?.totp_secret || !this.totp.verify(user.totp_secret, code)) {
      throw Errors.totpInvalid();
    }
    await this.pool.query(
      `UPDATE users SET totp_enabled = false, totp_secret = NULL, version = version + 1 WHERE id = $1`,
      [userId],
    );
    await this.audit.log({ userId, action: 'update', resourceType: 'user', resourceId: userId, newValues: { totp_enabled: false } });
    return { enabled: false };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async membershipFor(user: UserRow): Promise<MembershipRow | null> {
    if (user.is_super_admin) return null;
    const res = await this.pool.query<MembershipRow>(`SELECT * FROM auth_get_memberships($1)`, [user.id]);
    return res.rows[0] ?? null;
  }

  private signAccessToken(user: UserRow, membership: MembershipRow | null): string {
    const role = user.is_super_admin ? 'super_admin' : (membership?.role_slug ?? 'none');
    return this.jwtService.sign({
      sub: user.id,
      organizationId: membership?.organization_id ?? null,
      role,
      isSuperAdmin: user.is_super_admin,
      email: user.email,
    });
  }

  private async recordFailedAttempt(userId: string | null, email: string): Promise<void> {
    if (!userId) return;
    const max = this.config.get<number>('MAX_LOGIN_ATTEMPTS', 5);
    const lockMinutes = this.config.get<number>('ACCOUNT_LOCK_MINUTES', 15);
    const res = await this.pool.query<UserRow>(
      `SELECT failed_attempts, locked_until FROM users WHERE id = $1`,
      [userId],
    );
    const current = res.rows[0];
    const attempts = (current?.failed_attempts ?? 0) + 1;
    const lockUntil = attempts >= max ? new Date(Date.now() + lockMinutes * 60_000) : null;
    await this.pool.query(
      `UPDATE users SET failed_attempts = $2, locked_until = $3, version = version + 1 WHERE id = $1`,
      [userId, attempts, lockUntil],
    );
    void email;
  }
}
