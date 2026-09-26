import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { SchoolJwtGuard } from '../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../common/auth/roles.guard';
import { Roles } from '../../common/auth/roles.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { RequireFeature } from '../features';
import { TenantContextService } from '../tenancy';
import { ClassTeachersService } from './class-teachers.service';
import { AssignClassTeacherDto, CopyClassTeachersDto } from './management.dto';

/**
 * The class-teacher desk. Admin only: who owns a section decides who may take
 * its attendance, write its notes, sign its report cards and answer its
 * families — it is not a teacher's own setting to change.
 */
@UseGuards(SchoolJwtGuard, RolesGuard)
@Roles('SCHOOL_ADMIN')
@RequireFeature('MANAGEMENT')
@Controller('manage/class-teachers')
export class ClassTeachersController {
  constructor(private readonly svc: ClassTeachersService, private readonly tenant: TenantContextService) {}
  private sid() { return this.tenant.requireTenant().schoolId; }

  @Get()
  desk(@Query('academicYearId') academicYearId?: string) {
    return this.svc.desk(this.sid(), academicYearId || undefined);
  }

  /** Declared before `:classSectionId` so the literal path wins. */
  @Post('copy')
  copy(@Body() dto: CopyClassTeachersDto, @CurrentUser() u: SchoolJwtPayload) {
    return this.svc.copyFrom(this.sid(), dto.fromYearId, u.sub);
  }

  @Put(':classSectionId')
  assign(
    @Param('classSectionId', ParseUUIDPipe) classSectionId: string,
    @Body() dto: AssignClassTeacherDto,
    @CurrentUser() u: SchoolJwtPayload,
  ) {
    return this.svc.assign(this.sid(), classSectionId, dto.teacherId ?? null, u.sub);
  }
}
