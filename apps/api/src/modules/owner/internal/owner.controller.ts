import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
import { CreateSchoolDto, SetFeatureDto, SetTierDto } from './owner.dto';
import { OwnerHostGuard } from './owner-host.guard';
import { OwnerSchoolsService } from './owner-schools.service';

@Controller('owner')
@UseGuards(OwnerHostGuard, PlatformJwtGuard)
export class OwnerController {
  constructor(private readonly schools: OwnerSchoolsService) {}

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
}
