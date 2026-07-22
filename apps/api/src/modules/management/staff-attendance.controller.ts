import { Body, Controller, Get, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { StaffAttendanceService } from './staff-attendance.service';
import { SaveStaffAttendanceDto } from './management.dto';

@Controller('manage/staff-attendance')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class StaffAttendanceController {
  constructor(
    private readonly staffAttendance: StaffAttendanceService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  list(@Query('date') date: string) {
    return this.staffAttendance.list(this.sid(), date);
  }

  @Put()
  save(@Body() dto: SaveStaffAttendanceDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.staffAttendance.save(this.sid(), u.sub, dto);
  }

  /**
   * A literal `person` segment, not a `:id` param, so this never competes
   * with `@Get()` above for route matching regardless of declaration order.
   */
  @Get('person')
  person(
    @Query('kind') kind: string,
    @Query('id', ParseUUIDPipe) id: string,
    @Query('month') month: string,
  ) {
    return this.staffAttendance.person(this.sid(), kind, id, month);
  }
}
