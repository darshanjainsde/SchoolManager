import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import { istTodayISO } from '../../management';
import type { SaveHallVisitDto } from './library.dto';
import { LIST_CEILING } from '../../../common/lists/list-ceiling';

const TIME_ZONE = 'Asia/Kolkata';

/** `HH:MM` right now in IST — the format `Period.startTime/endTime` use. */
function istNowHM(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/** Monday-first 1–7, matching `TimetableSlot.dayOfWeek`. */
function dayOfWeekFor(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay() || 7;
}

export interface HallRosterRow {
  studentId: string;
  name: string;
  rollNo: string | null;
  status: 'PRESENT' | 'ABSENT' | 'LATE';
}

/**
 * The Hall tab: which class is in the library right now (timetable slots
 * whose SUBJECT is named "library" — the convention schools already use to
 * put a library period on the timetable), the class-teacher register for the
 * day (to confirm), and the librarian's own saved visit (SYNCED/RETAKEN).
 */
@Injectable()
export class LibraryHallService {
  async today(schoolId: string, opts: { date?: string; classSectionId?: string }) {
    const dateISO = opts.date ?? istTodayISO();
    const date = new Date(`${dateISO}T00:00:00.000Z`);
    const nowHM = istNowHM();
    const dayOfWeek = dayOfWeekFor(dateISO);
    const asOf = new Date(`${dateISO}T00:00:00+05:30`);

    return withTenant(schoolId, async (tx) => {
      const periods = await tx.period.findMany({ take: LIST_CEILING.STRUCTURE,
        orderBy: { order: 'asc' },
        select: { id: true, label: true, startTime: true, endTime: true, kind: true },
      });
      const currentPeriod =
        periods.find((p) => p.kind === 'CLASS' && p.startTime <= nowHM && nowHM < p.endTime) ?? null;

      // Every library period scheduled today (for the "hall in use N of M" meter),
      // and the one happening right now.
      const librarySlots = await tx.timetableSlot.findMany({ take: LIST_CEILING.ACTIVITY,
        where: { schoolId,
          dayOfWeek,
          subject: { name: { contains: 'librar', mode: 'insensitive' } },
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        },
        select: {
          periodId: true,
          classSection: { select: { id: true, name: true, grade: { select: { name: true } } } },
        },
      });
      const nowSlots = currentPeriod
        ? librarySlots.filter((s) => s.periodId === currentPeriod.id)
        : [];

      // The class whose register we show: an explicit pick wins, else the
      // first class scheduled in the hall right now.
      const sectionId = opts.classSectionId ?? nowSlots[0]?.classSection.id ?? null;

      let section: { id: string; name: string; className: string } | null = null;
      let roster: HallRosterRow[] = [];
      let teacherRegister: { taken: boolean; takenBy: string | null; takenAt: string | null } = {
        taken: false,
        takenBy: null,
        takenAt: null,
      };
      let savedVisit: { source: 'SYNCED' | 'RETAKEN'; savedAt: string } | null = null;

      if (sectionId) {
        const sec = await tx.classSection.findFirst({
          where: { id: sectionId },
          select: { id: true, name: true, grade: { select: { name: true } } },
        });
        if (!sec) throw new ApiError('CLASS_NOT_FOUND', 'No such class.', 404);
        section = { id: sec.id, name: sec.name, className: `${sec.grade.name}${sec.name}` };

        const [students, marks, visit] = await Promise.all([
          tx.student.findMany({ take: LIST_CEILING.ROSTER,
            where: { schoolId, classSectionId: sectionId, isActive: true },
            orderBy: [{ rollNo: 'asc' }, { firstName: 'asc' }],
            select: { id: true, firstName: true, lastName: true, rollNo: true },
          }),
          tx.attendance.findMany({ take: LIST_CEILING.ACTIVITY,
            where: { schoolId, classSectionId: sectionId, date },
            select: { studentId: true, status: true, markedById: true, createdAt: true },
          }),
          tx.libraryHallVisit.findUnique({
            where: { schoolId_classSectionId_date: { schoolId, classSectionId: sectionId, date } },
            include: { marks: true },
          }),
        ]);

        if (marks.length) {
          const first = marks.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
          // `markedById` is usually a Teacher.id; an admin's own User.id is the
          // documented fallback (see AttendanceService), hence 'School admin'.
          const marker = await tx.teacher.findFirst({
            where: { id: first.markedById },
            select: { firstName: true, lastName: true },
          });
          teacherRegister = {
            taken: true,
            takenBy: marker ? `${marker.firstName} ${marker.lastName}`.trim() : 'School admin',
            takenAt: first.createdAt.toISOString(),
          };
        }
        if (visit) {
          savedVisit = { source: visit.source, savedAt: visit.createdAt.toISOString() };
        }

        // Status precedence: the librarian's saved visit > the teacher's
        // register > default PRESENT (the same default the register UI uses).
        const teacherByStudent = new Map(marks.map((m) => [m.studentId, m.status]));
        const visitByStudent = new Map((visit?.marks ?? []).map((m) => [m.studentId, m.status]));
        roster = students.map((s) => ({
          studentId: s.id,
          name: `${s.firstName} ${s.lastName}`.trim(),
          rollNo: s.rollNo,
          status: (visitByStudent.get(s.id) ?? teacherByStudent.get(s.id) ?? 'PRESENT') as
            | 'PRESENT'
            | 'ABSENT'
            | 'LATE',
        }));
      }

      const [settingsRow, sections] = await Promise.all([
        tx.librarySettings.findUnique({ where: { schoolId }, select: { hallCapacityClasses: true } }),
        tx.classSection.findMany({ take: LIST_CEILING.STRUCTURE,
          orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
          select: { id: true, name: true, grade: { select: { name: true } } },
        }),
      ]);

      return {
        date: dateISO,
        period: currentPeriod
          ? { id: currentPeriod.id, label: currentPeriod.label, startTime: currentPeriod.startTime, endTime: currentPeriod.endTime }
          : null,
        hall: {
          capacityClasses: settingsRow?.hallCapacityClasses ?? 2,
          inUse: nowSlots.length,
          nowClasses: nowSlots.map((s) => ({
            id: s.classSection.id,
            className: `${s.classSection.grade.name}${s.classSection.name}`,
          })),
        },
        section,
        roster,
        teacherRegister,
        savedVisit,
        sections: sections.map((s) => ({ id: s.id, className: `${s.grade.name}${s.name}` })),
      };
    });
  }

  /** Save (or overwrite) the day's library register for a class. */
  async saveVisit(schoolId: string, librarianUserId: string, dto: SaveHallVisitDto) {
    const dateISO = dto.date ?? istTodayISO();
    const date = new Date(`${dateISO}T00:00:00.000Z`);
    return withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({
        where: { id: dto.classSectionId },
        select: { id: true },
      });
      if (!section) throw new ApiError('CLASS_NOT_FOUND', 'No such class.', 404);

      const rosterIds = new Set(
        (
          await tx.student.findMany({ take: LIST_CEILING.ROSTER,
            where: { schoolId, classSectionId: dto.classSectionId, isActive: true },
            select: { id: true },
          })
        ).map((s) => s.id),
      );
      const foreign = dto.marks.filter((m) => !rosterIds.has(m.studentId));
      if (foreign.length) {
        throw new ApiError('VALIDATION', 'Some marks are for students outside this class.', 400);
      }

      const visit = await tx.libraryHallVisit.upsert({
        where: { schoolId_classSectionId_date: { schoolId, classSectionId: dto.classSectionId, date } },
        create: {
          schoolId,
          classSectionId: dto.classSectionId,
          date,
          periodId: dto.periodId ?? null,
          source: dto.source,
          savedById: librarianUserId,
        },
        update: { source: dto.source, savedById: librarianUserId, periodId: dto.periodId ?? null },
      });
      await tx.libraryHallMark.deleteMany({ where: { schoolId, visitId: visit.id } });
      await tx.libraryHallMark.createMany({
        data: dto.marks.map((m) => ({
          schoolId,
          visitId: visit.id,
          studentId: m.studentId,
          status: m.status,
        })),
      });
      return {
        ok: true,
        saved: dto.marks.length,
        present: dto.marks.filter((m) => m.status === 'PRESENT').length,
        source: dto.source,
      };
    });
  }
}
