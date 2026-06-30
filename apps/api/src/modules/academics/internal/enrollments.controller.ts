import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, withTenant } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { TenantContextService } from '../../tenancy';
import { CreateEnrollmentDto, TransitionEnrollmentDto } from './academics.dto';
import { throwOnUnique, throwOnNotFound } from './grades.controller';

@ApiTags('academics-enrollments')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller('enrollments')
export class EnrollmentsController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async list(
    @Query('classId') classId?: string,
    @Query('sectionId') sectionId?: string,
    @Query('studentUserId') studentUserId?: string,
  ) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.enrollment.findMany({
        where: {
          ...(classId ? { classId } : {}),
          ...(sectionId ? { sectionId } : {}),
          ...(studentUserId ? { studentUserId } : {}),
        },
        include: { class: { include: { grade: true } }, section: true, academicYear: true },
        orderBy: { enrolledAt: 'desc' },
      }),
    );
  }

  @Post()
  @Roles(UserRole.SCHOOL_ADMIN)
  async create(@Body() dto: CreateEnrollmentDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    await withTenant(schoolId, async (tx) => {
      const student = await tx.user.findUnique({ where: { id: dto.studentUserId } });
      if (!student || student.role !== 'STUDENT') {
        throw new BadRequestException('studentUserId is not a STUDENT in this school');
      }
      const cls = await tx.class.findUnique({ where: { id: dto.classId } });
      if (!cls) throw new BadRequestException('classId not in this school');
      if (cls.academicYearId !== dto.academicYearId) {
        throw new BadRequestException('class is in a different academic year');
      }
      if (dto.sectionId) {
        const sec = await tx.section.findUnique({ where: { id: dto.sectionId } });
        if (!sec || sec.classId !== dto.classId) {
          throw new BadRequestException('sectionId does not belong to this class');
        }
      }
    });
    try {
      return await withTenant(schoolId, (tx) =>
        tx.enrollment.create({
          data: {
            schoolId,
            studentUserId: dto.studentUserId,
            classId: dto.classId,
            sectionId: dto.sectionId,
            academicYearId: dto.academicYearId,
            status: 'ACTIVE',
          },
        }),
      );
    } catch (e) {
      throwOnUnique(e);
    }
  }

  @Patch(':id/transition')
  @Roles(UserRole.SCHOOL_ADMIN)
  async transition(@Param('id') id: string, @Body() dto: TransitionEnrollmentDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) =>
        tx.enrollment.update({
          where: { id },
          // DTO restricts dto.status to non-ACTIVE values, so exitedAt is always stamped.
          data: { status: dto.status, exitedAt: new Date() },
        }),
      );
    } catch (e) {
      throwOnNotFound(e);
    }
  }
}
