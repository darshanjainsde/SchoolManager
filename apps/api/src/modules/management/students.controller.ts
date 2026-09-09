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
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { ApiError } from '../../common/errors/api-error';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { StudentsService, type StudentListStatus } from './students.service';
import { StudentReportService } from './student-report.service';
import { StudentLifecycleService } from './student-lifecycle.service';
import {
  CreateLoginDto,
  CreateStudentDto,
  LeaveStudentDto,
  ReadmitStudentDto,
  UpdateStudentDto,
} from './management.dto';

@Controller('manage/students')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly studentReport: StudentReportService,
    private readonly lifecycle: StudentLifecycleService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  /**
   * Read-only roster. Teachers need this to render names next to the
   * studentIds returned by /manage/attendance and to enter exam results, so
   * the handler-level @Roles widens the class-level SCHOOL_ADMIN rule (the
   * RolesGuard resolves handler metadata first). Every mutating handler below
   * stays SCHOOL_ADMIN-only.
   *
   * A TEACHER is NOT an administrator of the school's student records:
   *  - `classSectionId` is REQUIRED for them, so they can only pull one class
   *    section at a time rather than the entire school's minor roster; and
   *  - they get the `roster` projection ({ id, firstName, lastName, rollNo }),
   *    which omits guardianName / guardianPhone / dob / gender / admissionNo.
   *
   * SCHOOL_ADMIN keeps the original contract (optional filter, full rows) —
   * the admin students screen depends on it. The projection is passed to the
   * service explicitly; the service never inspects the caller's role.
   */
  @Get()
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  list(
    @CurrentUser() u: SchoolJwtPayload,
    @Query('classSectionId', new ParseUUIDPipe({ optional: true }))
    classSectionId?: string,
    @Query('status') status?: string,
  ) {
    if (u.role !== 'SCHOOL_ADMIN') {
      if (!classSectionId) {
        throw new ApiError(
          'VALIDATION',
          'classSectionId is required',
          400,
          'classSectionId',
        );
      }
      // Teachers only ever see the active roster of one section.
      return this.students.list(this.sid(), { classSectionId, projection: 'roster', status: 'active' });
    }
    const st: StudentListStatus = status === 'left' || status === 'all' ? status : 'active';
    return this.students.list(this.sid(), { classSectionId, projection: 'full', status: st });
  }

  /** "Mark as left": the record and its history stay; the child leaves every roster. */
  @Post(':id/leave')
  leave(
    @CurrentUser() u: SchoolJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveStudentDto,
  ) {
    return this.lifecycle.leave(this.sid(), u.sub, id, dto);
  }

  @Post(':id/readmit')
  readmit(
    @CurrentUser() u: SchoolJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReadmitStudentDto,
  ) {
    return this.lifecycle.readmit(this.sid(), u.sub, id, dto);
  }

  /** What the office should know before marking a child as left. */
  @Get(':id/clearance')
  clearance(@Param('id', ParseUUIDPipe) id: string) {
    return this.lifecycle.clearance(this.sid(), id);
  }

  @Post()
  create(@Body() dto: CreateStudentDto) {
    return this.students.create(this.sid(), dto);
  }

  @Post(':id/login')
  createLogin(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateLoginDto) {
    return this.students.createLogin(this.sid(), id, dto);
  }

  @Post(':id/invite/resend')
  resendInvite(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.resendInvite(this.sid(), id);
  }

  @Put(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
  ) {
    return this.students.update(this.sid(), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.remove(this.sid(), id);
  }

  /**
   * The Student 360 — the composed report the office reads on screen and
   * prints when a parent asks. SCHOOL_ADMIN (the class-level rule): it
   * carries the fee position alongside everything else.
   */
  @Get(':id/report')
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.studentReport.report(this.sid(), id);
  }
}
