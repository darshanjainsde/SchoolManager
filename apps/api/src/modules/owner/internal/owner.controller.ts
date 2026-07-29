import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';
import { MarketingService, SetLeadStatusDto, UpdateMarketingConfigDto } from '../../marketing';
import { CreateSchoolDto, ModerateEventDto, OwnerCreateEventDto, SetFeatureDto, SetStatusDto, SetTierDto } from './owner.dto';
import { ImpersonationService } from './impersonation.service';
import { OwnerHostGuard } from '../../../common/auth/owner-host.guard';
import { OwnerEventsService } from './owner-events.service';
import { OwnerOverviewService } from './owner-overview.service';
import { OwnerSchoolsService } from './owner-schools.service';

@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OwnerController {
  constructor(
    private readonly schools: OwnerSchoolsService,
    private readonly ownerEvents: OwnerEventsService,
    private readonly impersonation: ImpersonationService,
    private readonly overviewSvc: OwnerOverviewService,
    private readonly marketing: MarketingService,
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

  @Get('events')
  listEvents(@Query('status') status?: 'PENDING' | 'APPROVED' | 'REJECTED') {
    return this.ownerEvents.listNetwork(status);
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
