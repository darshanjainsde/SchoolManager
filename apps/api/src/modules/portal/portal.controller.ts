import { Controller, Get, UseGuards } from '@nestjs/common';
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
}
