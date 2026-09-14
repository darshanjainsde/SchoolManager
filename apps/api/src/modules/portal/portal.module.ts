import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy';
import { ManagementModule } from '../management';
import { CommunityModule } from '../community';
import { FeaturesModule } from '../features';
import { PublicModule } from '../public';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';

@Module({
  imports: [TenancyModule, ManagementModule, CommunityModule, FeaturesModule, PublicModule],
  providers: [PortalService],
  controllers: [PortalController],
})
export class PortalModule {}
