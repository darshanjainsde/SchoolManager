import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { ExamsService } from './exams.service';
import { CreateExamDto, SaveExamResultsDto } from './management.dto';

@Controller('manage/exams')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('TEACHER', 'SCHOOL_ADMIN')
export class ExamsController {
  constructor(
    private readonly exams: ExamsService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // TEACHER may create too — restricted to their own class sections
  // (ExamsService.create enforces this via AttendanceService.myClassSections,
  // mirroring AnnouncementsController/AnnouncementsService).
  @Post()
  create(@Body() dto: CreateExamDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.exams.create(this.sid(), u.sub, u.role, dto);
  }

  @Get()
  list(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.exams.list(this.sid(), classSectionId, u.sub, u.role);
  }

  /** Marks already stored for this exam — lets the entry screen prefill. */
  @Get(':id/results')
  listResults(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.exams.results(this.sid(), id, u.sub, u.role);
  }

  @Put(':id/results')
  saveResults(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveExamResultsDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.exams.saveResults(this.sid(), id, dto, u.sub, u.role);
  }

  @Post(':id/publish')
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: SchoolJwtPayload) {
    return this.exams.publish(this.sid(), id, u.sub, u.role);
  }
}
