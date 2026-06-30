import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformAuthController } from './platform-auth.controller';
import { PlatformSchoolsController } from './platform-schools.controller';
import { PlatformHostGuard } from './platform-host.guard';
import { PlatformStatsController } from './platform-stats.controller';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { SchoolsMgmtController } from './schools-mgmt.controller';
import { DomainsController } from './domains.controller';
import { CsvImportController } from './csv-import.controller';
import { PlatformUploadsController } from './platform-uploads.controller';
import { PlatformHelpersController } from './platform-helpers.controller';
import { SettingsService } from './settings.service';
import { PlatformSettingsController } from './settings.controller';
import { PlatformUsageController } from './platform-usage.controller';

@Module({
  imports: [AuthModule], // PasswordService
  providers: [PlatformAuthService, PlatformHostGuard, OnboardingService, SettingsService],
  controllers: [
    PlatformAuthController,
    PlatformStatsController,
    OnboardingController,
    PlatformSchoolsController,
    SchoolsMgmtController,
    DomainsController,
    CsvImportController,
    PlatformUploadsController,
    PlatformHelpersController,
    PlatformSettingsController,
    PlatformUsageController,
  ],
  exports: [SettingsService],
})
export class PlatformModule {}
