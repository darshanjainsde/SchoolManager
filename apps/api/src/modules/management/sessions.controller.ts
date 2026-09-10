import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { ApiError } from '../../common/errors/api-error';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { LibraryYearEndService } from '../library';
import { SessionsService } from './sessions.service';
import { CapDueDatesDto, CreateSessionPlanDto, PutDecisionsDto, StartSessionDto, UpdateSessionPlanDto } from './sessions.dto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sessions / year end (Active Roster, Track C). Spec §6. Office only. */
@Controller('manage/sessions')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly library: LibraryYearEndService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  overview() {
    return this.sessions.overview(this.sid());
  }

  @Post('plan')
  createPlan(@CurrentUser() u: SchoolJwtPayload, @Body() dto: CreateSessionPlanDto) {
    return this.sessions.createPlan(this.sid(), u.sub, dto);
  }

  @Get('plan')
  getPlan() {
    return this.sessions.getPlan(this.sid());
  }

  @Patch('plan')
  updatePlan(@Body() dto: UpdateSessionPlanDto) {
    return this.sessions.updatePlan(this.sid(), dto);
  }

  @Post('plan/structure/copy')
  copyStructure() {
    return this.sessions.copyStructure(this.sid());
  }

  /** `sectionId` is a closing-year section id, or `UNPLACED` for children with no class. */
  @Get('plan/students')
  rows(@Query('sectionId') sectionId?: string) {
    if (!sectionId || (sectionId !== 'UNPLACED' && !UUID.test(sectionId))) {
      throw new ApiError('VALIDATION', 'sectionId is required', 400, 'sectionId');
    }
    return this.sessions.sectionRows(this.sid(), sectionId);
  }

  @Put('plan/decisions')
  decisions(@CurrentUser() u: SchoolJwtPayload, @Body() dto: PutDecisionsDto) {
    return this.sessions.upsertDecisions(this.sid(), u.sub, dto);
  }

  /** The master button: every undecided child gets the class map's default (promote, or pass out from the top grade). */
  @Post('plan/decisions/defaults')
  applyDefaults(@CurrentUser() u: SchoolJwtPayload) {
    return this.sessions.applyDefaults(this.sid(), u.sub);
  }

  /** Copy the timetable into the next year now, so the office can adjust it before Start. */
  @Post('plan/timetable/copy')
  copyTimetable(@CurrentUser() u: SchoolJwtPayload) {
    return this.sessions.copyTimetableNow(this.sid(), u.sub);
  }

  // ── The library at the year end (not a condition of Start) ──
  @Get('plan/library')
  async libraryLoans() {
    const plan = await this.sessions.getPlan(this.sid());
    return this.library.openLoans(this.sid(), plan?.fromYear.endDate ?? null);
  }

  @Post('plan/library/remind')
  remindLibrary(@CurrentUser() u: SchoolJwtPayload) {
    return this.library.remindOpenLoans(this.sid(), u.sub);
  }

  @Post('plan/library/last-due')
  capDueDates(@CurrentUser() u: SchoolJwtPayload, @Body() dto: CapDueDatesDto) {
    return this.library.capDueDates(this.sid(), u.sub, dto.lastDueOn);
  }

  @Get('plan/review')
  review() {
    return this.sessions.review(this.sid());
  }

  @Post('plan/start')
  start(@CurrentUser() u: SchoolJwtPayload, @Body() dto: StartSessionDto) {
    return this.sessions.start(this.sid(), u.sub, dto);
  }

  @Post('plan/cancel')
  cancel(@CurrentUser() u: SchoolJwtPayload) {
    return this.sessions.cancel(this.sid(), u.sub);
  }

  @Get(':yearId/register')
  register(@Param('yearId', ParseUUIDPipe) yearId: string) {
    return this.sessions.register(this.sid(), yearId);
  }
}
