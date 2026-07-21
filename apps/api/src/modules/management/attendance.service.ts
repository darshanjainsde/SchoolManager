import { Injectable, Logger } from '@nestjs/common';
import { withTenant, type AttendanceStatus } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
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
   * the linked-user emails of students marked ABSENT in this call only
   * (not the whole roster) — see `resolveStudentRecipients`. Never blocks or
   * fails this method: notification errors are logged and swallowed.
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

      let absentees = 0;
      for (const mark of dto.marks) {
        await tx.attendance.upsert({
          where: { one_mark_per_student_day: { studentId: mark.studentId, date: day } },
          create: {
            schoolId,
            studentId: mark.studentId,
            classSectionId: dto.classSectionId,
            date: day,
            status: mark.status,
            markedById,
          },
          update: {
            classSectionId: dto.classSectionId,
            status: mark.status,
            markedById,
          },
        });
        if (mark.status === 'ABSENT') absentees += 1;
      }

      return { saved: dto.marks.length, absentees };
    });

    const absentStudentIds = dto.marks.filter((m) => m.status === 'ABSENT').map((m) => m.studentId);

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
              payload: { schoolName, studentName: r.studentName, date: dto.date },
            })),
          );
        },
        (e) => this.logger.error(`ABSENCE_NOTICE notify failed: ${(e as Error).message}`),
      );
    }

    return result;
  }
}
