import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { AttendanceService } from './attendance.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface TeacherDayEntry {
  periodId: string;
  label: string;
  startTime: string;
  endTime: string;
  kind: 'CLASS' | 'BREAK';
  /** null for a BREAK period, or a CLASS period the teacher does not teach. */
  slot: {
    classSectionId: string;
    className: string;
    subjectName: string;
    covering: boolean;
    coveringFor: string | null;
  } | null;
  /** null when `slot` is null. */
  register: { taken: boolean; present: number; total: number; markedBy: string | null } | null;
}

export interface TeacherDay {
  date: string;
  dayOfWeek: number;
  entries: TeacherDayEntry[];
}

/**
 * One call that answers "what is my day, and what still needs marking?".
 * The Today screen on both clients renders straight from this, so the two
 * surfaces cannot drift on which period is current or which register is open.
 */
@Injectable()
export class TeacherDayService {
  constructor(private readonly attendance: AttendanceService) {}

  async forTeacher(
    schoolId: string,
    userId: string,
    role: string,
    date: string,
  ): Promise<TeacherDay> {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    // getUTCDay() on a date-only string is timezone-stable; 0 (Sunday) maps to 7
    // so the value matches TimetableSlot.dayOfWeek's 1-7 Monday-first encoding.
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;

    const status = await this.attendance.dayStatus(schoolId, userId, role, date);
    const bySection = new Map(status.map((s) => [s.classSectionId, s]));

    const entries = await withTenant(schoolId, async (tx) => {
      const periods = await tx.period.findMany({
        where: { schoolId },
        orderBy: { order: 'asc' },
        select: { id: true, label: true, startTime: true, endTime: true, kind: true },
      });

      const teacher = await tx.teacher.findFirst({ where: { userId } });
      if (!teacher) {
        return periods.map((p) => ({
          periodId: p.id,
          label: p.label,
          startTime: p.startTime,
          endTime: p.endTime,
          kind: p.kind as 'CLASS' | 'BREAK',
          slot: null,
          register: null,
        }));
      }

      const subs = await tx.substitution.findMany({
        where: { date: new Date(date), substituteTeacherId: teacher.id },
        select: { periodId: true, classSectionId: true, originalTeacherId: true },
      });
      const subByPeriod = new Map(subs.map((s) => [s.periodId, s]));

      // One query covering both the teacher's own slots and the slots being
      // covered, rather than a query per period.
      //
      // Both conditions go under `AND` with their own nested `OR`. A sibling
      // `OR` key at the top level would silently REPLACE the version-window
      // `OR` — the same object key twice — and quietly return superseded
      // timetable versions.
      const asOf = new Date(date);
      const slots = await tx.timetableSlot.findMany({
        where: {
          dayOfWeek,
          effectiveFrom: { lte: asOf },
          AND: [
            { OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }] },
            subs.length
              ? {
                  OR: [
                    { teacherId: teacher.id },
                    {
                      periodId: { in: subs.map((s) => s.periodId) },
                      classSectionId: { in: subs.map((s) => s.classSectionId) },
                    },
                  ],
                }
              : { teacherId: teacher.id },
          ],
        },
        select: {
          periodId: true,
          classSectionId: true,
          teacherId: true,
          subject: { select: { name: true } },
          classSection: { select: { id: true, name: true, grade: { select: { name: true } } } },
        },
      });

      const originalIds = [...new Set(subs.map((s) => s.originalTeacherId))];
      const originals = originalIds.length
        ? await tx.teacher.findMany({
            where: { id: { in: originalIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const originalNames = new Map(originals.map((t) => [t.id, `${t.firstName} ${t.lastName}`]));

      const slotByPeriod = new Map<string, (typeof slots)[number]>();
      for (const s of slots) {
        const sub = subByPeriod.get(s.periodId);
        const isCover = !!sub && sub.classSectionId === s.classSectionId;
        // Own slot wins over a cover in the same period — a teacher cannot be
        // in two rooms, and their own timetable is the stronger claim.
        if (s.teacherId === teacher.id || isCover) {
          const existing = slotByPeriod.get(s.periodId);
          if (!existing || existing.teacherId !== teacher.id) slotByPeriod.set(s.periodId, s);
        }
      }

      return periods.map((p) => {
        const s = p.kind === 'BREAK' ? undefined : slotByPeriod.get(p.id);
        if (!s) {
          return {
            periodId: p.id,
            label: p.label,
            startTime: p.startTime,
            endTime: p.endTime,
            kind: p.kind as 'CLASS' | 'BREAK',
            slot: null,
            register: null,
          };
        }
        const sub = subByPeriod.get(p.id);
        const covering = s.teacherId !== teacher.id;
        const st = bySection.get(s.classSectionId);
        return {
          periodId: p.id,
          label: p.label,
          startTime: p.startTime,
          endTime: p.endTime,
          kind: p.kind as 'CLASS' | 'BREAK',
          slot: {
            classSectionId: s.classSectionId,
            className: `${s.classSection.grade.name}-${s.classSection.name}`,
            subjectName: s.subject.name,
            covering,
            coveringFor: covering && sub ? (originalNames.get(sub.originalTeacherId) ?? null) : null,
          },
          register: st
            ? { taken: st.taken, present: st.present, total: st.total, markedBy: st.markedBy }
            : { taken: false, present: 0, total: 0, markedBy: null },
        };
      });
    });

    return { date, dayOfWeek, entries };
  }
}
