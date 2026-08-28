import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { TeacherDay, TeacherDayEntry } from '@skoolos/types';
import { resolveAsOfDate } from './internal/timetable-date';
import { ApiError } from '../../common/errors/api-error';
import { AttendanceService } from './attendance.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type { TeacherDay, TeacherDayEntry };

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

      const teacher = await tx.teacher.findFirst({ where: { schoolId, userId } });
      if (!teacher) {
        return periods.map((p): TeacherDayEntry => ({
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
        where: { schoolId, date: new Date(date), substituteTeacherId: teacher.id },
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
      // Anchor to IST midnight like every other timetable consumer (effectiveFrom
      // is only written via startOfIstDay), so future backfills can't drift this
      // query out of sync with listForClass and listForTeacher.
      const asOf = resolveAsOfDate(date, new Date());
      const slots = await tx.timetableSlot.findMany({
        where: { schoolId,
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
          subject: { select: { id: true, name: true } },
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

      return periods.map((p): TeacherDayEntry => {
        const s = p.kind === 'BREAK' ? undefined : slotByPeriod.get(p.id);
        if (!s) {
          return {
            periodId: p.id,
            label: p.label,
            startTime: p.startTime,
            endTime: p.endTime,
            // Non-break period the teacher holds no class in → a FREE period.
            kind: p.kind === 'BREAK' ? 'BREAK' : 'FREE',
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
          kind: 'CLASS',
          slot: {
            classSectionId: s.classSectionId,
            className: `${s.classSection.grade.name}-${s.classSection.name}`,
            subjectId: s.subject.id,
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
