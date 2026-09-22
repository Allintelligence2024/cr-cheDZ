import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { RateLimit } from '../../shared/decorators/rate-limit.decorator';
import { AuthService, type LoginResult } from './auth.service';
import { AcceptInvitationDto, ChangePasswordDto, LoginDto, ParentOtpRequestDto, ParentOtpVerifyDto, ParentPinDto, ParentPinLoginDto, RefreshDto, TotpDto } from './dto/auth.dto';
import { setRefreshCookie, readRefreshCookie, clearRefreshCookie } from '../../shared/auth/auth-cookies';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<LoginResult> {
    const result = await this.authService.login(
      dto.email,
      dto.password,
      dto.totp_code,
      dto.device_id,
      req.ip,
      req.headers['user-agent'],
    );
    // R14 : si le client est un navigateur (web_client=true), on pose
    // le refresh token dans un cookie httpOnly. Le body reste identique
    // pour rétro-compat (les SPA qui n'ont pas migré continuent de
    // fonctionner). Les deux canaux sont indépendants.
    if (dto.web_client === true) {
      setRefreshCookie(res, result.refresh_token);
    }
    return result;
  }

  @Public()
  @Post('parent/otp/request')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 60_000)
  async requestParentOtp(@Body() dto: ParentOtpRequestDto): Promise<{ expires_in: number; channel: 'sms' | 'whatsapp'; development_code?: string }> {
    return this.authService.requestParentOtp(dto.phone, dto.channel ?? 'sms');
  }

  @Public()
  @Post('parent/otp/verify')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  async verifyParentOtp(@Body() dto: ParentOtpVerifyDto, @Req() req: Request): Promise<LoginResult> {
    return this.authService.verifyParentOtp(dto.phone, dto.code, { deviceId: dto.device_id, ipAddress: req.ip, userAgent: req.headers['user-agent'] }, dto.totp_code);
  }

  @Post('parent/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setParentPin(@Body() dto: ParentPinDto, @CurrentUser() user: CurrentUserPayload): Promise<void> {
    await this.authService.setParentPin(user.sub, dto.pin, dto.totp_code);
  }

  @Public()
  @Post('parent/pin/login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 60_000)
  async loginParentPin(@Body() dto: ParentPinLoginDto, @Req() req: Request): Promise<LoginResult> {
    return this.authService.loginParentPin(dto.phone, dto.pin, { deviceId: dto.device_id, ipAddress: req.ip, userAgent: req.headers['user-agent'] }, dto.totp_code);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    // R14 : si le client web n'envoie pas de refresh_token dans le body,
    // on lit le cookie httpOnly positionné par /login. Cookie préempté
    // sur le body quand les deux sont présents (le cookie est plus
    // récent après un refresh réussi : rotation).
    const refreshToken = dto.refresh_token || readRefreshCookie(req.cookies as Record<string, string | undefined> | undefined);
    if (!refreshToken) {
      // Pas de refresh token du tout → on n'invalide pas la session
      // existante (un mobile qui n'a pas de cookie OK), on renvoie juste
      // un refresh impossible. Le client reçoit un 401 et redirige.
      const { Errors } = await import('../../shared/errors');
      throw Errors.unauthorized();
    }
    const result = await this.authService.refresh(refreshToken, dto.device_id, req.ip, req.headers['user-agent']);
    // R14 : le web_client reçoit un nouveau cookie avec le refresh tourné.
    // On ne sait pas ici si l'appel vient d'un web_client — on repose le
    // cookie systématiquement si un cookie était présent à l'entrée (le
    // client web a déjà son cookie de login ; un client qui n'utilise pas
    // le cookie n'en avait pas et n'en reçoit pas).
    if (readRefreshCookie(req.cookies as Record<string, string | undefined> | undefined)) {
      setRefreshCookie(res, result.refresh_token);
    }
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body() dto: RefreshDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const refreshToken = dto.refresh_token || readRefreshCookie(req.cookies as Record<string, string | undefined> | undefined);
    if (refreshToken) {
      await this.authService.logout(refreshToken, user.sub, req.ip, req.headers['user-agent']);
    }
    // R14 : efface le cookie httpOnly quoi qu'il arrive (pas de fuite
    // même si le client n'en avait pas). Idempotent.
    clearRefreshCookie(res);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: CurrentUserPayload,
    @Req() req: Request,
  ): Promise<void> {
    await this.authService.changePassword(user.sub, dto.old_password, dto.new_password, req.ip);
  }

  /** Accepte une invitation (lien signé reçu par email) et ouvre une session. */
  @Public()
  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 60_000)
  async acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() req: Request): Promise<LoginResult> {
    return this.authService.acceptInvitation(
      dto.invitation_token,
      { firstName: dto.first_name, lastName: dto.last_name, password: dto.password },
      { deviceId: dto.device_id, ipAddress: req.ip, userAgent: req.headers['user-agent'] },
    );
  }

  @Post('2fa/enable')
  @RateLimit(5, 60_000)
  @HttpCode(HttpStatus.OK)
  async enable2fa(@CurrentUser() user: CurrentUserPayload): Promise<{ secret: string; otpauth_url: string }> {
    return this.authService.enableTotp(user.sub);
  }

  @Post('2fa/verify')
  @RateLimit(5, 60_000)
  @HttpCode(HttpStatus.OK)
  async verify2fa(
    @Body() dto: TotpDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ enabled: boolean }> {
    return this.authService.verifyTotp(user.sub, dto.code);
  }

  @Post('2fa/disable')
  @RateLimit(5, 60_000)
  @HttpCode(HttpStatus.OK)
  async disable2fa(
    @Body() dto: TotpDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ enabled: boolean }> {
    return this.authService.disableTotp(user.sub, dto.code);
  }
}
