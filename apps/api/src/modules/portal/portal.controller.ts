import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { PortalService } from './portal.service';

@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('STUDENT')
@Controller('me')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('profile') profile(@CurrentUser() u: SchoolJwtPayload) { return this.portal.profile(u.sub); }
  @Get('timetable') timetable(@CurrentUser() u: SchoolJwtPayload) { return this.portal.timetable(u.sub); }
  @Get('announcements') announcements(@CurrentUser() u: SchoolJwtPayload) { return this.portal.announcements(u.sub); }

  /**
   * `month` is an optional `YYYY-MM`; omitted means the current IST month.
   * Note there is deliberately no student id parameter anywhere on `/me/*` —
   * the row is always resolved from the caller's own JWT `sub`.
   */
  @Get('attendance') attendance(@CurrentUser() u: SchoolJwtPayload, @Query('month') month?: string) {
    return this.portal.attendance(u.sub, month);
  }

  @Get('exams') exams(@CurrentUser() u: SchoolJwtPayload) { return this.portal.exams(u.sub); }
  @Get('results') results(@CurrentUser() u: SchoolJwtPayload) { return this.portal.results(u.sub); }
}
