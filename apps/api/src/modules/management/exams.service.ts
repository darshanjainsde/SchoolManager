import { Injectable, Logger } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveSectionRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
import type { CreateExamDto, SaveExamResultsDto } from './management.dto';

/**
 * Shown when a School/Subject row cannot be read while composing a
 * notification. A name is never allowed to render as `undefined` in a
 * parent's inbox.
 */
const FALLBACK_SCHOOL_NAME = 'Your school';
const FALLBACK_SUBJECT_NAME = 'General';

interface ExamNotificationContext {
  schoolName: string;
  subjectName: string;
  recipients: string[];
}

export interface ExamSummary {
  id: string;
  classSectionId: string;
  subjectId: string;
  title: string;
  scheduledAt: Date;
  syllabus: string | null;
  maxMarks: number;
  createdById: string;
  createdAt: Date;
}

export interface ExamListResult {
  upcoming: ExamSummary[];
  past: ExamSummary[];
}

export interface SaveResultsResult {
  saved: number;
}

export interface PublishResultsResult {
  published: number;
}

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(private readonly notifications: NotificationService) {}

  /**
   * Everything the exam notification composers need beyond the exam row
   * itself: the school's and subject's display names, plus the section's
   * recipient emails.
   *
   * Deliberately runs in its OWN transaction, AFTER the caller's mutation has
   * committed: a transient failure reading a School/Subject/User row must
   * never roll back an exam the teacher just created.
   */
  private async loadNotificationContext(
    schoolId: string,
    subjectId: string,
    classSectionId: string,
  ): Promise<ExamNotificationContext> {
    return withTenant(schoolId, async (tx) => {
      const school = await tx.school.findFirst({
        where: { id: schoolId },
        select: { name: true },
      });
      const subject = await tx.subject.findFirst({
        where: { id: subjectId, schoolId },
        select: { name: true },
      });
      const recipients = await resolveSectionRecipients(tx, schoolId, classSectionId);

      return {
        schoolName: school?.name ?? FALLBACK_SCHOOL_NAME,
        subjectName: subject?.name ?? FALLBACK_SUBJECT_NAME,
        recipients,
      };
    });
  }

  /**
   * Creates an Exam for a class section, after confirming the section
   * actually belongs to this school (ClassSection has RLS, so a foreign
   * classSectionId simply won't be found rather than leaking a row from
   * another tenant).
   */
  async create(schoolId: string, callerUserId: string, dto: CreateExamDto): Promise<ExamSummary> {
    if (!Number.isInteger(dto.maxMarks) || dto.maxMarks <= 0) {
      throw new ApiError('VALIDATION', 'maxMarks must be a positive integer', 400, 'maxMarks');
    }

    const exam = await withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      return tx.exam.create({
        data: {
          schoolId,
          classSectionId: dto.classSectionId,
          subjectId: dto.subjectId,
          title: dto.title,
          scheduledAt: new Date(dto.scheduledAt),
          syllabus: dto.syllabus ?? null,
          maxMarks: dto.maxMarks,
          createdById: callerUserId,
        },
      });
    });

    // Best-effort, after the write has committed — never blocks or fails exam
    // creation. All notification reads (recipients, school/subject names) run
    // here, outside the mutation's transaction.
    runInBackground(
      async () => {
        const { schoolName, subjectName, recipients } = await this.loadNotificationContext(
          schoolId,
          exam.subjectId,
          exam.classSectionId,
        );
        if (recipients.length === 0) return;

        const payload = {
          schoolName,
          subjectName,
          examTitle: exam.title,
          scheduledAt: new Date(exam.scheduledAt).toISOString(),
        };
        await this.notifications.notify(
          'TEST_SCHEDULED',
          recipients.map((email) => ({ email, payload })),
        );
      },
      (e) => this.logger.error(`TEST_SCHEDULED notify failed: ${(e as Error).message}`),
    );

    return exam;
  }

  /**
   * All exams for a class section, split into `upcoming` (scheduledAt in the
   * future or right now) and `past`, each ordered by scheduledAt ascending so
   * the UI can render a simple two-group list without further sorting.
   *
   * `Exam` has no RLS (see migration 20260721_010000), so the schoolId filter
   * here is load-bearing, not defensive — without it a foreign exam row for
   * the same classSectionId (an unlikely but possible UUID collision-free
   * scenario across schools sharing no relation) would still be excluded
   * because classSectionId itself is scoped by the caller's own tenant
   * (validated via the RLS-protected ClassSection lookup below).
   */
  async list(schoolId: string, classSectionId: string): Promise<ExamListResult> {
    return withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { id: classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const exams = await tx.exam.findMany({
        where: { schoolId, classSectionId },
        orderBy: [{ scheduledAt: 'asc' }],
      });

      const now = new Date();
      const upcoming: ExamSummary[] = [];
      const past: ExamSummary[] = [];
      for (const exam of exams) {
        if (exam.scheduledAt >= now) {
          upcoming.push(exam);
        } else {
          past.push(exam);
        }
      }

      return { upcoming, past };
    });
  }

  /**
   * Upserts Results for an exam inside one tenant transaction. `Exam`/`Result`
   * carry no RLS, so both the school ownership check (below) and the
   * roster-membership check are load-bearing — without them a caller could
   * write Results against a foreign school's exam or student.
   *
   * Every studentId must belong to the exam's own classSectionId roster
   * (checked via `tx.student.findMany` + Set, matching the AttendanceService
   * pattern) — this also blocks cross-tenant writes since `Student` has
   * active RLS, so a foreign-school studentId can never appear in the roster
   * result set at all. On any foreign studentId we reject the whole batch
   * with VALIDATION and write nothing.
   *
   * Each mark must fall within `0..exam.maxMarks` (inclusive) or the whole
   * batch is rejected with VALIDATION — marks are validated up front, not
   * silently coerced, so a bad batch never leaves partial writes behind.
   */
  async saveResults(
    schoolId: string,
    examId: string,
    dto: SaveExamResultsDto,
  ): Promise<SaveResultsResult> {
    return withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, schoolId } });
      if (!exam) {
        throw new ApiError('NOT_FOUND', 'exam not found', 404, 'id');
      }

      const roster = await tx.student.findMany({
        where: { classSectionId: exam.classSectionId },
        select: { id: true },
      });
      const rosterIds = new Set(roster.map((s) => s.id));
      for (const mark of dto.marks) {
        if (!rosterIds.has(mark.studentId)) {
          throw new ApiError(
            'VALIDATION',
            'One or more students do not belong to this exam\'s class section',
            400,
          );
        }
        if (mark.marks < 0 || mark.marks > exam.maxMarks) {
          throw new ApiError(
            'VALIDATION',
            `marks must be between 0 and ${exam.maxMarks}`,
            400,
            'marks',
          );
        }
      }

      for (const mark of dto.marks) {
        await tx.result.upsert({
          where: { one_result_per_exam_student: { examId, studentId: mark.studentId } },
          create: { examId, studentId: mark.studentId, marks: mark.marks },
          update: { marks: mark.marks },
        });
      }

      return { saved: dto.marks.length };
    });
  }

  /**
   * Marks every Result for an exam as published (sets `publishedAt = now()`)
   * in one tenant transaction. Loading the exam via `{ id, schoolId }` is
   * again load-bearing since `Exam` carries no RLS.
   */
  async publish(schoolId: string, examId: string): Promise<PublishResultsResult> {
    const { published, exam } = await withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, schoolId } });
      if (!exam) {
        throw new ApiError('NOT_FOUND', 'exam not found', 404, 'id');
      }

      const { count } = await tx.result.updateMany({
        where: { examId },
        data: { publishedAt: new Date() },
      });

      return { published: count, exam };
    });

    // Nothing was actually published (no Results saved for this exam yet) —
    // telling parents results are out would be a lie.
    if (published > 0) {
      // Best-effort, after the write has committed — never blocks or fails
      // publishing, and no notification read happens inside the transaction.
      runInBackground(
        async () => {
          const { schoolName, subjectName, recipients } = await this.loadNotificationContext(
            schoolId,
            exam.subjectId,
            exam.classSectionId,
          );
          if (recipients.length === 0) return;

          const payload = { schoolName, subjectName, examTitle: exam.title };
          await this.notifications.notify(
            'RESULTS_PUBLISHED',
            recipients.map((email) => ({ email, payload })),
          );
        },
        (e) => this.logger.error(`RESULTS_PUBLISHED notify failed: ${(e as Error).message}`),
      );
    }

    return { published };
  }
}
