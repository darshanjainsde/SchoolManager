import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
import { TenancyModule } from '../../tenancy';
import { AlumniService } from './alumni.service';
import { GiftsService } from './gifts.service';
import { GuestSessionsService } from './guest-sessions.service';
import { AlumniController } from './alumni.controller';

@Module({
  imports: [FeaturesModule, TenancyModule],
  providers: [AlumniService, GiftsService, GuestSessionsService],
  controllers: [AlumniController],
  exports: [AlumniService, GiftsService, GuestSessionsService],
})
export class AlumniModule {}
