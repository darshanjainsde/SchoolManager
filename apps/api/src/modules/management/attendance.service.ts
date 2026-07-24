import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type AttendanceStatus } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { formatDateIST } from '../../common/notifications/format';
import { NotificationService } from '../../common/notifications/notification.service';
import { resolveStudentRecipients } from '../../common/notifications/recipients';
import { runInBackground } from '../../common/notifications/run-in-background';
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

  constructor(private readonly notifications: NotificationService) {}

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

  private static toMyClassSection(c: {
    id: string;
    name: string;
    grade: { name: string };
    _count: { students: number };
  }): MyClassSection {
    return {
      classSectionId: c.id,
      name: `${c.grade.name}-${c.name}`,
      studentCount: c._count.students,
    };
  }

  /**
   * The sections a caller may take/view attendance for. SCHOOL_ADMIN sees
   * every section in the school; a TEACHER sees the sections where they are
   * the class teacher OR hold at least one timetable slot — the Prisma `OR`
   * naturally dedupes a section that satisfies both.
   */
  async myClassSections(
    schoolId: string,
    userId: string,
    role: string,
  ): Promise<MyClassSection[]> {
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

      const sections = await tx.classSection.findMany({
        where: {
          OR: [
            { classTeacherId: teacher.id },
            { timetableSlots: { some: { teacherId: teacher.id } } },
          ],
        },
        select: AttendanceService.CLASS_SELECT,
        orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
      });
      return sections.map((c) => AttendanceService.toMyClassSection(c));
    });
  }

  /**
   * Per-class attendance status for `date`, across the caller's sections
   * (see `myClassSections`). `taken` is true once at least one Attendance
   * row exists for that section+date; `markedBy` resolves the EARLIEST
   * row's `markedById` to a Teacher name, falling back to `'School admin'`
   * when it does not resolve to a Teacher row — the same fallback `save`
   * uses when a SCHOOL_ADMIN caller has no linked Teacher and `markedById`
   * ends up holding their raw User.id.
   *
   * One `attendance.findMany` plus (at most) one `teacher.findFirst` per
   * class section — an N+1 loop, but bounded by how many sections a single
   * teacher or admin realistically works with in a day (~2-8), so left as
   * straightforward per-class queries rather than a batched lookup.
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
    const classes = await this.myClassSections(schoolId, userId, role);
    const day = new Date(date);

    return withTenant(schoolId, async (tx) => {
      const out: ClassDayStatus[] = [];
      for (const c of classes) {
        const rows = await tx.attendance.findMany({
          where: { classSectionId: c.classSectionId, date: day },
          select: { status: true, markedById: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        });

        let markedBy: string | null = null;
        let markedAt: string | null = null;
        if (rows.length > 0) {
          markedAt = rows[0].createdAt.toISOString();
          const marker = await tx.teacher.findFirst({
            where: { id: rows[0].markedById },
            select: { firstName: true, lastName: true },
          });
          markedBy = marker ? `${marker.firstName} ${marker.lastName}` : 'School admin';
        }

        out.push({
          classSectionId: c.classSectionId,
          name: c.name,
          total: c.studentCount,
          present: rows.filter((r) => r.status === 'PRESENT').length,
          taken: rows.length > 0,
          markedBy,
          markedAt,
        });
      }
      return out;
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
  ): Promise<SaveAttendanceResult> {
    const day = new Date(dto.date);

    const result = await withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
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

      const teacher = await tx.teacher.findFirst({ where: { userId: callerUserId } });
      const markedById = teacher?.id ?? callerUserId;

      // Read the marks as they stand BEFORE this save, inside the same
      // transaction as the upserts, so "was this student already absent?" is
      // answered against a consistent snapshot. Anything not in this map has
      // no stored row yet and therefore counts as newly absent.
      const before = await tx.attendance.findMany({
        where: { classSectionId: dto.classSectionId, date: day },
        select: { studentId: true, status: true },
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
      const studentIds = dto.marks.map((m) => m.studentId);
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
