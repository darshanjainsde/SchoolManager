import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { UserRole, withTenant } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { SchoolJwtGuard } from '../../../common/auth/school-jwt.guard';
import { RolesGuard } from '../../../common/auth/roles.guard';
import { Roles } from '../../../common/auth/roles.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { redisConnectionFromUrl } from '../../../common/queue/redis-connection';
import {
  CreateExamDto,
  CreateGradingSchemeDto,
  SaveMarksDto,
  SetExamSubjectsDto,
} from './assessment.dto';

@ApiTags('exams')
@ApiBearerAuth()
@UseGuards(SchoolJwtGuard, RolesGuard)
@Controller()
export class ExamsController {
  private readonly env = loadEnv();
  private readonly reportCardQueue: Queue;

  constructor(private readonly tenantCtx: TenantContextService) {
    this.reportCardQueue = new Queue('report-card', {
      connection: redisConnectionFromUrl(this.env.REDIS_URL),
    });
  }

  // ── Grading schemes ─────────────────────────────────────────────────────
  @Get('grading-schemes')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async listSchemes(): Promise<unknown> {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) => tx.gradingScheme.findMany({ orderBy: { name: 'asc' } }));
  }

  @Post('grading-schemes')
  @Roles(UserRole.SCHOOL_ADMIN)
  async createScheme(@Body() dto: CreateGradingSchemeDto): Promise<unknown> {
    const { schoolId } = this.tenantCtx.requireTenant();
    // Sort bands descending by min so consumers can scan top-down.
    // Convert class instances to plain {min, letter} objects so Prisma sees
    // a JSON-safe array (class-validator instances are not InputJsonValue).
    const bands = [...dto.bands]
      .sort((a, b) => b.min - a.min)
      .map((b) => ({ min: b.min, letter: b.letter }));
    return withTenant(schoolId, (tx) =>
      tx.gradingScheme.create({
        data: { schoolId, name: dto.name, bands },
      }),
    );
  }

  // ── Exams ───────────────────────────────────────────────────────────────
  @Get('exams')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async listExams(): Promise<unknown> {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, (tx) =>
      tx.exam.findMany({
        include: { examSubjects: { include: { subject: true } }, gradingScheme: true, class: { include: { grade: true } } },
        orderBy: { startsAt: 'desc' },
      }),
    );
  }

  @Get('exams/:id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF)
  async oneExam(@Param('id') id: string): Promise<unknown> {
    const { schoolId } = this.tenantCtx.requireTenant();
    const row = await withTenant(schoolId, (tx) =>
      tx.exam.findUnique({
        where: { id },
        include: {
          examSubjects: { include: { subject: true } },
          gradingScheme: true,
          examResults: { include: { marks: true } },
        },
      }),
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  @Post('exams')
  @Roles(UserRole.SCHOOL_ADMIN)
  async createExam(@Body() dto: CreateExamDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const starts = new Date(dto.startsAt);
    const ends = new Date(dto.endsAt);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) {
      throw new BadRequestException('startsAt/endsAt invalid');
    }
    if (ends <= starts) throw new BadRequestException('endsAt must be after startsAt');
    return withTenant(schoolId, async (tx) => {
      const cls = await tx.class.findUnique({ where: { id: dto.classId } });
      if (!cls) throw new BadRequestException('classId not in this school');
      if (dto.gradingSchemeId) {
        const gs = await tx.gradingScheme.findUnique({ where: { id: dto.gradingSchemeId } });
        if (!gs) throw new BadRequestException('gradingSchemeId not in this school');
      }
      return tx.exam.create({
        data: {
          schoolId,
          name: dto.name,
          classId: dto.classId,
          sectionId: dto.sectionId,
          startsAt: starts,
          endsAt: ends,
          gradingSchemeId: dto.gradingSchemeId,
        },
      });
    });
  }

  @Post('exams/:id/subjects')
  @Roles(UserRole.SCHOOL_ADMIN)
  async setSubjects(@Param('id') id: string, @Body() dto: SetExamSubjectsDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findUnique({ where: { id } });
      if (!exam) throw new NotFoundException();
      // Validate subject existence first
      for (const s of dto.subjects) {
        const subj = await tx.subject.findUnique({ where: { id: s.subjectId } });
        if (!subj) throw new BadRequestException(`subjectId ${s.subjectId} not in this school`);
        if (s.passingMarks > s.maxMarks) throw new BadRequestException(`passingMarks > maxMarks for ${s.subjectId}`);
      }
      // Replace all subjects atomically.
      await tx.examSubject.deleteMany({ where: { examId: id } });
      await tx.examSubject.createMany({
        data: dto.subjects.map((s) => ({
          schoolId,
          examId: id,
          subjectId: s.subjectId,
          maxMarks: s.maxMarks,
          passingMarks: s.passingMarks,
        })),
      });
      return tx.examSubject.findMany({ where: { examId: id } });
    });
  }

  // Generate per-student ExamResult rows for all current ACTIVE enrollments in
  // the exam's class. Safe to re-run — uses upsert.
  @Post('exams/:id/generate-results')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async generate(@Param('id') id: string) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findUnique({ where: { id } });
      if (!exam) throw new NotFoundException();
      const enrollments = await tx.enrollment.findMany({
        where: {
          classId: exam.classId,
          status: 'ACTIVE',
          ...(exam.sectionId ? { sectionId: exam.sectionId } : {}),
        },
        select: { studentUserId: true },
      });
      const created = await Promise.all(
        enrollments.map((e) =>
          tx.examResult.upsert({
            where: { examId_studentUserId: { examId: id, studentUserId: e.studentUserId } },
            create: { schoolId, examId: id, studentUserId: e.studentUserId, status: 'DRAFT' },
            update: {},
          }),
        ),
      );
      return { count: created.length };
    });
  }

  @Post('exams/:id/marks')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER)
  async saveMarks(@Param('id') id: string, @Body() dto: SaveMarksDto) {
    const { schoolId } = this.tenantCtx.requireTenant();
    return withTenant(schoolId, async (tx) => {
      const examSubject = await tx.examSubject.findFirst({
        where: { id: dto.examSubjectId, examId: id },
      });
      if (!examSubject) throw new NotFoundException();
      // Range check
      for (const m of dto.marks) {
        if (!m.isAbsent && (m.marksObtained < 0 || m.marksObtained > examSubject.maxMarks)) {
          throw new BadRequestException(`marks out of range for student ${m.studentUserId}`);
        }
      }
      let written = 0;
      for (const m of dto.marks) {
        const result = await tx.examResult.findUnique({
          where: { examId_studentUserId: { examId: id, studentUserId: m.studentUserId } },
        });
        if (!result) continue; // student not in this exam — skip silently
        await tx.mark.upsert({
          where: {
            examResultId_examSubjectId: {
              examResultId: result.id,
              examSubjectId: dto.examSubjectId,
            },
          },
          create: {
            schoolId,
            examResultId: result.id,
            examSubjectId: dto.examSubjectId,
            marksObtained: m.marksObtained,
            isAbsent: m.isAbsent ?? false,
          },
          update: { marksObtained: m.marksObtained, isAbsent: m.isAbsent ?? false },
        });
        written++;
      }
      return { written };
    });
  }

  @Post('exams/:id/publish')
  @Roles(UserRole.SCHOOL_ADMIN)
  async publish(@Param('id') id: string, @CurrentUser() _user: SchoolJwtPayload) {
    const { schoolId } = this.tenantCtx.requireTenant();
    const results = await withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findUnique({ where: { id } });
      if (!exam) throw new NotFoundException();
      // Capture exactly which rows we're flipping, BEFORE the updateMany,
      // so re-running publish doesn't re-enqueue PDF jobs for previously
      // published results.
      const drafts = await tx.examResult.findMany({
        where: { examId: id, status: 'DRAFT' },
        select: { id: true },
      });
      if (drafts.length === 0) return [] as Array<{ id: string }>;
      await tx.examResult.updateMany({
        where: { examId: id, status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      return drafts;
    });
    // Enqueue one PDF job per published result.
    for (const r of results) {
      await this.reportCardQueue.add(
        'generate-report-card',
        { examResultId: r.id, schoolId },
        { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 500 },
      );
    }
    return { publishedCount: results.length };
  }

  @Get('exam-results/:id')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.TEACHER, UserRole.STAFF, UserRole.STUDENT, UserRole.PARENT)
  async oneResult(@Param('id') id: string, @CurrentUser() user: SchoolJwtPayload): Promise<unknown> {
    const { schoolId } = this.tenantCtx.requireTenant();
    const row = await withTenant(schoolId, (tx) =>
      tx.examResult.findUnique({
        where: { id },
        include: {
          marks: { include: { examSubject: { include: { subject: true } } } },
          exam: { include: { gradingScheme: true } },
          reportCards: true,
        },
      }),
    );
    if (!row) throw new NotFoundException();
    // Students/parents can only see their own / their student's results AND only
    // when PUBLISHED.
    if (user.role === UserRole.STUDENT) {
      if (row.studentUserId !== user.sub) throw new NotFoundException();
      if (row.status !== 'PUBLISHED') throw new NotFoundException();
    } else if (user.role === UserRole.PARENT) {
      const allowed = await withTenant(schoolId, async (tx) => {
        const link = await tx.parentStudent.findFirst({
          where: { parent: { userId: user.sub }, student: { userId: row.studentUserId } },
        });
        return !!link;
      });
      if (!allowed) throw new NotFoundException();
      if (row.status !== 'PUBLISHED') throw new NotFoundException();
    }
    return row;
  }
}
