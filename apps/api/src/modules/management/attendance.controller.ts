import { Body, Controller, Get, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { AttendanceService } from './attendance.service';
import { SaveAttendanceDto } from './management.dto';

@Controller('manage/attendance')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Query('date') date: string,
  ) {
    return this.attendance.list(this.sid(), classSectionId, date);
  }

  @Put()
  save(@Body() dto: SaveAttendanceDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.attendance.save(this.sid(), u.sub, dto);
  }
}
