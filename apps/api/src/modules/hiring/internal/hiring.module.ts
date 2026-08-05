import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
import { TenancyModule } from '../../tenancy';
import { JobsService } from './jobs.service';
import { ManageJobsController, PublicJobsController } from './jobs.controller';

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [JobsService],
  controllers: [ManageJobsController, PublicJobsController],
  exports: [JobsService],
})
export class HiringModule {}
