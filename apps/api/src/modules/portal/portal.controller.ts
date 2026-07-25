import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { PortalService } from './portal.service';
import { RegisterPushTokenDto } from './portal.dto';

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

  /**
   * Overrides the class-level `@Roles('STUDENT')` — device registration is
   * for the mobile app generally, which every school role can sign into, not
   * just students. `RolesGuard` uses `getAllAndOverride`, so a method-level
   * `@Roles(...)` here replaces the class-level list rather than adding to it.
   */
  @Roles('STUDENT', 'TEACHER', 'STAFF', 'SCHOOL_ADMIN')
  @Post('push-token')
  registerPushToken(@CurrentUser() u: SchoolJwtPayload, @Body() dto: RegisterPushTokenDto) {
    return this.portal.registerPushToken(u.sub, dto.token, dto.platform);
  }

  /**
   * Overrides the class-level `@Roles('STUDENT')` — same reasoning as
   * `push-token` above. The school holiday calendar is school-wide, not
   * per-student, so every authenticated role reads the same list.
   */
  @Roles('STUDENT', 'TEACHER', 'STAFF', 'SCHOOL_ADMIN')
  @Get('holidays')
  holidays() {
    return this.portal.holidays();
  }
}
