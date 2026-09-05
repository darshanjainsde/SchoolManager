import { Module } from '@nestjs/common';
import { HiringModule } from '../../hiring';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../../auth';
import { FeaturesModule } from '../../features';
import { MarketingModule } from '../../marketing';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerAuthController } from './owner-auth.controller';
import { ImpersonationService } from './impersonation.service';
import { OwnerEventsService } from './owner-events.service';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { OpsService } from './ops.service';
import { OwnerOverviewService } from './owner-overview.service';
import { OwnerSchoolsService } from './owner-schools.service';
import { OwnerDomainsService } from './owner-domains.service';
import { HostingProviderService } from './hosting-provider.service';
import { OwnerCacheInterceptor } from './owner-cache.interceptor';
import { SpeedService } from './speed.service';
import { OwnerController } from './owner.controller';

@Module({
  imports: [JwtModule.register({}), AuthModule, FeaturesModule, MarketingModule, HiringModule],
  controllers: [OwnerAuthController, OwnerController],
  providers: [OpsService, OwnerAuthService, OwnerHostGuard, OwnerSchoolsService, OwnerDomainsService, HostingProviderService, OwnerCacheInterceptor, SpeedService, OwnerEventsService, ImpersonationService, OwnerOverviewService],
})
export class OwnerModule {}
