import { Module } from '@nestjs/common';
import { FeaturesModule } from '../features';
import { TenancyModule } from '../tenancy';
import { EventsService } from './events.service';
import { EventsController } from './events.controller';
import { PublicEventsService } from './public-events.service';
import { RegistrationsService } from './registrations.service';
import { PublicRegistrationController } from './public-registration.controller';

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [EventsService, PublicEventsService, RegistrationsService],
  controllers: [EventsController, PublicRegistrationController],
  exports: [EventsService, PublicEventsService, RegistrationsService],
})
export class CommunityModule {}
