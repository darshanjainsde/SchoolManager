import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { SyllabusService } from './syllabus.service';
import { CreateChapterDto, MarkProgressDto, UpdateChapterDto } from './syllabus.dto';

/**
 * Teacher and admin doors of the syllabus tracker. The feature is in no
 * tier (COURSE_MANAGEMENT): the owner switches it on per school.
 *
 * Who marks and who only reads is decided in the service from the timetable
 * (`syllabus-access.ts`); the roles here only say which kind of login may
 * knock. `@Roles` on a handler replaces the class list.
 */
@Controller('manage/syllabus')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('COURSE_MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
export class SyllabusController {
  constructor(
    private readonly svc: SyllabusService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  private caller(u: SchoolJwtPayload) {
    return { userId: u.sub, role: u.role };
  }

  /** The sections and subjects this teacher logs. */
  @Get('mine')
  @Roles('TEACHER')
  mine(@CurrentUser() u: SchoolJwtPayload) {
    return this.svc.mine(this.sid(), u.sub);
  }

  /** Every section of the current year against the year, for the console. */
  @Get('overview')
  @Roles('SCHOOL_ADMIN')
  overview() {
    return this.svc.overview(this.sid());
  }

  @Get('chapters')
  chapters(@Query('gradeId', ParseUUIDPipe) gradeId: string, @Query('subjectId', ParseUUIDPipe) subjectId: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.chapters(this.sid(), this.caller(u), gradeId, subjectId);
  }

  @Post('chapters')
  createChapter(@Body() dto: CreateChapterDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.createChapter(this.sid(), this.caller(u), dto);
  }

  @Patch('chapters/:id')
  updateChapter(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateChapterDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.updateChapter(this.sid(), this.caller(u), id, dto);
  }

  @Delete('chapters/:id')
  @HttpCode(204)
  retireChapter(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.retireChapter(this.sid(), this.caller(u), id);
  }

  @Get('tracks/:classSectionId/:subjectId')
  track(@Param('classSectionId', ParseUUIDPipe) classSectionId: string, @Param('subjectId', ParseUUIDPipe) subjectId: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.track(this.sid(), this.caller(u), classSectionId, subjectId);
  }

  @Put('tracks/:classSectionId/:subjectId/progress/:chapterId')
  @Roles('TEACHER')
  mark(
    @Param('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: MarkProgressDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.svc.mark(this.sid(), this.caller(u), classSectionId, subjectId, chapterId, dto);
  }

  @Post('tracks/:classSectionId/:subjectId/reach/:chapterId')
  @Roles('TEACHER')
  reach(
    @Param('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Param('subjectId', ParseUUIDPipe) subjectId: string,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.svc.reach(this.sid(), this.caller(u), classSectionId, subjectId, chapterId);
  }
}
