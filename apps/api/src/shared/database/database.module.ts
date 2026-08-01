import { Global, Module } from '@nestjs/common';
import { databaseProvider, PG_POOL } from './database.provider';
import { TenantContextService } from './tenant-context.service';

@Global()
@Module({
  providers: [databaseProvider, TenantContextService],
  exports: [PG_POOL, TenantContextService],
})
export class DatabaseModule {}
