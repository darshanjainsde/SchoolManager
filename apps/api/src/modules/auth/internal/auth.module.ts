import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AcceptInviteController } from './accept-invite.controller';
import { PasswordService } from './password.service';

@Module({
  imports: [FeaturesModule],
  providers: [AuthService, PasswordService],
  controllers: [AuthController, AcceptInviteController],
  exports: [PasswordService],
})
export class AuthModule {}
