import { Injectable } from '@nestjs/common';
import { withTenant, type AttendanceStatus } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import type { SaveAttendanceDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
   * Notification (Task 5: emailing absentee parents) is deliberately NOT
   * triggered here — this method only computes and returns the `absentees`
   * count so a notification hook can be added later without reworking the
   * save logic itself.
   */
  async save(
    schoolId: string,
    callerUserId: string,
    dto: SaveAttendanceDto,
  ): Promise<SaveAttendanceResult> {
    const day = new Date(dto.date);

    return withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { id: dto.classSectionId } });
      if (!section) {
        throw new ApiError('CLASS_NOT_FOUND', 'classSectionId not found', 404, 'classSectionId');
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
  }
}
