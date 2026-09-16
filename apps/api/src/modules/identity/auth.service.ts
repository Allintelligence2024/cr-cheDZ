import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { randomInt } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import * as bcrypt from 'bcryptjs';
import { PG_POOL } from '../../shared/database/database.provider';
import { AppError, Errors } from '../../shared/errors';
import { ACCESS_TOKEN_PURPOSE } from '../../shared/auth/jwt-token-options';
import { INVITATION_JWT_SERVICE } from '../../shared/auth/invitation-jwt.module';
import { AuditService } from '../privacy/audit.service';
import { SessionsService } from './sessions.service';
import { TotpService } from './totp.service';
import { SmsService } from '../../shared/sms/sms.service';
import { WhatsAppService } from '../../shared/whatsapp/whatsapp.service';

// Work factor for unknown accounts; not a promise of constant network latency.
const DUMMY_PASSWORD_HASH = '$2b$12$0BIuseBWXKjyHtdMOE3Rk.hzrgIz6M3nCdfBu/VftHWG5Vd6IXDAu';

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
  parent_pin_hash: string | null;
  status: string;
  totp_secret: string | null;
  totp_enabled: boolean;
  is_super_admin: boolean;
  failed_attempts: number;
  locked_until: Date | null;
  /** G4 (audit 2026-09) : époque de révocation (users.token_epoch, mig. 062). */
  token_epoch?: string | number;
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
    @Inject(INVITATION_JWT_SERVICE) private readonly invitationJwtService: JwtService,
    private readonly config: ConfigService,
    private readonly sessions: SessionsService,
    private readonly totp: TotpService,
    private readonly audit: AuditService,
    private readonly sms: SmsService,
    private readonly whatsapp: WhatsAppService,
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

    // Verify the secret before disclosing status/lockout. Unknown accounts
    // receive the same public error and still perform a bcrypt comparison.
    const passwordOk = await bcrypt.compare(password, user?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!user?.password_hash || !passwordOk) {
      await this.recordFailedAttempt(user?.id ?? null, email);
      throw Errors.invalidCredentials();
    }
    this.assertLoginAllowed(user);

    if (user.totp_enabled) {
      if (!totpCode || !user.totp_secret || !this.totp.verify(user.totp_secret, totpCode)) {
        await this.recordFailedAttempt(user.id, email);
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

    const accessToken = await this.signAccessToken(user, membership);
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

  // ── Parent OTP + PIN ───────────────────────────────────────────────────

  /**
   * Demande d'OTP parent. Canal 'sms' (défaut) ou 'whatsapp' (roadmap v2) :
   * le canal WhatsApp exige le flag global `whatsapp_otp` + une configuration
   * WHATSAPP_TOKEN/WHATSAPP_PHONE_ID réelle — sans elle le fournisseur répond
   * 503 WHATSAPP_NOT_CONFIGURED (jamais de faux « envoyé »). En mode test,
   * l'envoi fournisseur est court-circuité comme pour le SMS.
   */
  async requestParentOtp(
    phone: string,
    channel: 'sms' | 'whatsapp' = 'sms',
  ): Promise<{ expires_in: number; channel: 'sms' | 'whatsapp'; development_code?: string }> {
    const target = phone.trim();
    if (channel === 'whatsapp') await this.assertWhatsappOtpEnabled();
    // Réponse identique si le numéro est inconnu (anti-énumération).
    // Code OTP généré par crypto.randomInt (jamais Math.random — PRNG non sûr).
    const code = String(randomInt(100000, 1000000));
    await this.pool.query(`UPDATE otp_codes SET used_at = NOW() WHERE target = $1 AND purpose = 'parent_login' AND used_at IS NULL`, [target]);
    await this.pool.query(
      `INSERT INTO otp_codes (target, code_hash, purpose, channel, expires_at) VALUES ($1,$2,'parent_login',$3,NOW() + INTERVAL '10 minutes')`,
      [target, await bcrypt.hash(code, Number(this.config.get<number>('BCRYPT_ROUNDS', 12))), channel],
    );
    if (channel === 'whatsapp') {
      await this.sendOTPByWhatsApp(target, code);
    } else {
      await this.sms.sendOtp(target, code);
    }
    // Le code explicite n'existe qu'en test et ne traverse jamais la production.
    return { expires_in: 600, channel, ...(this.config.get<string>('NODE_ENV') === 'test' ? { development_code: code } : {}) };
  }

  /** Flag global whatsapp_otp requis (422 bilingue sinon) — jamais d'envoi sans flag. */
  private async assertWhatsappOtpEnabled(): Promise<void> {
    // rls-guard: allow lecture du flag GLOBAL uniquement (organization_id IS NULL),
    // rendu visible sans contexte tenant par la policy feature_flags_tenant
    // (USING (organization_id IS NULL) OR …) — jamais de ligne d'une org.
    const flag = await this.pool.query<{ is_enabled: boolean }>(
      `SELECT is_enabled FROM feature_flags
       WHERE flag_key='whatsapp_otp' AND organization_id IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    );
    if (!flag.rows[0]?.is_enabled) {
      throw new AppError(
        'WHATSAPP_OTP_DISABLED',
        'Le canal WhatsApp pour les codes de connexion n’est pas activé',
        'قناة واتساب لرموز الدخول غير مفعّلة',
        422,
      );
    }
  }

  /** Envoi réel via l'API Graph (court-circuit test identique au SMS). */
  private async sendOTPByWhatsApp(target: string, code: string): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    await this.whatsapp.send(
      target,
      `Crèche DZ — code de connexion : ${code}. Valable 10 minutes.\nرمز الدخول: ${code} (صالح لمدة 10 دقائق).`,
    );
  }

  async verifyParentOtp(phone: string, code: string, ctx: { deviceId?: string; ipAddress?: string; userAgent?: string }): Promise<LoginResult> {
    const target = phone.trim();
    const otp = await this.pool.query<{ id: string; code_hash: string; attempts: number }>(
      `SELECT id, code_hash, attempts FROM otp_codes WHERE target=$1 AND purpose='parent_login' AND used_at IS NULL AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1`, [target],
    );
    const row = otp.rows[0];
    if (!row || row.attempts >= 5 || !(await bcrypt.compare(code, row.code_hash))) {
      if (row) await this.pool.query(`UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1 AND used_at IS NULL AND attempts<5`, [row.id]);
      throw new AppError('OTP_INVALID', 'Code de vérification incorrect ou expiré', 'رمز التحقق غير صحيح أو منتهي', 401);
    }
    const consumed = await this.pool.query(
      `UPDATE otp_codes SET used_at=NOW()
       WHERE id=$1 AND used_at IS NULL AND attempts<5 AND expires_at>NOW() RETURNING id`, [row.id],
    );
    if (consumed.rowCount !== 1) throw new AppError('OTP_INVALID', 'Code de vérification incorrect ou expiré', 'رمز التحقق غير صحيح أو منتهي', 401);
    // Bootstrap RLS : guardians est une table tenant ; la fonction SECURITY
    // DEFINER (migration 025) fait la recherche hors contexte tenant.
    const found = await this.pool.query<UserRow>(
      `SELECT * FROM auth_parent_lookup_by_phone($1)`,
      [target],
    );
    const user = found.rows[0];
    if (!user?.id) throw new AppError('OTP_INVALID', 'Code de vérification incorrect ou expiré', 'رمز التحقق غير صحيح أو منتهي', 401);
    return this.issueTokenPair(user, ctx);
  }

  async setParentPin(userId: string, pin: string): Promise<void> {
    await this.pool.query(`UPDATE users SET parent_pin_hash=$2, version=version+1 WHERE id=$1`, [userId, await bcrypt.hash(pin, Number(this.config.get<number>('BCRYPT_ROUNDS', 12)))]);
  }

  async loginParentPin(phone: string, pin: string, ctx: { deviceId?: string; ipAddress?: string; userAgent?: string }): Promise<LoginResult> {
    // Bootstrap RLS : guardians est une table tenant ; la fonction SECURITY
    // DEFINER (migration 025) fait la recherche hors contexte tenant.
    const res = await this.pool.query<UserRow>(
      `SELECT * FROM auth_parent_lookup_by_phone($1)`,
      [phone.trim()],
    );
    const user = res.rows[0];
    if (!user?.parent_pin_hash || !(await bcrypt.compare(pin, user.parent_pin_hash))) {
      await this.recordFailedAttempt(user?.id ?? null, phone);
      throw new AppError('INVALID_PARENT_PIN', 'PIN incorrect', 'رمز PIN غير صحيح', 401);
    }
    return this.issueTokenPair(user, ctx);
  }

  // ── Refresh (rotation + détection de réutilisation) ─────────────────────

  async refresh(
    refreshToken: string,
    deviceId: string | undefined,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const hash = SessionsService.hashRefreshToken(refreshToken);
    const client = await this.pool.connect();
    let reused: { userId: string; organizationId: string | null } | undefined;
    try {
      await client.query('BEGIN');
      const initial = (await client.query(`SELECT * FROM auth_refresh_lookup($1)`, [hash])).rows[0];
      if (!initial) throw Errors.invalidRefreshToken();

      // Same-user refreshes (including replay on another session) share one lock.
      // Lock user BEFORE session consistently; reload session state after waiting.
      const user = (await client.query<UserRow>(
        `SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [initial.user_id],
      )).rows[0];
      if (!user) throw Errors.invalidRefreshToken();
      await client.query(`SELECT id FROM sessions WHERE id=$1 FOR UPDATE`, [initial.session_id]);
      const row = (await client.query(`SELECT * FROM auth_refresh_lookup($1)`, [hash])).rows[0];
      if (!row) throw Errors.invalidRefreshToken();

      if (row.session_revoked_at) {
        if (row.revoked_reason === 'device_revoked') throw Errors.deviceRevoked();
        // Preserve existing reuse policy: revoke ALL this user's refresh sessions.
        // Commit this security effect before reporting failure to the caller.
        await this.sessions.revokeAllForUser(row.user_id, 'reuse_detected', client);
        await client.query('COMMIT');
        reused = { userId: row.user_id, organizationId: row.organization_id };
      } else {
        if (new Date(row.expires_at).getTime() <= Date.now()) throw Errors.sessionExpired();
        if (row.device_id && row.device_revoked) throw Errors.deviceRevoked();
        if (user.status !== 'active') throw Errors.accountSuspended();

        await client.query(
          `UPDATE sessions SET revoked_at=NOW(), revoked_reason='rotated' WHERE id=$1`, [row.session_id],
        );
        const membership = await this.membershipFor(user, client);
        const session = await this.sessions.createSession({
          userId: user.id,
          organizationId: membership?.organization_id ?? null,
          deviceId: deviceId ?? row.device_id,
          ipAddress,
          userAgent,
        }, client);
        const accessToken = await this.signAccessToken(user, membership, client);
        await client.query('COMMIT');
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
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    // Legacy best-effort audit is deliberately outside the committed revocation.
    if (reused) await this.audit.log({
      organizationId: reused.organizationId,
      userId: reused.userId,
      action: 'revoke',
      resourceType: 'session',
      resourceLabel: 'reuse_detected',
    });
    throw Errors.sessionReuseDetected();
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
    const hash = await bcrypt.hash(newPassword, Number(this.config.get<number>('BCRYPT_ROUNDS', 12)));
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
    let payload: { purpose?: string; sub?: string; orgId?: string; role?: string; email?: string };
    try {
      // C4 (audit 2026-09) : vérification avec le JwtService d'INVITATION
      // (secret dérivé) — un access token ne peut plus être confondu ici,
      // et un token d'invitation ne peut plus servir de session.
      payload = await this.invitationJwtService.verifyAsync(token);
    } catch {
      throw new AppError('INVALID_INVITATION', 'Lien d\'invitation invalide ou expiré', 'رابط الدعوة غير صالح أو منتهي', 400);
    }
    if (payload.purpose !== 'invitation' || typeof payload.sub !== 'string' || !isUUID(payload.sub)
      || typeof payload.orgId !== 'string' || !isUUID(payload.orgId)) {
      throw new AppError('INVALID_INVITATION', 'Lien d\'invitation invalide ou expiré', 'رابط الدعوة غير صالح أو منتهي', 400);
    }

    const invalid = () => new AppError('INVALID_INVITATION',
      'Lien d’invitation invalide ou expiré', 'رابط الدعوة غير صالح أو منتهي', 400);
    // Compute the expensive hash before taking locks; all checks run again inside.
    const hash = await bcrypt.hash(profile.password, Number(this.config.get<number>('BCRYPT_ROUNDS', 12)));
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id',$1,true), set_config('app.user_id',$2,true)`, [payload.orgId, payload.sub]);
      const user = (await client.query<UserRow>(
        `SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`, [payload.sub],
      )).rows[0];
      if (!user) throw invalid();
      if (user.status === 'active') throw new AppError('INVITATION_ALREADY_USED',
        'Cette invitation a déjà été utilisée', 'تم استخدام هذه الدعوة بالفعل', 400);
      if (user.status !== 'pending' || user.email !== payload.email) throw invalid();
      this.assertLoginAllowed(user);
      const org = await client.query(`SELECT id FROM organizations WHERE id=$1 AND is_active=true`, [payload.orgId]);
      if (!org.rows[0]) throw invalid();
      const invited = (await client.query(
        `SELECT m.id, m.is_active, m.joined_at, r.slug FROM memberships m JOIN roles r ON r.id=m.role_id
         WHERE m.user_id=$1 AND m.organization_id=$2 FOR UPDATE OF m`, [user.id, payload.orgId],
      )).rows[0];
      if (!invited || !invited.is_active || invited.joined_at || invited.slug !== payload.role) throw invalid();
      // A request can outlive the JWT while waiting for an account/membership lock.
      try { await this.invitationJwtService.verifyAsync(token); } catch { throw invalid(); }
      const activated = (await client.query<UserRow>(
        `UPDATE users SET first_name=$2,last_name=$3,password_hash=$4,status='active',
          email_verified_at=NOW(),failed_attempts=0,locked_until=NULL,version=version+1
         WHERE id=$1 RETURNING *`, [user.id, profile.firstName, profile.lastName, hash],
      )).rows[0];
      await client.query(`UPDATE memberships SET joined_at=NOW() WHERE id=$1`, [invited.id]);
      // The invitation's tenant is explicit, never the account's oldest membership.
      const membership = (await client.query<MembershipRow>(
        `SELECT * FROM auth_get_memberships($1) WHERE organization_id=$2`, [user.id, payload.orgId],
      )).rows[0];
      if (!membership) throw invalid();
      const session = await this.sessions.createSession({
        userId: user.id, organizationId: payload.orgId, deviceId: ctx.deviceId,
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      }, client);
      const accessToken = await this.signAccessToken(activated, membership, client);
      await this.audit.logInTransaction(client, {
        organizationId: payload.orgId, userId: user.id, action: 'approve',
        resourceType: 'membership', resourceId: invited.id, resourceLabel: 'invitation_accept',
        newValues: { role: invited.slug }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      });
      await client.query('COMMIT');
      return {
        access_token: accessToken, refresh_token: session.refreshToken, expires_in: 15 * 60,
        user: { id: user.id, first_name: activated.first_name, last_name: activated.last_name,
          email: activated.email, organization_id: membership.organization_id,
          role: membership.role_slug, is_super_admin: activated.is_super_admin },
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  /** Construit une session complète (access + refresh) pour un utilisateur. */
  private async issueTokenPair(
    user: UserRow,
    ctx: { deviceId?: string; ipAddress?: string; userAgent?: string },
  ): Promise<LoginResult> {
    // Parent PIN/OTP issuance: refresh status after the initial account lookup.
    // Invitation acceptance uses its own atomic transaction above.
    const current = await this.pool.query<UserRow>(
      `SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL`, [user.id],
    );
    user = current.rows[0];
    if (!user) throw Errors.invalidCredentials();
    this.assertLoginAllowed(user);
    const membership = await this.membershipFor(user);
    await this.pool.query(`UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=$1`, [user.id]);
    const session = await this.sessions.createSession({
      userId: user.id,
      organizationId: membership?.organization_id ?? null,
      deviceId: ctx.deviceId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
    const accessToken = await this.signAccessToken(user, membership);
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
    return this.withTotpAccount(userId, async (client, user) => {
      // A bearer token alone must never reveal an already activated factor.
      if (user.totp_enabled) throw Errors.totpAlreadyEnabled();
      const secret = user.totp_secret ?? this.totp.generateSecret();
      if (!user.totp_secret) {
        await client.query('UPDATE users SET totp_secret=$2, version=version+1 WHERE id=$1', [userId, secret]);
        await this.audit.logInTransaction(client, {
          userId, action: 'update', resourceType: 'user', resourceId: userId,
          newValues: { totp_setup: true },
        });
      }
      return { secret, otpauth_url: this.totp.otpauthUrl(secret, user.email ?? userId) };
    });
  }

  async verifyTotp(userId: string, code: string): Promise<{ enabled: boolean }> {
    return this.changeTotp(userId, code, true);
  }

  async disableTotp(userId: string, code: string): Promise<{ enabled: boolean }> {
    return this.changeTotp(userId, code, false);
  }

  private async changeTotp(userId: string, code: string, enabled: boolean): Promise<{ enabled: boolean }> {
    return this.withTotpAccount(userId, async (client, user) => {
      if (!user.totp_secret) return Errors.totpInvalid();
      if (!this.totp.verify(user.totp_secret, code)) {
        await this.recordFailedAttempt(userId, user.email ?? '', client);
        // Returned, not thrown: persist the failed proof before emitting 401.
        return Errors.totpInvalid();
      }
      if (!enabled || !user.totp_enabled) {
        await client.query(
          `UPDATE users SET totp_enabled=$2,
             totp_secret=CASE WHEN $2 THEN totp_secret ELSE NULL END,
             failed_attempts=0, locked_until=NULL, version=version+1 WHERE id=$1`,
          [userId, enabled],
        );
        await this.audit.logInTransaction(client, {
          userId, action: 'update', resourceType: 'user', resourceId: userId,
          newValues: { totp_enabled: enabled },
        });
      } else if (user.failed_attempts || user.locked_until) {
        await client.query('UPDATE users SET failed_attempts=0, locked_until=NULL, version=version+1 WHERE id=$1', [userId]);
      }
      return { enabled };
    });
  }

  /** Account-scoped settings: current state and secret are checked AFTER the
   * user lock. Keep factor mutation and minimal audit on this same connection.
   * AppError values commit failed-proof counters; thrown errors roll back.
   */
  private async withTotpAccount<T>(
    userId: string,
    operation: (client: PoolClient, user: UserRow) => Promise<T | AppError>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let result: T | AppError;
    try {
      await client.query('BEGIN');
      const res = await client.query<UserRow>('SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [userId]);
      const user = res.rows[0];
      if (!user) throw Errors.invalidCredentials();
      this.assertLoginAllowed(user);
      result = await operation(client, user);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (result instanceof AppError) throw result;
    return result;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async membershipFor(user: UserRow, client: Pick<PoolClient, 'query'> = this.pool): Promise<MembershipRow | null> {
    if (user.is_super_admin) return null;
    const res = await client.query<MembershipRow>(`SELECT * FROM auth_get_memberships($1)`, [user.id]);
    return res.rows[0] ?? null;
  }

  /** Rôles effectifs (principal + additions) pour le JWT — multi-rôles (040). */
  private async effectiveRoles(userId: string, membership: MembershipRow | null, client: Pick<PoolClient, 'query'> = this.pool): Promise<string[]> {
    if (!membership) return [];
    const res = await client.query<{ role_slug: string }>(`SELECT role_slug FROM auth_user_roles($1) WHERE organization_id = $2`, [userId, membership.organization_id]);
    return res.rows.map((r) => r.role_slug);
  }

  private async signAccessToken(user: UserRow, membership: MembershipRow | null, client: Pick<PoolClient, 'query'> = this.pool): Promise<string> {
    const role = user.is_super_admin ? 'super_admin' : (membership?.role_slug ?? 'none');
    const roles = user.is_super_admin ? ['super_admin'] : await this.effectiveRoles(user.id, membership, client);
    // G4 : l'époque est relue au moment de la signature (dans la transaction
    // courante) — les bumps déclencheurs intervenus pendant la requête (ex.
    // acceptation d'invitation qui met à jour users ET memberships) sont
    // reflétés, jamais l'ancienne valeur de la ligne chargée en amont.
    const epochRes = await client.query<{ token_epoch: string | number | null }>(
      'SELECT token_epoch FROM users WHERE id = $1',
      [user.id],
    );
    const epoch = Number(epochRes.rows[0]?.token_epoch ?? 0);
    return this.jwtService.sign({
      purpose: ACCESS_TOKEN_PURPOSE,
      sub: user.id,
      organizationId: membership?.organization_id ?? null,
      role,
      roles,
      isSuperAdmin: user.is_super_admin,
      email: user.email,
      epoch,
    });
  }

  private assertLoginAllowed(user: UserRow): void {
    // Existing onboarding contract: active and pending may authenticate.
    if (user.status !== 'active' && user.status !== 'pending') throw Errors.accountSuspended();
    if (user.locked_until && user.locked_until > new Date()) {
      throw Errors.accountLocked(Number(this.config.get<number>('ACCOUNT_LOCK_MINUTES', 15)));
    }
  }

  private async recordFailedAttempt(userId: string | null, email: string, client: Pick<PoolClient, 'query'> = this.pool): Promise<void> {
    if (!userId) return;
    const max = Number(this.config.get<number>('MAX_LOGIN_ATTEMPTS', 5));
    const lockMinutes = Number(this.config.get<number>('ACCOUNT_LOCK_MINUTES', 15));
    // One row-serialized update. Concurrent failures cannot overwrite increments;
    // an expired lock starts a fresh window, an active lock is not prolonged.
    // Use statement time: a caller transaction may have waited on the user lock.
    await client.query(
      `UPDATE users SET
         failed_attempts = CASE WHEN locked_until<=statement_timestamp() THEN 1 ELSE failed_attempts+1 END,
         locked_until = CASE
           WHEN (CASE WHEN locked_until<=statement_timestamp() THEN 1 ELSE failed_attempts+1 END)>=$2
             THEN statement_timestamp() + ($3 * INTERVAL '1 minute') ELSE NULL END,
         version = version+1
       WHERE id=$1 AND (locked_until IS NULL OR locked_until<=statement_timestamp())
       RETURNING failed_attempts, locked_until`,
      [userId, max, lockMinutes],
    );
    void email;
  }
}
