import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import type { PlatformJwtPayload } from '../../../common/auth/jwt-payload';
import { CreateSchoolDto, ModerateEventDto, OwnerCreateEventDto, SetFeatureDto, SetStatusDto, SetTierDto } from './owner.dto';
import { OwnerHostGuard } from './owner-host.guard';
import { OwnerEventsService } from './owner-events.service';
import { OwnerSchoolsService } from './owner-schools.service';

@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OwnerController {
  constructor(
    private readonly schools: OwnerSchoolsService,
    private readonly ownerEvents: OwnerEventsService,
  ) {}

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
