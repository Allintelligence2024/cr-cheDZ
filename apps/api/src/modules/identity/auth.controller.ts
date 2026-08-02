import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { Public } from '../../shared/decorators/public.decorator';
import { RateLimit } from '../../shared/decorators/rate-limit.decorator';
import { AuthService, type LoginResult } from './auth.service';
import { AcceptInvitationDto, ChangePasswordDto, LoginDto, ParentOtpRequestDto, ParentOtpVerifyDto, ParentPinDto, ParentPinLoginDto, RefreshDto, TotpDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  async login(@Body() dto: LoginDto, @Req() req: Request): Promise<LoginResult> {
    return this.authService.login(
      dto.email,
      dto.password,
      dto.totp_code,
      dto.device_id,
      req.ip,
      req.headers['user-agent'],
    );
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
    return this.authService.verifyParentOtp(dto.phone, dto.code, { deviceId: dto.device_id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Post('parent/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setParentPin(@Body() dto: ParentPinDto, @CurrentUser() user: CurrentUserPayload): Promise<void> {
    await this.authService.setParentPin(user.sub, dto.pin);
  }

  @Public()
  @Post('parent/pin/login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(5, 60_000)
  async loginParentPin(@Body() dto: ParentPinLoginDto, @Req() req: Request): Promise<LoginResult> {
    return this.authService.loginParentPin(dto.phone, dto.pin, { deviceId: dto.device_id, ipAddress: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit(10, 60_000)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request): Promise<LoginResult> {
    return this.authService.refresh(dto.refresh_token, dto.device_id, req.ip, req.headers['user-agent']);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto, @CurrentUser() user: CurrentUserPayload, @Req() req: Request): Promise<void> {
    await this.authService.logout(dto.refresh_token, user.sub, req.ip, req.headers['user-agent']);
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
  @HttpCode(HttpStatus.OK)
  async enable2fa(@CurrentUser() user: CurrentUserPayload): Promise<{ secret: string; otpauth_url: string }> {
    return this.authService.enableTotp(user.sub);
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  async verify2fa(
    @Body() dto: TotpDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ enabled: boolean }> {
    return this.authService.verifyTotp(user.sub, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(HttpStatus.OK)
  async disable2fa(
    @Body() dto: TotpDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ enabled: boolean }> {
    return this.authService.disableTotp(user.sub, dto.code);
  }
}
