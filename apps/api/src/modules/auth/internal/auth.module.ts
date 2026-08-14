import { Module } from '@nestjs/common';
import { LibraryModule } from '../../library';
import { FeaturesModule } from '../../features';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AcceptInviteController } from './accept-invite.controller';
import { PasswordService } from './password.service';
import { PasswordResetService } from './password-reset.service';
import { SchoolResolveService } from './school-resolve.service';

@Module({
  imports: [FeaturesModule, LibraryModule],
  providers: [AuthService, PasswordService, PasswordResetService, SchoolResolveService],
  controllers: [AuthController, AcceptInviteController],
  exports: [PasswordService],
})
export class AuthModule {}
