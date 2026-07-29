import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature, RequireFeatureGuard } from '../features';
import { TenantContextService } from '../tenancy';
import { TimetableService } from './timetable.service';
import { TeacherDayService } from './teacher-day.service';
import { istTodayISO } from './internal/timetable-date';
import { AssignSlotDto, AvailabilityQueryDto } from './management.dto';

@Controller('manage/timetable')
@UseGuards(SchoolJwtGuard, RequireFeatureGuard, RolesGuard)
@RequireFeature('MANAGEMENT')
@Roles('SCHOOL_ADMIN')
export class TimetableController {
  constructor(
    private readonly timetable: TimetableService,
    private readonly teacherDay: TeacherDayService,
    private readonly tenant: TenantContextService,
  ) {}

  private sid(): string {
    return this.tenant.requireTenant().schoolId;
  }

  /**
   * The caller's own day. Declared above `@Get()` so the static path matches
   * before the class-scoped read.
   */
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get('my-day')
  myDay(@CurrentUser() u: SchoolJwtPayload, @Query('date') date?: string) {
    return this.teacherDay.forTeacher(this.sid(), u.sub, u.role, date ?? istTodayISO());
  }

  /** The caller's own week, for the timetable grid. */
  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get('mine')
  myWeek(@CurrentUser() u: SchoolJwtPayload, @Query('date') date?: string) {
    return this.timetable.listForTeacher(this.sid(), u.sub, date);
  }

  @Roles('SCHOOL_ADMIN', 'TEACHER')
  @Get()
  listForClass(
    @Query('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Query('date') date?: string,
  ) {
    return this.timetable.listForClass(this.sid(), classSectionId, date);
  }

  @Post()
  assign(@Body() dto: AssignSlotDto) {
    return this.timetable.assign(this.sid(), dto);
  }

  @Delete(':id')
  @HttpCode(204)
  unassign(@Param('id', ParseUUIDPipe) id: string) {
    return this.timetable.unassign(this.sid(), id);
  }
}
