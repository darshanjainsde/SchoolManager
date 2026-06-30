import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, UserRole, withTenant } from '@skoolos/db';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import {
  CreateAssignmentDto,
  GradeSubmissionDto,
  SubmitDto,
  UpdateAssignmentDto,
} from './assessment.dto';

/**
 * Assignments (teacher-authored work). Submissions (student-authored answers).
 *
 * Authorisation:
 *   - Teacher/Admin/Staff can list + grade.
 *   - Student sees only own submissions.
 *   - Submission upsert is keyed on (assignmentId, studentUserId) — second
 *     submit replaces the first; `isLate` is computed once on first submit
 *     and preserved on update so a late submit can't be "rewritten" as
 *     on-time by re-submitting after the due date.
 */
@ApiTags('assignments')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller()
export class AssignmentsController {
  constructor(private readonly tenantCtx: TenantContextService) {}

  @Get('assignments')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STUDENT, UserRole.STAFF, UserRole.PARENT)
  async list(@Query('classId') classId?: string, @Query('subjectId') subjectId?: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.assignment.findMany({
        where: { ...(classId ? { classId } : {}), ...(subjectId ? { subjectId } : {}) },
        include: { subject: { select: { code: true, name: true } } },
        orderBy: { dueAt: 'desc' },
      }),
    );
  }

  @Post('assignments')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async create(@Body() dto: CreateAssignmentDto, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const due = new Date(dto.dueAt);
    if (Number.isNaN(due.getTime())) throw new BadRequestException('dueAt invalid');
    return withTenant(schoolId, async (tx) => {
      // FK existence checks (RLS already gates cross-tenant).
      const [cls, subj] = await Promise.all([
        tx.class.findUnique({ where: { id: dto.classId } }),
        tx.subject.findUnique({ where: { id: dto.subjectId } }),
      ]);
      if (!cls) throw new BadRequestException('classId not found');
      if (!subj) throw new BadRequestException('subjectId not found');
      if (dto.sectionId) {
        const sec = await tx.section.findUnique({ where: { id: dto.sectionId } });
        if (!sec || sec.classId !== dto.classId) throw new BadRequestException('sectionId does not belong to class');
      }
      return tx.assignment.create({
        data: {
          schoolId,
          classId: dto.classId,
          sectionId: dto.sectionId,
          subjectId: dto.subjectId,
          title: dto.title,
          description: dto.description,
          dueAt: due,
          attachmentUrl: dto.attachmentUrl,
          maxPoints: dto.maxPoints ?? 100,
          createdByUserId: user.sub,
        },
      });
    });
  }

  @Patch('assignments/:id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async update(@Param('id') id: string, @Body() dto: UpdateAssignmentDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    try {
      return await withTenant(schoolId, (tx) =>
        tx.assignment.update({
          where: { id },
          data: {
            title: dto.title,
            description: dto.description,
            dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
            attachmentUrl: dto.attachmentUrl,
            maxPoints: dto.maxPoints,
          },
        }),
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException();
      }
      throw e;
    }
  }

  @Delete('assignments/:id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async remove(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    await withTenant(schoolId, (tx) => tx.assignment.delete({ where: { id } })).catch(() => undefined);
    return { ok: true };
  }

  @Get('assignments/:id/submissions')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async listSubmissions(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.submission.findMany({ where: { assignmentId: id }, orderBy: { submittedAt: 'desc' } }),
    );
  }

  @Post('assignments/:id/submit')
  @Roles(UserRole.STUDENT)
  async submit(@Param('id') id: string, @Body() dto: SubmitDto, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const a = await tx.assignment.findUnique({ where: { id } });
      if (!a) throw new NotFoundException();
      const existing = await tx.submission.findUnique({
        where: { assignmentId_studentUserId: { assignmentId: id, studentUserId: user.sub } },
      });
      const isLate = existing?.isLate ?? new Date() > a.dueAt;
      return tx.submission.upsert({
        where: { assignmentId_studentUserId: { assignmentId: id, studentUserId: user.sub } },
        create: {
          schoolId,
          assignmentId: id,
          studentUserId: user.sub,
          body: dto.body,
          attachmentUrl: dto.attachmentUrl,
          isLate,
        },
        update: {
          body: dto.body,
          attachmentUrl: dto.attachmentUrl,
          submittedAt: new Date(),
          // isLate is sticky — once late, always late.
          isLate: existing?.isLate ?? isLate,
        },
      });
    });
  }

  @Get('me/submissions')
  @Roles(UserRole.STUDENT, UserRole.PARENT)
  async mySubmissions(@CurrentUser() user: SchoolJwtPayload, @Query('studentUserId') studentUserId?: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    // Parents may pass ?studentUserId=… but we enforce that the parent is
    // linked to that student before returning anything.
    const targetUserId = user.role === UserRole.STUDENT ? user.sub : studentUserId;
    if (!targetUserId) throw new BadRequestException('studentUserId required');
    if (user.role === UserRole.PARENT) {
      const allowed = await withTenant(schoolId, async (tx) => {
        const link = await tx.parentStudent.findFirst({
          where: {
            parent: { userId: user.sub },
            student: { userId: targetUserId },
          },
        });
        return !!link;
      });
      if (!allowed) throw new ForbiddenException();
    }
    return withTenant(schoolId, (tx) =>
      tx.submission.findMany({
        where: { studentUserId: targetUserId },
        include: { assignment: { select: { title: true, dueAt: true, subjectId: true } } },
        orderBy: { submittedAt: 'desc' },
      }),
    );
  }

  @Patch('submissions/:id/grade')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async grade(@Param('id') id: string, @Body() dto: GradeSubmissionDto, @CurrentUser() user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const sub = await tx.submission.findUnique({
        where: { id },
        include: { assignment: { select: { maxPoints: true } } },
      });
      if (!sub) throw new NotFoundException();
      if (dto.grade > sub.assignment.maxPoints) {
        throw new BadRequestException(`grade exceeds maxPoints (${sub.assignment.maxPoints})`);
      }
      return tx.submission.update({
        where: { id },
        data: {
          grade: dto.grade,
          feedback: dto.feedback,
          gradedAt: new Date(),
          gradedByUserId: user.sub,
        },
      });
    });
  }
}
