import { Injectable, Logger } from '@nestjs/common';
import { Prisma, withTenant } from '@skoolos/db';
import {
  assertNotificationOutboxKind,
  type Exam,
  type ExamList,
  type NotificationOutboxKind,
  type PublishResultsResponse,
  type SavedResult,
  type SaveResultsResponse,
} from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { formatDateTimeIST } from '../../common/notifications/format';
import { NotificationService } from '../../common/notifications/notification.service';
import { emitNotifications, sectionStudentUserIds } from '../../common/notifications/notification-inbox';
import type {
  ExamScheduledOutboxPayload,
  ResultPublishedOutboxPayload,
} from '../../common/notifications/notification.types';
import { resolveSectionRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
import { AttendanceService } from './attendance.service';
import type { CreateExamDto, SaveExamResultsDto } from './management.dto';

/**
 * Push for TEST_SCHEDULED/RESULTS_PUBLISHED now flows EXCLUSIVELY through the
 * transactional `NotificationOutbox` (written inside the same tx below, drained
 * by `NotificationOutboxService`) — never through this module's own
 * best-effort, post-commit `notifications.notify()` call. Passing this to
 * `notify()`'s `onlyChannels` keeps email's existing best-effort behaviour
 * unchanged while stopping `PushChannel` from ALSO firing immediately, which
 * would otherwise double-notify a family's phone for the same event (see
 * `NotificationService.notify`'s docstring).
 */
const EMAIL_ONLY = ['email'] as const;

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

export type { Exam, ExamList, PublishResultsResponse, SavedResult, SaveResultsResponse };

/** Raw `Exam` row shape as Prisma returns it — `scheduledAt`/`createdAt` still `Date`. */
type ExamRow = {
  id: string;
  classSectionId: string;
  subjectId: string;
  title: string;
  scheduledAt: Date;
  syllabus: string | null;
  maxMarks: number;
  createdById: string;
  createdAt: Date;
};

/** Raw `Result` row shape as Prisma returns it — `publishedAt` still `Date | null`. */
type ResultRow = { studentId: string; marks: number; publishedAt: Date | null };

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly attendance: AttendanceService,
  ) {}

  /**
   * A TEACHER caller may only act on a class section they actually teach —
   * the SAME rule `AnnouncementsService.create` enforces for broadcast
   * rights, reused here via `AttendanceService.myClassSections` (the SAME
   * ownership query `attendance.service.ts`/`announcements.service.ts`
   * already use) rather than a fourth copy of the ownership predicate.
   *
   * `covering` rows are dropped before checking: a one-day substitute does
   * not schedule tests, enter marks, or publish results for a class they
   * cover once (announcements applies the identical exclusion for the same
   * reason). SCHOOL_ADMIN (the only other role `RolesGuard` admits to
   * `ExamsController`) is exempt and always passes.
   *
   * Throws `ApiError('CLASS_NOT_OWNED', ..., 403)` — never returns a
   * boolean, so a caller cannot forget to branch on it.
   */
  private async assertClassOwned(
    schoolId: string,
    userId: string,
    role: string,
    classSectionId: string,
    action: string,
  ): Promise<void> {
    if (role !== 'TEACHER') return;
    const mine = (await this.attendance.myClassSections(schoolId, userId, role)).filter(
      (c) => !c.covering,
    );
    const owned = new Set(mine.map((c) => c.classSectionId));
    if (!owned.has(classSectionId)) {
      throw new ApiError(
        'CLASS_NOT_OWNED',
        `You can only ${action} your own classes.`,
        403,
        'classSectionId',
      );
    }
  }

  /**
   * Loads just enough of an Exam row to resolve TEACHER ownership BEFORE the
   * caller-visible mutation/read below runs its own transaction. `Exam`
   * carries no RLS, so scoping by `{ id, schoolId }` is load-bearing — a
   * foreign-school examId 404s here, before ownership is ever checked
   * against it.
   *
   * Deliberately a SEPARATE `withTenant` call rather than reusing the tx the
   * caller opens next: `AttendanceService.myClassSections` (called from
   * `assertClassOwned` between this and the caller's own transaction) opens
   * its OWN `withTenant`, and Prisma's interactive transactions cannot be
   * nested inside one another without risking a pool-exhaustion deadlock —
   * the same reason `AnnouncementsService.create` and `TeacherDayService`
   * call `AttendanceService` methods outside of, never inside, their own
   * `withTenant` blocks.
   */
  private async loadExamForOwnership(
    schoolId: string,
    examId: string,
  ): Promise<{ classSectionId: string }> {
    const exam = await withTenant(schoolId, (tx) =>
      tx.exam.findFirst({ where: { id: examId, schoolId } }),
    );
    if (!exam) {
      throw new ApiError('NOT_FOUND', 'exam not found', 404, 'id');
    }
    return exam;
  }

  /**
   * Prisma types `scheduledAt`/`createdAt` as `Date`; the shared `Exam`
   * contract (`@skoolos/types`) types them as ISO strings — the shape every
   * consumer (web, mobile) actually receives once Nest's JSON serializer
   * runs `Date.prototype.toJSON`. Converting here makes the service's own
   * return type match the wire contract instead of leaving the two silently
   * out of sync (mirrors HolidaysService.toRow).
   */
  private static toExam(e: ExamRow): Exam {
    return {
      id: e.id,
      classSectionId: e.classSectionId,
      subjectId: e.subjectId,
      title: e.title,
      scheduledAt: e.scheduledAt.toISOString(),
      syllabus: e.syllabus,
      maxMarks: e.maxMarks,
      createdById: e.createdById,
      createdAt: e.createdAt.toISOString(),
    };
  }

  private static toSavedResult(r: ResultRow): SavedResult {
    return {
      studentId: r.studentId,
      marks: r.marks,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
    };
  }

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
   *
   * A TEACHER caller may only target a class section they own (see
   * `assertClassOwned`) — otherwise any teacher who learns another class's
   * UUID could schedule an exam for it, which fans out a TEST_SCHEDULED
   * email to that class's students/guardians.
   */
  async create(
    schoolId: string,
    callerUserId: string,
    role: string,
    dto: CreateExamDto,
  ): Promise<Exam> {
    if (!Number.isInteger(dto.maxMarks) || dto.maxMarks <= 0) {
      throw new ApiError('VALIDATION', 'maxMarks must be a positive integer', 400, 'maxMarks');
    }
    await this.assertClassOwned(schoolId, callerUserId, role, dto.classSectionId, 'schedule an exam for');

    const exam = await withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { schoolId, id: dto.classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const created = await tx.exam.create({
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

      // Transactional outbox (S6/S7 wiring, decided in the pitch: "publishing
      // ... writes one row to a small NotificationOutbox table inside the
      // same transaction, and a cron worker drains it"). Written IN THIS SAME
      // `withTenant` transaction as the `Exam` row above — if anything past
      // this point throws, Prisma rolls the whole transaction back and this
      // row is never written either, so a scheduled exam is never visible
      // without its outbox row (see exams.service.spec.ts's rollback test).
      // Every field is resolved to a display string HERE, not at drain time,
      // so `NotificationOutboxService` never has to join back to
      // Subject/ClassSection to render a push (see the payload's own type).
      const [school, subject] = await Promise.all([
        tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
        tx.subject.findFirst({ where: { id: dto.subjectId, schoolId }, select: { name: true } }),
      ]);
      const kind: NotificationOutboxKind = 'EXAM_SCHEDULED';
      assertNotificationOutboxKind(kind);
      const outboxPayload: ExamScheduledOutboxPayload = {
        schoolName: school?.name ?? FALLBACK_SCHOOL_NAME,
        subjectName: subject?.name ?? FALLBACK_SUBJECT_NAME,
        examTitle: created.title,
        scheduledAt: formatDateTimeIST(new Date(created.scheduledAt)),
        classSectionName: section.name,
        maxMarks: created.maxMarks,
      };
      await tx.notificationOutbox.create({
        data: {
          schoolId,
          kind,
          classSectionId: dto.classSectionId,
          payload: outboxPayload as unknown as Prisma.InputJsonValue,
        },
      });

      // In-app inbox rows (the bell) for every student in the section who has a
      // login — same transaction as the exam + outbox row above.
      const examRecipients = await sectionStudentUserIds(tx, schoolId, dto.classSectionId);
      await emitNotifications(tx, {
        schoolId,
        userIds: examRecipients,
        kind: 'EXAM',
        title: `New test: ${created.title}`,
        body: `${subject?.name ?? FALLBACK_SUBJECT_NAME} · ${formatDateTimeIST(new Date(created.scheduledAt))}`,
        linkType: 'exam',
        linkId: created.id,
      });

      return created;
    });

    // Best-effort EMAIL only (see EMAIL_ONLY docstring above) — push for this
    // event is the guaranteed outbox row written above, not this call. Runs
    // after the write has committed and never blocks or fails exam creation.
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
          scheduledAt: formatDateTimeIST(new Date(exam.scheduledAt)),
        };
        await this.notifications.notify(
          'TEST_SCHEDULED',
          recipients.map((email) => ({ email, schoolId, payload })),
          EMAIL_ONLY,
        );
      },
      (e) => this.logger.error(`TEST_SCHEDULED notify failed: ${(e as Error).message}`),
    );

    return ExamsService.toExam(exam);
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
   *
   * A TEACHER caller may only list exams for a class section they own (see
   * `assertClassOwned`) — otherwise any teacher who learns another class's
   * UUID could enumerate its scheduled/past exams.
   */
  async list(
    schoolId: string,
    classSectionId: string,
    callerUserId: string,
    role: string,
  ): Promise<ExamList> {
    await this.assertClassOwned(schoolId, callerUserId, role, classSectionId, 'view exams for');
    return withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { schoolId, id: classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const exams = await tx.exam.findMany({
        where: { schoolId, classSectionId },
        orderBy: [{ scheduledAt: 'asc' }],
      });

      const now = new Date();
      const upcoming: Exam[] = [];
      const past: Exam[] = [];
      for (const exam of exams) {
        // Split on the raw Date before converting to the wire's ISO-string shape.
        if (exam.scheduledAt >= now) {
          upcoming.push(ExamsService.toExam(exam));
        } else {
          past.push(ExamsService.toExam(exam));
        }
      }

      return { upcoming, past };
    });
  }

  /**
   * The marks already stored for an exam, so the results-entry screen can
   * prefill rather than showing a fully-marked exam as blank (which invites a
   * teacher to re-key every mark).
   *
   * `Exam`/`Result` carry no RLS, so loading the exam via `{ id, schoolId }`
   * is load-bearing: a foreign exam id must 404 rather than leak another
   * school's marks. Students with no stored mark are simply absent from the
   * array — the caller pairs it against the roster it already has.
   *
   * A TEACHER caller may only view results for an exam whose STORED
   * `classSectionId` they own (see `assertClassOwned` / `loadExamForOwnership`)
   * — resolved from the exam row itself, since this endpoint takes no
   * classSectionId a caller could otherwise try to substitute in.
   */
  async results(
    schoolId: string,
    examId: string,
    callerUserId: string,
    role: string,
  ): Promise<SavedResult[]> {
    const owning = await this.loadExamForOwnership(schoolId, examId);
    await this.assertClassOwned(schoolId, callerUserId, role, owning.classSectionId, 'view results for');

    return withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, schoolId } });
      if (!exam) {
        throw new ApiError('NOT_FOUND', 'exam not found', 404, 'id');
      }

      const rows = await tx.result.findMany({
        where: { schoolId, examId },
        select: { studentId: true, marks: true, publishedAt: true },
        orderBy: [{ studentId: 'asc' }],
      });
      return rows.map(ExamsService.toSavedResult);
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
   *
   * A TEACHER caller may only enter results for an exam whose STORED
   * `classSectionId` they own (see `assertClassOwned` / `loadExamForOwnership`)
   * — resolved from the exam row itself, never from any caller input, so a
   * teacher cannot bypass ownership by supplying a different
   * classSectionId (this endpoint doesn't even accept one).
   */
  async saveResults(
    schoolId: string,
    examId: string,
    dto: SaveExamResultsDto,
    callerUserId: string,
    role: string,
  ): Promise<SaveResultsResponse> {
    const owning = await this.loadExamForOwnership(schoolId, examId);
    await this.assertClassOwned(schoolId, callerUserId, role, owning.classSectionId, 'enter results for');

    return withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, schoolId } });
      if (!exam) {
        throw new ApiError('NOT_FOUND', 'exam not found', 404, 'id');
      }

      const roster = await tx.student.findMany({
        where: { schoolId, classSectionId: exam.classSectionId },
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
          // `schoolId` is the tenant's own id, never anything derived from
          // caller input — `Result` carries it directly since
          // 20260825090000_result_tenancy_and_fk_indexes, and its RLS policy
          // now compares that column rather than walking to Exam.
          create: { schoolId, examId, studentId: mark.studentId, marks: mark.marks },
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
   *
   * A TEACHER caller may only publish results for an exam whose STORED
   * `classSectionId` they own (see `assertClassOwned` / `loadExamForOwnership`)
   * — resolved from the exam row itself, never from any caller input.
   */
  async publish(
    schoolId: string,
    examId: string,
    callerUserId: string,
    role: string,
  ): Promise<PublishResultsResponse> {
    const owning = await this.loadExamForOwnership(schoolId, examId);
    await this.assertClassOwned(schoolId, callerUserId, role, owning.classSectionId, 'publish results for');

    const { published, exam } = await withTenant(schoolId, async (tx) => {
      const exam = await tx.exam.findFirst({ where: { id: examId, schoolId } });
      if (!exam) {
        throw new ApiError('NOT_FOUND', 'exam not found', 404, 'id');
      }

      const { count } = await tx.result.updateMany({
        where: { schoolId, examId },
        data: { publishedAt: new Date() },
      });

      // Transactional outbox (S6/S7 wiring) — see create()'s matching
      // comment for why this write must live INSIDE this same transaction.
      // Gated on `count > 0`, mirroring the existing best-effort email gate
      // below: publishing against an exam with no saved Results yet must not
      // queue a push telling parents results are out.
      if (count > 0) {
        const [school, subject, section] = await Promise.all([
          tx.school.findFirst({ where: { id: schoolId }, select: { name: true } }),
          tx.subject.findFirst({ where: { id: exam.subjectId, schoolId }, select: { name: true } }),
          tx.classSection.findFirst({
            where: { id: exam.classSectionId, schoolId },
            select: { name: true },
          }),
        ]);
        const kind: NotificationOutboxKind = 'RESULT_PUBLISHED';
        assertNotificationOutboxKind(kind);
        const outboxPayload: ResultPublishedOutboxPayload = {
          schoolName: school?.name ?? FALLBACK_SCHOOL_NAME,
          subjectName: subject?.name ?? FALLBACK_SUBJECT_NAME,
          examTitle: exam.title,
          classSectionName: section?.name ?? '',
          maxMarks: exam.maxMarks,
        };
        await tx.notificationOutbox.create({
          data: {
            schoolId,
            kind,
            classSectionId: exam.classSectionId,
            payload: outboxPayload as unknown as Prisma.InputJsonValue,
          },
        });

        // In-app inbox rows (the bell) for the section's linked students —
        // same transaction, gated on count > 0 like the outbox row above.
        const resultRecipients = await sectionStudentUserIds(tx, schoolId, exam.classSectionId);
        await emitNotifications(tx, {
          schoolId,
          userIds: resultRecipients,
          kind: 'RESULT',
          title: `Result published: ${exam.title}`,
          body: subject?.name ?? FALLBACK_SUBJECT_NAME,
          linkType: 'result',
          linkId: examId,
        });
      }

      return { published: count, exam };
    });

    // Nothing was actually published (no Results saved for this exam yet) —
    // telling parents results are out would be a lie.
    if (published > 0) {
      // Best-effort EMAIL only (see EMAIL_ONLY docstring above) — push for
      // this event is the guaranteed outbox row written above, not this
      // call. Runs after the write has committed and never blocks or fails
      // publishing.
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
            recipients.map((email) => ({ email, schoolId, payload })),
            EMAIL_ONLY,
          );
        },
        (e) => this.logger.error(`RESULTS_PUBLISHED notify failed: ${(e as Error).message}`),
      );
    }

    return { published };
  }
}
