import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { CatalogService } from './catalog.service';
import { TimetableService } from './timetable.service';
import {
  AvailabilityQueryDto,
  CreateGradeDto,
  CreatePeriodDto,
  CreateSubjectDto,
  CreateYearDto,
  UpdateGradeDto,
  UpdatePeriodDto,
  UpdateClassNoteVisibilityDto,
  UpdateSubjectDto,
  UpdateWorkingDaysDto,
} from './management.dto';

/**
 * The school's academic reference data: years, grades, subjects, periods.
 *
 * SCHOOL_ADMIN by default, every route. `RolesGuard` used to be absent
 * entirely here, with only four handlers adding it per-method — the same shape
 * commit 0e283ad repudiated on StaffController. `RequireFeatureGuard` asks
 * whether the SCHOOL bought MANAGEMENT, never who is asking, and the only
 * APP_GUARD is ThrottlerGuard, so `SchoolJwtGuard` (which reads no role) was
 * the entire check: a STUDENT token could POST/PUT/DELETE every grade,
 * subject, period and academic year.
 *
 * `GET subjects` is the one deliberate widening — the teacher portal reads it
 * to populate the assignment and test forms (apps/web/app/teacher/
 * assignments/page.tsx, tests/page.tsx). Everything else under /app is
 * SCHOOL_ADMIN-only by the console's own guard, so nothing else needs it.
 */
@Controller('manage')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly timetable: TimetableService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  // ── Academic Years ─────────────────────────────────────────────────────────

  @Get('years')
  listYears() {
    return this.catalog.listYears(this.sid());
  }

  @Post('years')
  createYear(@Body() dto: CreateYearDto) {
    return this.catalog.createYear(this.sid(), dto);
  }

  // ── Grades ─────────────────────────────────────────────────────────────────

  @Get('grades')
  listGrades() {
    return this.catalog.listGrades(this.sid());
  }

  @Post('grades')
  createGrade(@Body() dto: CreateGradeDto) {
    return this.catalog.createGrade(this.sid(), dto);
  }

  @Put('grades/:id')
  updateGrade(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGradeDto,
  ) {
    return this.catalog.updateGrade(this.sid(), id, dto);
  }

  @Delete('grades/:id')
  @HttpCode(204)
  deleteGrade(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteGrade(this.sid(), id);
  }

  // ── Subjects ───────────────────────────────────────────────────────────────

  /** Widened to TEACHER: the teacher portal's assignment and test forms need
   *  the subject list. Read-only — the writes below stay SCHOOL_ADMIN. */
  @Get('subjects')
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  listSubjects() {
    return this.catalog.listSubjects(this.sid());
  }

  @Post('subjects')
  createSubject(@Body() dto: CreateSubjectDto) {
    return this.catalog.createSubject(this.sid(), dto);
  }

  @Put('subjects/:id')
  updateSubject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSubjectDto,
  ) {
    return this.catalog.updateSubject(this.sid(), id, dto);
  }

  @Delete('subjects/:id')
  @HttpCode(204)
  deleteSubject(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteSubject(this.sid(), id);
  }

  // ── Periods ────────────────────────────────────────────────────────────────

  @Get('periods')
  listPeriods() {
    return this.catalog.listPeriods(this.sid());
  }

  @Post('periods')
  createPeriod(@Body() dto: CreatePeriodDto) {
    return this.catalog.createPeriod(this.sid(), dto);
  }

  @Put('periods/:id')
  updatePeriod(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePeriodDto,
  ) {
    return this.catalog.updatePeriod(this.sid(), id, dto);
  }

  @Delete('periods/:id')
  @HttpCode(204)
  deletePeriod(@Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deletePeriod(this.sid(), id);
  }

  // ── School / working days ────────────────────────────────────────────────────
  // The class already says SCHOOL_ADMIN; these keep an explicit @Roles because
  // they are settings, and reading as deliberately restricted at the call site
  // is worth the repetition.

  @Get('school/working-days')
  @Roles('SCHOOL_ADMIN')
  getWorkingDays() {
    return this.catalog.getWorkingDays(this.sid());
  }

  @Put('school/working-days')
  @Roles('SCHOOL_ADMIN')
  updateWorkingDays(@Body() dto: UpdateWorkingDaysDto) {
    return this.catalog.updateWorkingDays(this.sid(), dto.workingDays);
  }

  // ── School / class note visibility ──────────────────────────────────────────

  @Get('school/class-note-visibility')
  @Roles('SCHOOL_ADMIN')
  getClassNoteVisibility() {
    return this.catalog.getClassNoteVisibility(this.sid());
  }

  @Put('school/class-note-visibility')
  @Roles('SCHOOL_ADMIN')
  updateClassNoteVisibility(@Body() dto: UpdateClassNoteVisibilityDto) {
    return this.catalog.updateClassNoteVisibility(this.sid(), dto.classNoteVisibility);
  }

  // ── Availability ───────────────────────────────────────────────────────────

  @Get('availability')
  availability(@Query() query: AvailabilityQueryDto) {
    return this.timetable.availability(this.sid(), query);
  }
}
