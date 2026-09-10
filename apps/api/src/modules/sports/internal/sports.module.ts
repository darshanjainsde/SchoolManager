import { Module } from '@nestjs/common';
import { FeaturesModule } from '../../features';
import { TenancyModule } from '../../tenancy';
import { SportsCoachesService } from './sports-coaches.service';
import { SportsDeskGuard } from './sports-desk.guard';
import { SportsHousesService } from './sports-houses.service';
import { SportsMeService } from './sports-me.service';
import { SportsRecordsService } from './sports-records.service';
import { SportsResultsService } from './sports-results.service';
import { SportsSettingsService } from './sports-settings.service';
import { SportsTournamentsService } from './sports-tournaments.service';
import { SportsAdminController, SportsController, SportsMeController } from './sports.controller';

/**
 * The Sports wing (docs/superpowers/specs/2026-09-10-sports-wing-design.md):
 * one desk for the sports teacher (/sports) and the admin (/app/sports);
 * students read their own tab at /me/sports. Fully encapsulated — siblings
 * import nothing from here except `SportsModule` via ../index.ts.
 */
@Module({
  imports: [FeaturesModule, TenancyModule],
  controllers: [SportsController, SportsAdminController, SportsMeController],
  providers: [SportsDeskGuard, SportsSettingsService, SportsHousesService, SportsTournamentsService, SportsResultsService, SportsRecordsService, SportsCoachesService, SportsMeService],
})
export class SportsModule {}
