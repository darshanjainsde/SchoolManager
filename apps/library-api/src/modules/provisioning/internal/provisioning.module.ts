import { Module } from '@nestjs/common';
import { ProvisioningController } from './provisioning.controller';
import { ProvisioningService } from './provisioning.service';

/**
 * No TenancyModule import, unlike every feature module: these routes act across
 * orgs rather than within one, so there is no host to resolve and no
 * `app.current_org` to set.
 */
@Module({
  controllers: [ProvisioningController],
  providers: [ProvisioningService],
  exports: [ProvisioningService],
})
export class ProvisioningModule {}
