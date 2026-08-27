import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { HallOfFameService } from './hall-of-fame.service';
import { SetHallOfFameDto } from './cms.dto';

@Controller('site/hall-of-fame')
// SchoolJwtGuard establishes WHICH school you belong to; it reads no role at
// all. Without RolesGuard beside it every route here was reachable with a
// STUDENT or PARENT token — and the enquiries ones hand back other families'
// names and phone numbers. Every caller lives under /app, which is already
// SCHOOL_ADMIN-only, so this locks out nobody who was legitimately using it.
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
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
