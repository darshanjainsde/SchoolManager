import { Body, Controller, Get, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { AttendanceBarService } from './attendance-bar.service';
import { AttendanceService } from './attendance.service';
import { NotifyLowAttendanceDto, SaveAttendanceDto } from './management.dto';

@Controller('manage/attendance')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
export class AttendanceController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly bar: AttendanceBarService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // Static paths declared ABOVE the `@Get()` below so they match before it
  // (Nest resolves routes in declaration order; `@Get()` would otherwise
  // shadow `/my-classes` and `/status` as an empty `classSectionId` query).

  @Get('my-classes')
  myClasses(@CurrentUser() u: SchoolJwtPayload) {
    return this.attendance.myClassSections(this.sid(), u.sub, u.role);
  }

  @Get('status')
  status(@CurrentUser() u: SchoolJwtPayload, @Query('date') date: string) {
    return this.attendance.dayStatus(this.sid(), u.sub, u.role, date);
  }

  /** The attendance bar (Phase 5·3): every child's percentage over a window,
   *  lowest first — declared above `@Get()` for the same route-order reason. */
  @Get('rates')
  rates(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @CurrentUser() u: SchoolJwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.bar.rates(this.sid(), classSectionId, u.sub, u.role, { from, to });
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
    return this.attendance.save(this.sid(), u.sub, dto, u.role);
  }

  /** One tap: privately tell the families below the benchmark (Phase 5·3). */
  @Post('notify-low')
  notifyLow(@Body() dto: NotifyLowAttendanceDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.bar.notifyLow(this.sid(), u.sub, u.role, dto);
  }
}
