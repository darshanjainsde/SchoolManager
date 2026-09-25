import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
// OtpModule is @Global at runtime, but a module must import what its members
// inject: a DI-boot spec that mounts AuthModule without the root would
// otherwise fail on OtpService (ledger: di-constructor-seam-kills-bootstrap).
import { OtpModule } from '../../../common/otp/otp.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AcceptInviteController } from './accept-invite.controller';
import { PasswordService } from './password.service';
import { PasswordResetService } from './password-reset.service';
import { SchoolResolveService } from './school-resolve.service';
import { PhoneProfilesService } from './phone-profiles.service';
import { OtpAuthService } from './otp-auth.service';
import { OtpAuthController } from './otp-auth.controller';
import { MeProfileController } from './me-profile.controller';
import { MeProfileService } from './me-profile.service';

@Module({
  imports: [FeaturesModule, OtpModule],
  providers: [AuthService, PasswordService, PasswordResetService, SchoolResolveService, PhoneProfilesService, OtpAuthService, MeProfileService],
  controllers: [AuthController, AcceptInviteController, OtpAuthController, MeProfileController],
  exports: [PasswordService],
})
export class AuthModule {}
