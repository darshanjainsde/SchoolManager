import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { ClassTeacherDesk, ClassTeacherRow } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { LIST_CEILING } from '../../common/lists/list-ceiling';

/**
 * CLASS TEACHERS — the one desk that says who owns each section.
 *
 * The live answer stays `ClassSection.classTeacherId`, which is what every
 * existing rule already reads: who may take a section's attendance, who may
 * write its class notes, whose name signs its report cards, who a family
 * reaches when the Complaint Box routes to "my class teacher". This service
 * does not invent a second truth — it makes the one truth VISIBLE and
 * governable, and keeps a dated record of every change beside it.
 *
 * Two rules worth stating because they are judgement calls, not accidents:
 *
 *  · ONE TEACHER MAY HOLD TWO SECTIONS. A ninety-child school does it every
 *    year. So a second section is a WARNING the screen says out loud
 *    (`alsoHolds`), never a refusal.
 *  · A TEACHER WHO HAS LEFT CANNOT BE CHOSEN, and the year-start copy drops
 *    them rather than carrying a ghost into the new session.
 */
@Injectable()
export class ClassTeachersService {
  /** The desk: every section of one session, with its teacher and the facts around it. */
  async desk(schoolId: string, academicYearId?: string): Promise<ClassTeacherDesk> {
    return withTenant(schoolId, async (tx) => {
      const year = academicYearId
        ? await tx.academicYear.findFirst({ where: { id: academicYearId, schoolId }, select: { id: true, name: true } })
        : await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true, name: true } });
      if (!year) {
        return { academicYear: null, rows: [], teachers: [], counts: { sections: 0, assigned: 0, unassigned: 0, holdingMoreThanOne: 0 }, previousYear: null };
      }

      const [sections, teachers, previous] = await Promise.all([
        tx.classSection.findMany({
          where: { schoolId, academicYearId: year.id },
          take: LIST_CEILING.STRUCTURE,
          select: {
            id: true, name: true, classTeacherId: true,
            grade: { select: { name: true, order: true } },
            _count: { select: { students: true } },
          },
          orderBy: [{ grade: { order: 'asc' } }, { name: 'asc' }],
        }),
        tx.teacher.findMany({
          where: { schoolId, status: 'ACTIVE' },
          take: LIST_CEILING.ROSTER,
          select: { id: true, firstName: true, lastName: true },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        }),
        tx.academicYear.findFirst({
          where: { schoolId, id: { not: year.id } },
          select: { id: true, name: true, startDate: true },
          orderBy: { startDate: 'desc' },
        }),
      ]);

      const label = (s: { name: string; grade: { name: string } }) => `${s.grade.name} ${s.name}`.trim();
      const held = new Map<string, string[]>();
      for (const s of sections) {
        if (!s.classTeacherId) continue;
        held.set(s.classTeacherId, [...(held.get(s.classTeacherId) ?? []), label(s)]);
      }
      const name = (t: { firstName: string; lastName: string }) => `${t.firstName} ${t.lastName}`.trim();
      const byId = new Map(teachers.map((t) => [t.id, t]));

      const rows: ClassTeacherRow[] = sections.map((s) => {
        const t = s.classTeacherId ? byId.get(s.classTeacherId) : null;
        return {
          classSectionId: s.id,
          label: label(s),
          gradeName: s.grade.name,
          sectionName: s.name,
          gradeOrder: s.grade.order,
          students: s._count.students,
          // A teacher who has LEFT stays on the section in the database (the
          // column is SetNull only on delete) but must not read as a live
          // owner — the row shows unassigned, which is what it is.
          teacher: t ? { id: t.id, name: name(t) } : null,
          alsoHolds: (held.get(s.classTeacherId ?? '') ?? []).filter((l) => l !== label(s)),
        };
      });

      const assigned = rows.filter((r) => r.teacher).length;
      const previousAssigned = previous
        ? await tx.classSection.count({ where: { schoolId, academicYearId: previous.id, classTeacherId: { not: null } } })
        : 0;

      return {
        academicYear: year,
        rows,
        teachers: teachers.map((t) => ({ id: t.id, name: name(t), sections: held.get(t.id) ?? [] })),
        counts: {
          sections: rows.length,
          assigned,
          unassigned: rows.length - assigned,
          holdingMoreThanOne: [...held.values()].filter((v) => v.length > 1).length,
        },
        previousYear: previous && previousAssigned > 0 ? { id: previous.id, name: previous.name, assigned: previousAssigned } : null,
      };
    });
  }

  /** Assign, move or clear one section's class teacher, and date the change. */
  async assign(schoolId: string, classSectionId: string, teacherId: string | null, byUserId: string): Promise<ClassTeacherRow> {
    await withTenant(schoolId, async (tx) => {
      const section = await tx.classSection.findFirst({ where: { id: classSectionId, schoolId }, select: { id: true, classTeacherId: true, academicYearId: true } });
      if (!section) throw new ApiError('NOT_FOUND', 'That class is not in this school.', 404, 'classSectionId');
      if (teacherId) {
        const teacher = await tx.teacher.findFirst({ where: { id: teacherId, schoolId }, select: { id: true, status: true } });
        if (!teacher) throw new ApiError('NOT_FOUND', 'That teacher is not in this school.', 404, 'teacherId');
        if (teacher.status !== 'ACTIVE') {
          throw new ApiError('VALIDATION', 'That teacher has left the school. Pick a teacher who is still here.', 400, 'teacherId');
        }
      }
      if (section.classTeacherId === teacherId) return;

      const now = new Date();
      // Close the standing record before opening the next one, so the history
      // reads as a sequence rather than a set of overlapping claims.
      await tx.classTeacherAssignment.updateMany({
        where: { schoolId, classSectionId, untilAt: null },
        data: { untilAt: now },
      });
      if (teacherId) {
        await tx.classTeacherAssignment.create({
          data: { schoolId, classSectionId, teacherId, fromAt: now, changedById: byUserId },
        });
      }
      await tx.classSection.update({ where: { id: classSectionId }, data: { classTeacherId: teacherId } });
    });

    const desk = await this.desk(schoolId);
    const row = desk.rows.find((r) => r.classSectionId === classSectionId);
    if (!row) throw new ApiError('NOT_FOUND', 'That class is not in this session.', 404, 'classSectionId');
    return row;
  }

  /**
   * Carry last session's class teachers into this one, for sections that have
   * nobody yet. Matched by grade+section NAME, because the section rows
   * themselves are new every year. A teacher who has left is skipped and
   * counted, never carried.
   */
  async copyFrom(schoolId: string, fromYearId: string, byUserId: string): Promise<{ copied: number; skippedLeft: number; skippedNoMatch: number }> {
    return withTenant(schoolId, async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } });
      if (!year) throw new ApiError('VALIDATION', 'No session is current, so there is nothing to copy into.', 400, 'academicYearId');
      if (fromYearId === year.id) throw new ApiError('VALIDATION', 'That is the session you are copying into.', 400, 'fromYearId');

      const key = (g: string, s: string) => `${g.trim().toLowerCase()}|${s.trim().toLowerCase()}`;
      const [previous, current] = await Promise.all([
        tx.classSection.findMany({
          where: { schoolId, academicYearId: fromYearId, classTeacherId: { not: null } },
          take: LIST_CEILING.STRUCTURE,
          select: { name: true, classTeacherId: true, grade: { select: { name: true } }, classTeacher: { select: { id: true, status: true } } },
        }),
        tx.classSection.findMany({
          where: { schoolId, academicYearId: year.id, classTeacherId: null },
          take: LIST_CEILING.STRUCTURE,
          select: { id: true, name: true, grade: { select: { name: true } } },
        }),
      ]);
      const from = new Map(previous.map((p) => [key(p.grade.name, p.name), p]));

      let copied = 0;
      let skippedLeft = 0;
      let skippedNoMatch = 0;
      const now = new Date();
      for (const section of current) {
        const match = from.get(key(section.grade.name, section.name));
        if (!match) { skippedNoMatch += 1; continue; }
        if (match.classTeacher?.status !== 'ACTIVE') { skippedLeft += 1; continue; }
        await tx.classTeacherAssignment.updateMany({ where: { schoolId, classSectionId: section.id, untilAt: null }, data: { untilAt: now } });
        await tx.classTeacherAssignment.create({ data: { schoolId, classSectionId: section.id, teacherId: match.classTeacher.id, fromAt: now, changedById: byUserId } });
        await tx.classSection.update({ where: { id: section.id }, data: { classTeacherId: match.classTeacher.id } });
        copied += 1;
      }
      return { copied, skippedLeft, skippedNoMatch };
    });
  }

  /** How many sections of the current session have nobody — for the Bell. */
  async unassignedCount(schoolId: string): Promise<number> {
    return withTenant(schoolId, async (tx) => {
      const year = await tx.academicYear.findFirst({ where: { schoolId, isCurrent: true }, select: { id: true } });
      if (!year) return 0;
      return tx.classSection.count({ where: { schoolId, academicYearId: year.id, classTeacherId: null } });
    });
  }
}
