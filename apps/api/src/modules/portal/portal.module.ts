import { Module } from '@nestjs/common';
import { TenancyModule } from '../tenancy';
import { ManagementModule } from '../management';
import { PortalService } from './portal.service';
import { PortalController } from './portal.controller';

@Module({
  imports: [TenancyModule, ManagementModule],
  providers: [PortalService],
  controllers: [PortalController],
})
export class PortalModule {}
