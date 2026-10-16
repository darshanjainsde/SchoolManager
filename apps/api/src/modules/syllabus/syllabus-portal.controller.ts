import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { SyllabusPortalService } from './syllabus-portal.service';
import { StudentNoteDto } from './syllabus.dto';

/** The child's own view. The student is resolved from the login, never from a parameter. */
@Controller('me/syllabus')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('COURSE_MANAGEMENT')
@Roles('STUDENT')
export class SyllabusPortalController {
  constructor(
    private readonly svc: SyllabusPortalService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  @Get()
  home(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.home(this.sid(), u.sub);
  }

  @Get('subjects/:subjectId')
  subject(@Param('subjectId', ParseUUIDPipe) subjectId: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.subject(this.sid(), u.sub, subjectId);
  }

  @Put('notes/:chapterId')
  note(@Param('chapterId', ParseUUIDPipe) chapterId: string, @Body() dto: StudentNoteDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.note(this.sid(), u.sub, chapterId, dto.body);
  }
}
