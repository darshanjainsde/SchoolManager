import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { withTenant, type AttendanceStatus } from '@skoolos/db';
import { AuditService } from '../../common/audit/audit.service';
import { ApiError } from '../../common/errors/api-error';
import { formatDateIST } from '../../common/notifications/format';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveStudentRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
import { requireClassAccess } from './internal/class-access';
import { isP2002 } from './internal/prisma-errors';
import { istTodayISO } from './internal/timetable-date';
import type { SaveAttendanceDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Never let a missing School row render as `undefined` in a parent's inbox. */
const FALLBACK_SCHOOL_NAME = 'Your school';

export interface AttendanceMarkResult {
  studentId: string;
  status: AttendanceStatus;
}

export interface SaveAttendanceResult {
  saved: number;
  absentees: number;
}

export interface MyClassSection {
  classSectionId: string;
  name: string;
  studentCount: number;
  /** True when the caller holds this section only as a substitute on the queried date. */
  covering: boolean;
}

export interface ClassDayStatus {
  classSectionId: string;
  name: string;
  total: number;
  present: number;
  taken: boolean;
  markedBy: string | null;
  markedAt: string | null;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly notifications: NotificationService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The students in `classSectionId`, each paired with their stored mark for
   * `date` (an unmarked student defaults to PRESENT rather than being
   * omitted, so the teacher UI always renders one row per roster student).
   */
  async list(schoolId: string, classSectionId: string, date: string): Promise<AttendanceMarkResult[]> {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    const day = new Date(date);

    return withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { id: classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const students = await tx.student.findMany({
        where: { classSectionId },
        orderBy: [{ admissionNo: 'asc' }],
        select: { id: true },
      });

      const marks = await tx.attendance.findMany({
        where: { classSectionId, date: day },
        select: { studentId: true, status: true },
      });
      const byStudent = new Map(marks.map((m) => [m.studentId, m.status]));

      return students.map((s) => ({
        studentId: s.id,
        status: byStudent.get(s.id) ?? ('PRESENT' as AttendanceStatus),
      }));
    });
  }

  /** Shared select/mapping so `myClassSections` and `dayStatus` render the same `name`/`studentCount` for a section. */
  private static readonly CLASS_SELECT = {
    id: true,
    name: true,
    grade: { select: { name: true } },
    _count: { select: { students: true } },
  } as const;

  private static toMyClassSection(
    c: { id: string; name: string; grade: { name: string }; _count: { students: number } },
    covering = false,
  ): MyClassSection {
    return {
      classSectionId: c.id,
      name: `${c.grade.name}-${c.name}`,
      studentCount: c._count.students,
      covering,
    };
  }

  /**
   * The sections a caller may take/view attendance for on `date` (default
   * today, IST). SCHOOL_ADMIN sees every section. A TEACHER sees the sections
   * where they are the class teacher OR hold a timetable slot, PLUS any
   * section they are covering as a substitute on that specific date — a
   * substitution is a one-day grant, so it never widens access on any other
   * day.
   */
  async myClassSections(
    schoolId: string,
    userId: string,
    role: string,
    opts: { date?: string } = {},
  ): Promise<MyClassSection[]> {
    const date = opts.date ?? istTodayISO();
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }

    return withTenant(schoolId, async (tx) => {
      if (role === 'SCHOOL_ADMIN') {
        const sections = await tx.classSection.findMany({
          select: AttendanceService.CLASS_SELECT,
          orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
        });
        return sections.map((c) => AttendanceService.toMyClassSection(c));
      }

      const teacher = await tx.teacher.findFirst({ where: { userId } });
      if (!teacher) return [];

      const owned = await tx.classSection.findMany({
        where: {
          OR: [
            { classTeacherId: teacher.id },
            { timetableSlots: { some: { teacherId: teacher.id } } },
          ],
        },
        select: AttendanceService.CLASS_SELECT,
        orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
      });
      const ownedIds = new Set(owned.map((c) => c.id));

      const subs = await tx.substitution.findMany({
        where: { date: new Date(date), substituteTeacherId: teacher.id },
        select: { classSectionId: true },
      });
      const coveredIds = [...new Set(subs.map((s) => s.classSectionId))].filter(
        (id) => !ownedIds.has(id),
      );

      const covered = coveredIds.length
        ? await tx.classSection.findMany({
            where: { id: { in: coveredIds } },
            select: AttendanceService.CLASS_SELECT,
            orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
          })
        : [];

      return [
        ...owned.map((c) => AttendanceService.toMyClassSection(c, false)),
        ...covered.map((c) => AttendanceService.toMyClassSection(c, true)),
      ];
    });
  }

  /**
   * Per-class attendance status for `date`, across the caller's sections
   * (see `myClassSections`). `taken` is true once at least one Attendance
   * row exists for that section+date. When taken, `total` is the number of
   * rows actually marked that day — NOT the section's current live roster
   * count, which can drift after the fact (transfers, new admissions) and
   * would otherwise make a past day's "26/28" silently stop matching what
   * was really marked; only an untaken day falls back to the live roster
   * count (there is nothing else to report). `markedBy` resolves the
   * EARLIEST-surviving row's `markedById` to a Teacher name, falling back
   * to `'School admin'` when it does not resolve to a Teacher row — the
   * same fallback `save` uses when a SCHOOL_ADMIN caller has no linked
   * Teacher and `markedById` ends up holding their raw User.id. Because
   * `save` deletes and recreates every row on each save, only one save's
   * rows are ever alive at a time — "earliest" here means "first in the
   * current, surviving batch", i.e. the marker of the latest save, not
   * necessarily whoever marked the class first that day.
   *
   * Exactly two queries regardless of how many sections are returned: one
   * `attendance.findMany` covering every section's rows for `date` in a
   * single `classSectionId IN (...)` call, and one `teacher.findMany` for
   * the distinct `markedById`s found. This matters most for SCHOOL_ADMIN,
   * who can see every section in the school — a per-section loop there
   * would have scaled with school size instead of staying constant.
   */
  async dayStatus(
    schoolId: string,
    userId: string,
    role: string,
    date: string,
  ): Promise<ClassDayStatus[]> {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    // Pass `date` through so a past day's status includes whoever covered a
    // section as a substitute THAT day, not who is substituting today.
    const classes = await this.myClassSections(schoolId, userId, role, { date });
    if (classes.length === 0) return [];
    const day = new Date(date);
    const classSectionIds = classes.map((c) => c.classSectionId);

    return withTenant(schoolId, async (tx) => {
      const rows = await tx.attendance.findMany({
        where: { classSectionId: { in: classSectionIds }, date: day },
        select: { classSectionId: true, status: true, markedById: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });

      const bySection = new Map<string, typeof rows>();
      for (const row of rows) {
        const existing = bySection.get(row.classSectionId);
        if (existing) existing.push(row);
        else bySection.set(row.classSectionId, [row]);
      }

      // `rows` is already sorted by createdAt asc, so the first row seen
      // per section while building `bySection` above is that section's
      // earliest-surviving row.
      const markerIds = new Set<string>();
      for (const sectionRows of bySection.values()) {
        markerIds.add(sectionRows[0].markedById);
      }
      const markers =
        markerIds.size > 0
          ? await tx.teacher.findMany({
              where: { id: { in: [...markerIds] } },
              select: { id: true, firstName: true, lastName: true },
            })
          : [];
      const markerNames = new Map(markers.map((m) => [m.id, `${m.firstName} ${m.lastName}`]));

      return classes.map((c) => {
        const sectionRows = bySection.get(c.classSectionId) ?? [];
        const taken = sectionRows.length > 0;
        return {
          classSectionId: c.classSectionId,
          name: c.name,
          total: taken ? sectionRows.length : c.studentCount,
          present: sectionRows.filter((r) => r.status === 'PRESENT').length,
          taken,
          markedBy: taken
            ? (markerNames.get(sectionRows[0].markedById) ?? 'School admin')
            : null,
          markedAt: taken ? sectionRows[0].createdAt.toISOString() : null,
        };
      });
    });
  }

  /**
   * Upserts every mark for a class/date inside one tenant transaction, keyed
   * on the `one_mark_per_student_day` unique so re-submitting the same day is
   * idempotent (a second save corrects the row rather than duplicating it).
   *
   * `callerUserId` is the JWT `sub` (User.id). We resolve it to the caller's
   * Teacher.id when a Teacher row links back via `userId` — the normal case
   * for TEACHER-role callers. SCHOOL_ADMIN callers typically have no Teacher
   * row, so we fall back to storing their own User.id in `markedById`; either
   * way the column always holds a real identity for audit purposes.
   *
   * After the transaction commits, an ABSENCE_NOTICE is fired best-effort to
   * the linked-user emails of students who became ABSENT in *this* call —
   * i.e. whose stored status for the day was previously something other than
   * ABSENT (or who had no row at all). Re-saving the same roster therefore
   * never re-emails a guardian whose child was already recorded absent; the
   * de-duplication lives here, on the server, so it holds for every client.
   * Never blocks or fails this method: notification errors are logged and
   * swallowed.
   */
  async save(
    schoolId: string,
    callerUserId: string,
    dto: SaveAttendanceDto,
    callerRole = 'TEACHER',
  ): Promise<SaveAttendanceResult> {
    const day = new Date(dto.date);

    const result = await withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
      }

      const teacher = await tx.teacher.findFirst({ where: { userId: callerUserId } });

      // A SCHOOL_ADMIN may mark any section; a TEACHER may not. This is the
      // server-side twin of the client only showing their own classes —
      // without it, knowing a classSectionId was enough to write its register.
      if (callerRole !== 'SCHOOL_ADMIN') {
        await requireClassAccess(tx, callerUserId, dto.classSectionId, dto.date);
      }

      // Every mark must target a student who is actually enrolled in this
      // class section. `Student` has active RLS, so a foreign-school
      // studentId will not appear in this query at all — closing the
      // cross-tenant write hole (Attendance itself has no RLS and its
      // unique key [studentId, date] is not school-scoped).
      const roster = await tx.student.findMany({
        where: { classSectionId: dto.classSectionId },
        select: { id: true },
      });
      const rosterIds = new Set(roster.map((s) => s.id));
      for (const mark of dto.marks) {
        if (!rosterIds.has(mark.studentId)) {
          throw new ApiError(
            'VALIDATION',
            'One or more students do not belong to this class section',
            400,
          );
        }
      }

      const markedById = teacher?.id ?? callerUserId;

      // Read the marks as they stand BEFORE this save, inside the same
      // transaction as the upserts, so "was this student already absent?" is
      // answered against a consistent snapshot. Anything not in this map has
      // no stored row yet and therefore counts as newly absent. This same
      // snapshot also feeds the retake audit entry below — `markedById` is
      // selected for that purpose (unused by the newly-absent diff).
      const before = await tx.attendance.findMany({
        where: { classSectionId: dto.classSectionId, date: day },
        select: { studentId: true, status: true, markedById: true },
      });
      const previousStatus = new Map(before.map((m) => [m.studentId, m.status]));

      // The newly-absent diff and the absentee count are pure in-memory work
      // over the marks + the pre-save snapshot — no DB round-trip needed here.
      const newlyAbsent: string[] = [];
      let absentees = 0;
      for (const mark of dto.marks) {
        if (mark.status === 'ABSENT') {
          absentees += 1;
          if (previousStatus.get(mark.studentId) !== 'ABSENT') {
            newlyAbsent.push(mark.studentId);
          }
        }
      }

      // Batch the write: one delete + one insert instead of N sequential
      // upserts (a class of ~40 was 40 round-trips inside the txn). Deleting
      // this day's rows for exactly these students, then re-creating, keeps
      // the (studentId, date) uniqueness and stays idempotent.
      //
      // Two teachers retaking the same class+date concurrently can still
      // race here: both transactions read `before` as stale, both run
      // `deleteMany` (no-op the second time), and the second `createMany`
      // can lose to the unique index on (studentId, date) once the first
      // commits. Mirrors AnnouncementsService.create's isP2002 handling —
      // surface it as a 409 the client can retry, not a bare 500.
      const studentIds = dto.marks.map((m) => m.studentId);
      try {
        await tx.attendance.deleteMany({
          where: { date: day, studentId: { in: studentIds } },
        });
        await tx.attendance.createMany({
          data: dto.marks.map((mark) => ({
            schoolId,
            studentId: mark.studentId,
            classSectionId: dto.classSectionId,
            date: day,
            status: mark.status,
            markedById,
          })),
        });
      } catch (e) {
        if (isP2002(e)) {
          throw new ConflictException(
            'Attendance for this class was just taken by someone else — pull to refresh.',
          );
        }
        throw e;
      }

      // A retake: this save overwrote rows that already existed for this
      // class/date. `save`'s delete-then-recreate leaves no other trace of
      // who marked it first or what the prior counts were, so — unlike the
      // generic `PUT /manage/attendance` row the global AuditInterceptor
      // already writes for every save — this entry exists specifically to
      // preserve that "previous version" for the audit trail. Never fired
      // for a first-ever save of a day (nothing was overwritten).
      if (before.length > 0) {
        const countByStatus = (marks: { status: string }[]) => ({
          present: marks.filter((m) => m.status === 'PRESENT').length,
          absent: marks.filter((m) => m.status === 'ABSENT').length,
          late: marks.filter((m) => m.status === 'LATE').length,
          total: marks.length,
        });
        await this.audit.record({
          schoolId,
          actorUserId: callerUserId,
          action: 'ATTENDANCE_RETAKE',
          entity: 'Attendance',
          entityId: dto.classSectionId,
          meta: {
            classSectionId: dto.classSectionId,
            date: dto.date,
            previous: { ...countByStatus(before), markedById: before[0]?.markedById ?? null },
            current: { ...countByStatus(dto.marks), markedById },
          },
        });
      }

      return { saved: dto.marks.length, absentees, newlyAbsent };
    });

    const { newlyAbsent: absentStudentIds, ...response } = result;

    if (absentStudentIds.length > 0) {
      // Best-effort, after the attendance write has committed. Recipient
      // resolution and the school-name lookup run in their own transaction so
      // a transient failure there can never roll back the teacher's save.
      runInBackground(
        async () => {
          const { schoolName, recipients } = await withTenant(schoolId, async (tx) => {
            const school = await tx.school.findFirst({
              where: { id: schoolId },
              select: { name: true },
            });
            const recipients = await resolveStudentRecipients(tx, schoolId, absentStudentIds);
            return { schoolName: school?.name ?? FALLBACK_SCHOOL_NAME, recipients };
          });
          if (recipients.length === 0) return;

          // One payload PER recipient — each guardian's notice must name
          // their own child.
          await this.notifications.notify(
            'ABSENCE_NOTICE',
            recipients.map((r) => ({
              email: r.email,
              schoolId,
              payload: { schoolName, studentName: r.studentName, date: formatDateIST(day) },
            })),
          );
        },
        (e) => this.logger.error(`ABSENCE_NOTICE notify failed: ${(e as Error).message}`),
      );
    }

    return response;
  }
}
