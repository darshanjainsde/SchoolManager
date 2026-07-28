import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../../auth';
import { FeaturesModule } from '../../features';
import { MarketingModule } from '../../marketing';
import { OwnerAuthService } from './owner-auth.service';
import { OwnerAuthController } from './owner-auth.controller';
import { ImpersonationService } from './impersonation.service';
import { OwnerEventsService } from './owner-events.service';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { OwnerOverviewService } from './owner-overview.service';
import { OwnerSchoolsService } from './owner-schools.service';
import { OwnerController } from './owner.controller';

@Module({
  imports: [JwtModule.register({}), AuthModule, FeaturesModule, MarketingModule],
  controllers: [OwnerAuthController, OwnerController],
  providers: [OwnerAuthService, OwnerHostGuard, OwnerSchoolsService, OwnerEventsService, ImpersonationService, OwnerOverviewService],
})
export class OwnerModule {}
