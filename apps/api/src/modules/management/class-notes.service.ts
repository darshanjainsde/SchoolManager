import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import type { ClassLog, ClassNoteRow, ClassTodoRow, NoteClass } from '@skoolos/types';
import { ApiError } from '../../common/errors/api-error';
import { canReadClassNotes, requireClassAccess } from './internal/class-access';
import { resolveAsOfDate } from './internal/timetable-date';
import type { CreateClassNoteDto, CreateClassTodoDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const READ_FORBIDDEN_MESSAGE = 'These notes are visible to the teachers of this subject.';

export type { ClassNoteRow, ClassTodoRow };

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Notes and to-dos a teacher keeps against one class on one day. Deliberately
 * scoped to (class, date, subject) rather than to the author: two teachers
 * who share a section+subject see one another's log, which is the point — it
 * is a handover record, not a private diary.
 *
 * Read access is governed by `School.classNoteVisibility` — see
 * `internal/class-access.ts`'s `canReadClassNotes` for the full rule. Write
 * access keeps the Phase 1 rule unchanged (`requireClassAccess`: any teacher
 * who holds the class at all), but every write also re-runs the read check
 * against the subject it targets — a teacher who holds the section but not
 * this subject must not be able to write a note filed under it once
 * SUBJECT_TEACHERS is on, even though they still "hold the class".
 */
@Injectable()
export class ClassNotesService {
  private assertDate(date: string): Date {
    if (!DATE_RE.test(date)) {
      throw new ApiError('VALIDATION', 'date must be formatted as YYYY-MM-DD', 400, 'date');
    }
    return new Date(date);
  }

  /** Same rule as taking the register, including substitution cover — see internal/class-access.ts. */
  private requireTeacherFor(tx: Tx, userId: string, classSectionId: string, date: string) {
    return requireClassAccess(tx, userId, classSectionId, date, 'add notes to');
  }

  /**
   * Throws the same 403 the list endpoint returns when the caller may not
   * read (and therefore may not write) this subject's notes. `subjectId` must
   * always come from a stored row for mutations on existing notes/todos —
   * never from caller input — so a caller cannot claim a different subject
   * than the one the row actually belongs to.
   */
  private async requireReadAccess(
    tx: Tx,
    userId: string,
    role: string,
    schoolId: string,
    classSectionId: string,
    subjectId: string,
    date: string,
  ): Promise<void> {
    const allowed = await canReadClassNotes(tx, userId, role, schoolId, classSectionId, subjectId, date);
    if (!allowed) {
      throw new ApiError('CLASS_NOT_OWNED', READ_FORBIDDEN_MESSAGE, 403, 'subjectId');
    }
  }

  async list(
    schoolId: string,
    classSectionId: string,
    date: string,
    subjectId: string,
    userId: string,
    role: string,
  ): Promise<{ notes: ClassNoteRow[]; todos: ClassTodoRow[] }> {
    const day = this.assertDate(date);
    return withTenant(schoolId, async (tx) => {
      await this.requireReadAccess(tx, userId, role, schoolId, classSectionId, subjectId, date);

      // ALL_TEACHERS: the whole class's log, same as Phase 1 — `subjectId` is
      // only used above to decide whether this caller may read at all.
      // SUBJECT_TEACHERS: scoped to exactly the requested subject.
      const school = await tx.school.findUnique({
        where: { id: schoolId },
        select: { classNoteVisibility: true },
      });
      const where =
        school?.classNoteVisibility === 'SUBJECT_TEACHERS'
          ? { classSectionId, date: day, subjectId }
          : { classSectionId, date: day };

      const [notes, todos] = await Promise.all([
        tx.classNote.findMany({ where, orderBy: { createdAt: 'asc' } }),
        tx.classTodo.findMany({ where, orderBy: { createdAt: 'asc' } }),
      ]);
      return {
        notes: notes.map((n) => ({
          id: n.id, body: n.body, createdAt: n.createdAt.toISOString(), authorTeacherId: n.authorTeacherId,
        })),
        todos: todos.map((t) => ({
          id: t.id, body: t.body, done: t.done, createdAt: t.createdAt.toISOString(), authorTeacherId: t.authorTeacherId,
        })),
      };
    });
  }

  async addNote(
    schoolId: string,
    userId: string,
    role: string,
    dto: CreateClassNoteDto,
  ): Promise<ClassNoteRow> {
    const day = this.assertDate(dto.date);
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A note cannot be empty.', 400, 'body');

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);
      await this.requireReadAccess(tx, userId, role, schoolId, dto.classSectionId, dto.subjectId, dto.date);
      const row = await tx.classNote.create({
        data: {
          schoolId,
          classSectionId: dto.classSectionId,
          subjectId: dto.subjectId,
          date: day,
          body,
          authorTeacherId: teacherId,
        },
      });
      return { id: row.id, body: row.body, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async addTodo(
    schoolId: string,
    userId: string,
    role: string,
    dto: CreateClassTodoDto,
  ): Promise<ClassTodoRow> {
    const day = this.assertDate(dto.date);
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A task cannot be empty.', 400, 'body');

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);
      await this.requireReadAccess(tx, userId, role, schoolId, dto.classSectionId, dto.subjectId, dto.date);
      const row = await tx.classTodo.create({
        data: {
          schoolId,
          classSectionId: dto.classSectionId,
          subjectId: dto.subjectId,
          date: day,
          body,
          authorTeacherId: teacherId,
        },
      });
      return { id: row.id, body: row.body, done: row.done, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async setTodoDone(schoolId: string, userId: string, role: string, id: string, done: boolean): Promise<ClassTodoRow> {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.classTodo.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That task no longer exists.', 404, 'id');
      const date = existing.date.toISOString().slice(0, 10);
      await this.requireTeacherFor(tx, userId, existing.classSectionId, date);
      // subjectId comes from the stored row, never from the caller.
      await this.requireReadAccess(tx, userId, role, schoolId, existing.classSectionId, existing.subjectId, date);
      const row = await tx.classTodo.update({ where: { id }, data: { done } });
      return { id: row.id, body: row.body, done: row.done, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async removeNote(schoolId: string, userId: string, role: string, id: string): Promise<void> {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.classNote.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That note no longer exists.', 404, 'id');
      const date = existing.date.toISOString().slice(0, 10);
      await this.requireTeacherFor(tx, userId, existing.classSectionId, date);
      // subjectId comes from the stored row, never from the caller.
      await this.requireReadAccess(tx, userId, role, schoolId, existing.classSectionId, existing.subjectId, date);
      await tx.classNote.delete({ where: { id } });
    });
  }

  async removeTodo(schoolId: string, userId: string, role: string, id: string): Promise<void> {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.classTodo.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That task no longer exists.', 404, 'id');
      const date = existing.date.toISOString().slice(0, 10);
      await this.requireTeacherFor(tx, userId, existing.classSectionId, date);
      // subjectId comes from the stored row, never from the caller.
      await this.requireReadAccess(tx, userId, role, schoolId, existing.classSectionId, existing.subjectId, date);
      await tx.classTodo.delete({ where: { id } });
    });
  }

  /**
   * The Notes-tab class list: every (section, subject) the teacher teaches on
   * their OWN current timetable, deduped, with a class-teacher flag and note /
   * open-to-do counts. Substitution cover is intentionally NOT listed — a
   * one-day cover only surfaces the live panel that day, never a browsable
   * class here. SCHOOL_ADMIN has no Teacher row, so gets an empty list.
   */
  async noteClasses(schoolId: string, userId: string): Promise<NoteClass[]> {
    return withTenant(schoolId, async (tx) => {
      const teacher = await tx.teacher.findFirst({ where: { userId }, select: { id: true } });
      if (!teacher) return [];
      const asOf = resolveAsOfDate(undefined, new Date());
      const slots = await tx.timetableSlot.findMany({
        where: {
          teacherId: teacher.id,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        },
        select: {
          classSectionId: true,
          subjectId: true,
          classSection: { select: { name: true, classTeacherId: true } },
          subject: { select: { name: true } },
        },
      });

      const byPair = new Map<string, NoteClass>();
      for (const s of slots) {
        const key = `${s.classSectionId}:${s.subjectId}`;
        if (!byPair.has(key)) {
          byPair.set(key, {
            classSectionId: s.classSectionId,
            className: s.classSection.name,
            subjectId: s.subjectId,
            subjectName: s.subject.name,
            isClassTeacher: s.classSection.classTeacherId === teacher.id,
            noteCount: 0,
            openTodoCount: 0,
          });
        }
      }
      if (byPair.size === 0) return [];

      const sectionIds = [...new Set([...byPair.values()].map((c) => c.classSectionId))];
      const subjectIds = [...new Set([...byPair.values()].map((c) => c.subjectId))];
      // groupBy returns per-(section,subject) counts; pairs the teacher does not
      // teach are simply not in `byPair`, so counting a superset is harmless.
      const [noteCounts, todoCounts] = await Promise.all([
        tx.classNote.groupBy({
          by: ['classSectionId', 'subjectId'],
          where: { classSectionId: { in: sectionIds }, subjectId: { in: subjectIds } },
          _count: { _all: true },
        }),
        tx.classTodo.groupBy({
          by: ['classSectionId', 'subjectId'],
          where: { classSectionId: { in: sectionIds }, subjectId: { in: subjectIds }, done: false },
          _count: { _all: true },
        }),
      ]);
      for (const n of noteCounts) {
        const c = byPair.get(`${n.classSectionId}:${n.subjectId}`);
        if (c) c.noteCount = n._count._all;
      }
      for (const t of todoCounts) {
        const c = byPair.get(`${t.classSectionId}:${t.subjectId}`);
        if (c) c.openTodoCount = t._count._all;
      }

      return [...byPair.values()].sort(
        (a, b) => a.className.localeCompare(b.className) || a.subjectName.localeCompare(b.subjectName),
      );
    });
  }

  /** Teacher regularly teaches this (section, subject) on their timetable (or is
   * SCHOOL_ADMIN). This — not the substitution-inclusive `requireClassAccess` —
   * is the gate for the browsable Notes tab, so a one-day substitute cannot page
   * through a class's whole history. */
  private async assertTeachesPair(
    tx: Tx,
    userId: string,
    role: string,
    classSectionId: string,
    subjectId: string,
  ): Promise<void> {
    if (role === 'SCHOOL_ADMIN') return;
    const teacher = await tx.teacher.findFirst({ where: { userId }, select: { id: true } });
    if (teacher) {
      const asOf = resolveAsOfDate(undefined, new Date());
      const slot = await tx.timetableSlot.findFirst({
        where: {
          classSectionId,
          subjectId,
          teacherId: teacher.id,
          effectiveFrom: { lte: asOf },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        },
        select: { id: true },
      });
      if (slot) return;
    }
    throw new ApiError('CLASS_NOT_OWNED', 'You can only open notes for a class you teach.', 403, 'classSectionId');
  }

  /**
   * One class+subject's full notes/to-dos history, newest day first, capped to
   * the last 120 days. Authorised only for a class the teacher regularly teaches
   * (see `assertTeachesPair`).
   */
  async log(
    schoolId: string,
    classSectionId: string,
    subjectId: string,
    userId: string,
    role: string,
  ): Promise<ClassLog> {
    return withTenant(schoolId, async (tx) => {
      await this.assertTeachesPair(tx, userId, role, classSectionId, subjectId);
      const since = new Date();
      since.setDate(since.getDate() - 120);
      const where = { classSectionId, subjectId, date: { gte: since } };
      const [notes, todos] = await Promise.all([
        tx.classNote.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'asc' }] }),
        tx.classTodo.findMany({ where, orderBy: [{ date: 'desc' }, { createdAt: 'asc' }] }),
      ]);
      return {
        notes: notes.map((n) => ({
          id: n.id,
          body: n.body,
          createdAt: n.createdAt.toISOString(),
          authorTeacherId: n.authorTeacherId,
          date: n.date.toISOString().slice(0, 10),
        })),
        todos: todos.map((t) => ({
          id: t.id,
          body: t.body,
          done: t.done,
          createdAt: t.createdAt.toISOString(),
          authorTeacherId: t.authorTeacherId,
          date: t.date.toISOString().slice(0, 10),
        })),
      };
    });
  }
}
