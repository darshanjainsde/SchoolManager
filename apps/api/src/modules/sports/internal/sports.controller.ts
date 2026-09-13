import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { SportsPerm as Perm } from '@skoolos/types';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../../features';
import { TenantContextService } from '../../tenancy';
import { SportsCoachesService } from './sports-coaches.service';
import { SportsDeskGuard } from './sports-desk.guard';
import { SportsHousesService } from './sports-houses.service';
import { SportsMeService } from './sports-me.service';
import { DeskPerms, SportsPerm } from './sports-perm.decorator';
import { SportsRecordsService } from './sports-records.service';
import { SportsResultsService } from './sports-results.service';
import { SportsSettingsService } from './sports-settings.service';
import { SportsTournamentsService } from './sports-tournaments.service';
import {
  AddRecordDto, AddVenueDto, AssignHouseDto, AwardPointsDto, CreateHouseDto, CreateTournamentDto, DecideAttemptDto, MarksDto, MoveSlotDto, PinEventDto, ScoreDto, SetCoachPermsDto, ShiftDto,
  SubmitAttemptDto, UpdateHouseDto, UpdateSportsSettingsDto, UpdateTournamentDto, VoidRecordDto,
} from './sports.dto';

/**
 * The sports desk API — the same routes for the sports teacher (/sports) and
 * the admin (/app/sports). `RolesGuard` narrows to STAFF | SCHOOL_ADMIN;
 * `SportsDeskGuard` narrows STAFF to the SPORTS job and checks the route's
 * `@SportsPerm` against the teacher's list. The admin holds every permission.
 */
@Controller('sports')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard, SportsDeskGuard)
@RequireFeature('SPORTS')
@Roles('STAFF', 'SCHOOL_ADMIN')
export class SportsController {
  constructor(
    private readonly settings: SportsSettingsService,
    private readonly houses: SportsHousesService,
    private readonly tournaments: SportsTournamentsService,
    private readonly results: SportsResultsService,
    private readonly records: SportsRecordsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  /** What this desk may do — the shell shows only those buttons. */
  @Get('me')
  me(@DeskPerms() perms: Perm[], @CurrentUser() u: SchoolJwtPayload) {
    return { perms, isAdmin: u.role === 'SCHOOL_ADMIN' };
  }

  // ── settings ──
  @Get('settings')
  settingsGet() { return this.settings.get(this.sid()); }

  @Patch('settings')
  @SportsPerm('SETTINGS')
  settingsUpdate(@Body() dto: UpdateSportsSettingsDto) { return this.settings.update(this.sid(), dto); }

  // ── houses ──
  @Get('houses')
  housesList() { return this.houses.list(this.sid()); }

  @Post('houses')
  @SportsPerm('HOUSES')
  houseCreate(@Body() dto: CreateHouseDto) { return this.houses.create(this.sid(), dto); }

  @Patch('houses/:id')
  @SportsPerm('HOUSES')
  houseUpdate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateHouseDto) { return this.houses.update(this.sid(), id, dto); }

  @Delete('houses/:id')
  @SportsPerm('HOUSES')
  houseRemove(@Param('id', ParseUUIDPipe) id: string) { return this.houses.remove(this.sid(), id); }

  @Get('houses/ledger')
  ledger(@Query('houseId') houseId?: string) { return this.houses.ledger(this.sid(), houseId || undefined); }

  @Get('houses/:id/members')
  members(@Param('id', ParseUUIDPipe) id: string) { return this.houses.members(this.sid(), id); }

  @Post('houses/assign')
  @SportsPerm('HOUSES')
  assign(@Body() dto: AssignHouseDto) { return this.houses.assign(this.sid(), dto); }

  @Post('houses/:id/points')
  @SportsPerm('HOUSES')
  award(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AwardPointsDto) { return this.houses.award(this.sid(), id, dto); }

  // ── tournaments ──
  @Get('roster')
  roster() { return this.tournaments.roster(this.sid()); }

  @Get('tournaments')
  list() { return this.tournaments.list(this.sid()); }

  @Post('tournaments')
  @SportsPerm('CREATE')
  create(@CurrentUser() u: SchoolJwtPayload, @Body() dto: CreateTournamentDto) { return this.tournaments.create(this.sid(), u.sub, dto); }

  @Get('tournaments/:id')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.tournaments.get(this.sid(), id); }

  @Delete('tournaments/:id')
  @SportsPerm('CREATE')
  remove(@Param('id', ParseUUIDPipe) id: string) { return this.tournaments.remove(this.sid(), id); }

  @Post('tournaments/:id/publish')
  @SportsPerm('PUBLISH')
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) { return this.tournaments.publish(this.sid(), id, u.role === 'SCHOOL_ADMIN'); }

  @Post('tournaments/:id/finish')
  @SportsPerm('CREATE')
  finish(@Param('id', ParseUUIDPipe) id: string) { return this.tournaments.finish(this.sid(), id); }

  /** Grow the meet: more days, different hours, a longer rest between a child's slots. */
  @Patch('tournaments/:id')
  @SportsPerm('CREATE')
  updateTournament(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTournamentDto) { return this.tournaments.update(this.sid(), id, dto); }

  @Post('tournaments/:id/venues')
  @SportsPerm('CREATE')
  addVenue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddVenueDto) { return this.tournaments.addVenue(this.sid(), id, dto); }

  @Delete('tournaments/:id/venues/:venueId')
  @SportsPerm('CREATE')
  removeVenue(@Param('id', ParseUUIDPipe) id: string, @Param('venueId', ParseUUIDPipe) venueId: string) { return this.tournaments.removeVenue(this.sid(), id, venueId); }

  /** Hold an event to one day of the meet (or free it with null), then re-lay the plan. */
  @Patch('tournaments/:id/events/:eventId/day')
  @SportsPerm('CREATE')
  pinEvent(@Param('id', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string, @Body() dto: PinEventDto) { return this.tournaments.pinEvent(this.sid(), id, eventId, dto); }

  /** Lay every unplayed slot out again on the days and venues the meet has now. */
  @Post('tournaments/:id/refit')
  @SportsPerm('CREATE')
  refit(@Param('id', ParseUUIDPipe) id: string) { return this.tournaments.refit(this.sid(), id); }

  @Post('tournaments/:id/shift')
  @SportsPerm('CREATE')
  shift(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ShiftDto) { return this.tournaments.shift(this.sid(), id, dto); }

  @Patch('tournaments/:id/matches/:matchId/slot')
  @SportsPerm('CREATE')
  moveMatch(@Param('id', ParseUUIDPipe) id: string, @Param('matchId', ParseUUIDPipe) matchId: string, @Body() dto: MoveSlotDto) { return this.tournaments.move(this.sid(), id, 'match', matchId, dto); }

  @Patch('tournaments/:id/heats/:heatId/slot')
  @SportsPerm('CREATE')
  moveHeat(@Param('id', ParseUUIDPipe) id: string, @Param('heatId', ParseUUIDPipe) heatId: string, @Body() dto: MoveSlotDto) { return this.tournaments.move(this.sid(), id, 'heat', heatId, dto); }

  // ── results ──
  @Post('matches/:id/score')
  @SportsPerm('ENTER')
  score(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload, @Body() dto: ScoreDto) { return this.results.score(this.sid(), u.sub, id, dto); }

  @Post('heats/:id/marks')
  @SportsPerm('ENTER')
  marks(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload, @Body() dto: MarksDto) { return this.results.marks(this.sid(), u.sub, id, dto); }

  // ── records ──
  @Get('records')
  recordsList() { return this.records.list(this.sid()); }

  @Get('records/history')
  history(@Query('sportKey') sportKey: string, @Query('groupKey') groupKey: string, @Query('category') category: string) {
    return this.records.history(this.sid(), sportKey ?? '', groupKey ?? '', category ?? '');
  }

  @Get('records/attempts')
  @SportsPerm('VERIFY')
  attempts() { return this.records.attempts(this.sid()); }

  @Post('records/attempts')
  @SportsPerm('ENTER')
  submit(@CurrentUser() u: SchoolJwtPayload, @Body() dto: SubmitAttemptDto) { return this.records.submit(this.sid(), u.sub, dto); }

  @Post('records/attempts/:id/decide')
  @SportsPerm('VERIFY')
  decide(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload, @Body() dto: DecideAttemptDto) { return this.records.decide(this.sid(), u.sub, id, dto); }

  @Post('records')
  @SportsPerm('VERIFY')
  addRecord(@CurrentUser() u: SchoolJwtPayload, @Body() dto: AddRecordDto) { return this.records.add(this.sid(), u.sub, dto); }

  @Post('records/:id/void')
  @SportsPerm('VERIFY')
  voidRecord(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload, @Body() dto: VoidRecordDto) { return this.records.void(this.sid(), u.sub, id, dto.note); }
}

/** Admin → Sports → Teachers: who runs the desk and with which rights. Admin only. */
@Controller('sports/admin')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('SPORTS')
@Roles('SCHOOL_ADMIN')
export class SportsAdminController {
  constructor(private readonly coaches: SportsCoachesService, private readonly tenant: TenantContextService) {}

  @Get('coaches')
  list() { return this.coaches.list(this.tenant.requireTenant().schoolId); }

  @Patch('coaches/:staffId')
  setPerms(@Param('staffId', ParseUUIDPipe) staffId: string, @Body() dto: SetCoachPermsDto) { return this.coaches.setPerms(this.tenant.requireTenant().schoolId, staffId, dto.sportsPerms); }
}

/** The child's own tab — students and teachers, never the desk. */
@Controller('me/sports')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('SPORTS')
@Roles('STUDENT', 'TEACHER')
export class SportsMeController {
  constructor(private readonly me: SportsMeService, private readonly tenant: TenantContextService) {}

  @Get()
  mine(@CurrentUser() u: SchoolJwtPayload) { return this.me.forUser(this.tenant.requireTenant().schoolId, u.sub, u.role); }
}
