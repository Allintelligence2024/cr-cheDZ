import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload } from '../../shared/decorators/current-user.decorator';
import { RateLimit } from '../../shared/decorators/rate-limit.decorator';
import { DevicesService } from './devices.service';
import { RegisterDeviceDto } from './dto/device.dto';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  @RateLimit(10, 60_000)
  async register(
    @Body() dto: RegisterDeviceDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<{ device_id: string }> {
    const result = await this.devicesService.register(user.sub, {
      name: dto.name,
      deviceFingerprint: dto.device_fingerprint,
      platform: dto.platform,
      appVersion: dto.app_version,
      fcmToken: dto.fcm_token,
    });
    return { device_id: result.id };
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload): Promise<{ items: Array<Record<string, unknown>> }> {
    return { items: await this.devicesService.list(user.sub) };
  }

  @Post(':id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id') id: string,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.devicesService.revoke(id, user.sub);
  }
}
