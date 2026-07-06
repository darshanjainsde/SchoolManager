import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { TenantContextService } from '../../tenancy';
import { HallOfFameService } from './hall-of-fame.service';
import { SetHallOfFameDto } from './cms.dto';

@Controller('site/hall-of-fame')
@UseGuards(SchoolJwtGuard)
export class HallOfFameController {
  constructor(
    private readonly hof: HallOfFameService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid() {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list() {
    return this.hof.list(this.sid());
  }

  @Put(':courseId')
  setForCourse(@Param('courseId', ParseUUIDPipe) courseId: string, @Body() dto: SetHallOfFameDto) {
    return this.hof.setForCourse(this.sid(), courseId, dto.entries);
  }
}
