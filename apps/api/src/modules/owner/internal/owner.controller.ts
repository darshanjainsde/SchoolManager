import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { OpsService } from './ops.service';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';
import { MarketingService, SetLeadStatusDto, UpdateMarketingConfigDto } from '../../marketing';
import { JobsService } from '../../hiring';
import { ModerateJobDto } from './owner.dto';
import { CreateSchoolDto, ModerateEventDto, OwnerCreateEventDto, SetFeatureDto, SetStatusDto, SetTierDto } from './owner.dto';
import { ImpersonationService } from './impersonation.service';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { OwnerEventsService } from './owner-events.service';
import { OwnerOverviewService } from './owner-overview.service';
import { OwnerSchoolsService } from './owner-schools.service';
import { OwnerDomainsService } from './owner-domains.service';
import { AddDomainDto } from './owner.dto';

@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OwnerController {
  constructor(
    private readonly schools: OwnerSchoolsService,
    private readonly ownerEvents: OwnerEventsService,
    private readonly impersonation: ImpersonationService,
    private readonly overviewSvc: OwnerOverviewService,
    private readonly marketing: MarketingService,
    private readonly jobs: JobsService,
    private readonly domains: OwnerDomainsService,
    private readonly opsService: OpsService,
  ) {}

  @Get('overview')
  overview() {
    return this.overviewSvc.overview();
  }

  @Get('leads')
  listLeads(@Query('status') status?: 'NEW' | 'CONTACTED' | 'CLOSED') {
    return this.marketing.listLeads(status);
  }

  @Patch('leads/:id')
  setLeadStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLeadStatusDto) {
    return this.marketing.setLeadStatus(id, dto.status);
  }

  @Get('marketing-config')
  marketingConfig() {
    return this.marketing.getConfigRow();
  }

  @Put('marketing-config')
  updateMarketingConfig(@Body() dto: UpdateMarketingConfigDto) {
    return this.marketing.updateConfig(dto);
  }

  @Get('schools/:id/enquiries.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async enquiriesCsv(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { filename, body } = await this.overviewSvc.enquiriesCsv(id);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(body);
  }

  /** Runtime health: which rung of the scaling ladder we are on. */
  @Get('ops')
  ops() {
    return this.opsService.snapshot();
  }

  @Get('stats')
  stats() {
    return this.schools.stats();
  }

  @Get('schools')
  listSchools() {
    return this.schools.list();
  }

  @Get('schools/:id')
  schoolDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.detail(id);
  }

  @Post('schools')
  createSchool(@Body() dto: CreateSchoolDto) {
    return this.schools.create(dto);
  }

  @Patch('schools/:id/tier')
  setTier(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetTierDto) {
    return this.schools.setTier(id, dto.tier);
  }

  @Patch('schools/:id/features')
  setFeature(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeatureDto) {
    return this.schools.setFeature(id, dto.featureKey, dto.enabled);
  }

  @Patch('schools/:id/status')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetStatusDto) {
    return this.schools.setStatus(id, dto.status);
  }

  @Delete('schools/:id')
  deleteSchool(@Param('id', ParseUUIDPipe) id: string) {
    return this.schools.deleteSchool(id);
  }

  @Post('schools/:id/impersonate')
  impersonate(@Param('id', ParseUUIDPipe) id: string) {
    return this.impersonation.mint(id);
  }

  // ── Custom domains ──────────────────────────────────────
  // Putting a school on its own address. The verify step reads real DNS, so a
  // domain only goes LIVE once it actually points here.

  @Get('schools/:id/domains')
  listDomains(@Param('id', ParseUUIDPipe) id: string) {
    return this.domains.list(id);
  }

  @Post('schools/:id/domains')
  addDomain(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddDomainDto) {
    return this.domains.add(id, dto.hostname);
  }

  @Post('schools/:id/domains/:domainId/verify')
  verifyDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.domains.verify(id, domainId);
  }

  @Post('schools/:id/domains/:domainId/primary')
  setPrimaryDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.domains.setPrimary(id, domainId);
  }

  @Delete('schools/:id/domains/:domainId')
  removeDomain(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('domainId', ParseUUIDPipe) domainId: string,
  ) {
    return this.domains.remove(id, domainId);
  }

  @Get('events')
  listEvents(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.ownerEvents.listNetwork(status);
  }

  /**
   * The vacancy queue. The SAME desk as network events, deliberately — §6 of
   * the Phase 6 plan: a second moderation queue is how one of them stops being
   * read.
   *
   * The owner moderates VACANCIES and never sees an application. There is no
   * endpoint here that returns a candidate, and JobApplication carries no
   * owner read policy.
   */
  @Get('jobs')
  listJobs(@Query('status') status?: string) {
    return this.jobs.ownerList(status);
  }

  @Patch('jobs/:id')
  moderateJob(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateJobDto) {
    return this.jobs.moderate(id, dto);
  }

  @Patch('events/:id')
  moderate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ModerateEventDto,
    @CurrentUser() user: PlatformJwtPayload,
  ) {
    return this.ownerEvents.moderate(id, dto, user.sub);
  }

  @Post('events')
  createEvent(@Body() dto: OwnerCreateEventDto, @CurrentUser() user: PlatformJwtPayload) {
    return this.ownerEvents.createNetwork(dto, user.sub);
  }
}
