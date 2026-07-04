import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [EventsService],
  controllers: [EventsController],
  exports: [EventsService],
})
export class CommunityModule {}
