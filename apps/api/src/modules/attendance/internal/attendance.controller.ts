import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserRole, withTenant, AttendanceStatus } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { BulkAttendanceDto } from './attendance.dto';

/**
 * Attendance — bulk mark for one (class, section?, date) with **idempotent upsert**
 * on (schoolId, enrollmentId, date). Same POST repeated returns the same row
 * count, no duplicates.
 *
 * Roles:
 *   - SCHOOL_ADMIN, TEACHER → can mark
 *   - SCHOOL_ADMIN, TEACHER, STAFF → can read
 *   - STUDENT/PARENT read their own through /me endpoints (Phase 6)
 */
@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  @Post('bulk')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async bulk(@Body() dto: BulkAttendanceDto, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('invalid date');
    // Normalise to UTC midnight so the DB date column doesn't accidentally
    // store off-by-one for non-UTC servers.
    date.setUTCHours(0, 0, 0, 0);

    const enrollmentIds = dto.marks.map((m) => m.enrollmentId);

    const result = await withTenant(schoolId, async (tx) => {
      // Validate all enrollments belong to this class (RLS already enforces school).
      const enrollments = await tx.enrollment.findMany({
        where: { id: { in: enrollmentIds }, classId: dto.classId },
        select: { id: true },
      });
      const validIds = new Set(enrollments.map((e) => e.id));
      const filtered = dto.marks.filter((m) => validIds.has(m.enrollmentId));
      if (filtered.length === 0) throw new BadRequestException('no valid enrollments for this class');

      // Upsert in a single transaction. Compound unique key (schoolId, enrollmentId, date).
      const upserts = await Promise.all(
        filtered.map((m) =>
          tx.attendance.upsert({
            where: {
              schoolId_enrollmentId_date: {
                schoolId,
                enrollmentId: m.enrollmentId,
                date,
              },
            },
            create: {
              schoolId,
              enrollmentId: m.enrollmentId,
              date,
              status: m.status as AttendanceStatus,
              note: m.note,
              markedByUserId: user.sub,
            },
            update: {
              status: m.status as AttendanceStatus,
              note: m.note,
              markedByUserId: user.sub,
            },
          }),
        ),
      );
      return { written: upserts.length, skipped: dto.marks.length - upserts.length };
    });
    return result;
  }

  @Get()
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF, UserRole.STUDENT, UserRole.PARENT)
  async list(
    @CurrentUser() user: SchoolJwtPayload,
    @Query('classId') classId?: string,
    @Query('date') date?: string,
    @Query('studentUserId') studentUserId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { schoolId } = this.tenantCtx.requireTenant();
    if (!classId && !studentUserId) {
      throw new BadRequestException('classId or studentUserId required');
    }
    // STUDENT / PARENT may only query their own (or their linked) attendance.
    if (user.role === UserRole.STUDENT) {
      if (!studentUserId || studentUserId !== user.sub || classId) {
        throw new ForbiddenException('Students may only fetch their own attendance');
      }
    } else if (user.role === UserRole.PARENT) {
      if (!studentUserId || classId) {
        throw new ForbiddenException('Parents may only fetch attendance for a specific student');
      }
      const linked = await withTenant(schoolId, (tx) =>
        tx.parentStudent.findFirst({
          where: { parent: { userId: user.sub }, student: { userId: studentUserId } },
        }),
      );
      if (!linked) throw new ForbiddenException();
    }
    return withTenant(schoolId, async (tx) => {
      const where: Record<string, unknown> = {};
      if (date) {
        const d = new Date(date);
        d.setUTCHours(0, 0, 0, 0);
        where.date = d;
      } else if (from || to) {
        where.date = {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        };
      }
      if (classId) where.enrollment = { classId };
      if (studentUserId) where.enrollment = { ...(where.enrollment as object | undefined ?? {}), studentUserId };
      return tx.attendance.findMany({
        where,
        include: { enrollment: { select: { studentUserId: true, classId: true, sectionId: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
    });
  }
}
