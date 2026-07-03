import { Controller, Get, UseGuards } from '@nestjs/common';
import { PlatformJwtGuard } from '../../../common/auth/platform-jwt.guard';
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
}
