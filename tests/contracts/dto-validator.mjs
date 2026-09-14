import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SyncOperationDto, SyncPushDto, SyncPullQuery } from '../../apps/api/dist/modules/sync/dto/sync.dto.js';
import { RegisterDeviceDto } from '../../apps/api/dist/modules/identity/dto/device.dto.js';
export const dtos = { Operation: SyncOperationDto, PushRequest: SyncPushDto, PullQuery: SyncPullQuery, RegisterRequest: RegisterDeviceDto };
export async function acceptsDto(definition, value) {
  let dto = dtos[definition];
  if (definition === 'Cursor') {
    dto = SyncPullQuery;
    value = { device_id: '11111111-1111-4111-8111-111111111111', cursor: value };
  }
  if (!dto) return undefined;
  const errors = await validate(plainToInstance(dto, structuredClone(value)), { whitelist: true, forbidNonWhitelisted: true });
  return errors.length === 0;
}
