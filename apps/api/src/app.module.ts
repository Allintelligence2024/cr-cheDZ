import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DatabaseModule } from './shared/database/database.module';
import { HttpExceptionFilter } from './shared/filters/http-exception.filter';
import { JwtAuthGuard } from './shared/guards/jwt-auth.guard';
import { RateLimitGuard } from './shared/guards/rate-limit.guard';
import { RateLimitService } from './shared/guards/rate-limit.service';
import { RolesGuard } from './shared/guards/roles.guard';
import { HealthController } from './health.controller';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { ChildrenModule } from './modules/children/children.module';
import { IdentityModule } from './modules/identity/identity.module';
import { JournalModule } from './modules/journal/journal.module';
import { MediaModule } from './modules/media/media.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { StaffModule } from './modules/staff/staff.module';
import { SyncModule } from './modules/sync/sync.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    PrivacyModule,
    IdentityModule,
    UsersModule,
    OrganizationsModule,
    StaffModule,
    ChildrenModule,
    AttendanceModule,
    JournalModule,
    MediaModule,
    NotificationsModule,
    SyncModule,
  ],
  controllers: [HealthController],
  providers: [
    RateLimitService,
    // Ordre des guards : JWT → rôles → rate limit
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
