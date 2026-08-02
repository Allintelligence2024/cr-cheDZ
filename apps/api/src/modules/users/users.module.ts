import { Module } from '@nestjs/common';
import { PrivacyModule } from '../privacy/privacy.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [PrivacyModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
