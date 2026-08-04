import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { PublicEventsService } from './public-events.service';
import { RegistrationsService } from './registrations.service';

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [EventsService, PublicEventsService, RegistrationsService],
  controllers: [EventsController],
  exports: [EventsService, PublicEventsService, RegistrationsService],
})
export class CommunityModule {}
