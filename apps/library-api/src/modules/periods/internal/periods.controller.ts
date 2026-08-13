import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { withOrg } from '@library/db';
import { LibJwtGuard, type LibJwtPayload } from '../../auth';
import { RequireFeature, RequireFeatureGuard } from '../../plans';
import { OrgContextService } from '../../tenancy';
import { Roles, RolesGuard } from '../../../common/guards/roles.guard';
import { BranchScopeGuard } from '../../../common/guards/branch-scope.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import {
  CreatePeriodDto, ListPeriodsQueryDto, ListVisitsQueryDto,
  MarkAttendanceDto, OpenVisitDto, UpdateSettingsDto,
} from './dto';
import { PeriodsService } from './periods.service';

/**
 * The library period: the timetable, who is in the room now, and who came.
 *
 * Roles split by consequence. Setting the timetable and changing the room's
 * capacity are configuration — ORG_OWNER/LIBRARIAN. Opening a visit and ticking
 * a child present is counter work, so ASSISTANT can do it. MEMBER is denied
 * throughout: a child has no business reading a class roster.
 */
@Controller('periods')
@UseGuards(LibJwtGuard, RequireFeatureGuard, RolesGuard, BranchScopeGuard)
@RequireFeature('CIRCULATION')
export class PeriodsController {
  constructor(
    @Inject(OrgContextService) private readonly orgs: OrgContextService,
    @Inject(PeriodsService) private readonly periods: PeriodsService,
  ) {}

  @Get('settings')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  getSettings() {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.getSettings(tx, orgId));
  }

  @Patch('settings')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  updateSettings(@Body() dto: UpdateSettingsDto) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.updateSettings(tx, orgId, dto));
  }

  @Get()
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  list(@Query() query: ListPeriodsQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.listPeriods(tx, orgId, query, user.branches));
  }

  @Post()
  @Roles('ORG_OWNER', 'LIBRARIAN')
  create(@Body() dto: CreatePeriodDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.createPeriod(tx, orgId, dto, user.branches));
  }

  @Delete(':id')
  @Roles('ORG_OWNER', 'LIBRARIAN')
  remove(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.removePeriod(tx, orgId, id, user.branches));
  }

  @Get('visits/live')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  live(@CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.liveVisits(tx, orgId, user.branches));
  }

  @Get('visits')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  visits(@Query() query: ListVisitsQueryDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.listVisits(tx, orgId, query, user.branches));
  }

  @Post('visits/open')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  open(@Body() dto: OpenVisitDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.openVisit(tx, orgId, dto, user.branches));
  }

  @Post('visits/:id/close')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  close(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.closeVisit(tx, orgId, id, user.branches));
  }

  @Post('visits/:id/attendance')
  @Roles('ORG_OWNER', 'LIBRARIAN', 'ASSISTANT')
  mark(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: MarkAttendanceDto, @CurrentUser() user: LibJwtPayload) {
    const orgId = this.orgs.requireOrgId();
    return withOrg(orgId, (tx) => this.periods.markAttendance(tx, orgId, id, dto, user.branches));
  }
}
