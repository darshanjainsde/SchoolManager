import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth';
import { FeaturesModule } from '../../features';
import { TenancyModule } from '../../tenancy';
import { AlumniService } from './alumni.service';
import { GiftsService } from './gifts.service';
import { GuestSessionsService } from './guest-sessions.service';
import { AlumniAuthService } from './alumni-auth.service';
import { AlumniPortalService } from './alumni-portal.service';
import { AlumniSessionGuard } from './alumni-session.guard';
import { AlumniController } from './alumni.controller';
import {
  AlumniPortalController,
  PublicAlumniController,
  TrustedAlumnusController,
} from './alumni-portal.controller';

@Module({
  // AuthModule provides PasswordService — the alumni account door hashes and
  // verifies with exactly the same argon2id settings every other login uses.
  imports: [AuthModule, FeaturesModule, TenancyModule],
  providers: [
    AlumniService,
    GiftsService,
    GuestSessionsService,
    AlumniAuthService,
    AlumniPortalService,
    // Registered as a provider so Nest can construct it for @UseGuards.
    AlumniSessionGuard,
  ],
  controllers: [
    AlumniController,
    PublicAlumniController,
    AlumniPortalController,
    TrustedAlumnusController,
  ],
  exports: [AlumniService, GiftsService, GuestSessionsService, AlumniAuthService],
})
export class AlumniModule {}
