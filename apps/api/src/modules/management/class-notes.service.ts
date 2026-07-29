import { Injectable } from '@nestjs/common';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { requireClassAccess } from './internal/class-access';
import type { CreateClassNoteDto, CreateClassTodoDto } from './management.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ClassNoteRow {
  id: string;
  body: string;
  createdAt: string;
  authorTeacherId: string;
}

export interface ClassTodoRow extends ClassNoteRow {
  done: boolean;
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Notes and to-dos a teacher keeps against one class on one day. Deliberately
 * scoped to (class, date) rather than to the author: two teachers who share a
 * section see one another's log, which is the point — it is a handover record
 * for the class, not a private diary.
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

  async list(
    schoolId: string,
    classSectionId: string,
    date: string,
  ): Promise<{ notes: ClassNoteRow[]; todos: ClassTodoRow[] }> {
    const day = this.assertDate(date);
    return withTenant(schoolId, async (tx) => {
      const [notes, todos] = await Promise.all([
        tx.classNote.findMany({
          where: { classSectionId, date: day },
          orderBy: { createdAt: 'asc' },
        }),
        tx.classTodo.findMany({
          where: { classSectionId, date: day },
          orderBy: { createdAt: 'asc' },
        }),
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

  async addNote(schoolId: string, userId: string, dto: CreateClassNoteDto): Promise<ClassNoteRow> {
    const day = this.assertDate(dto.date);
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A note cannot be empty.', 400, 'body');

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);
      const row = await tx.classNote.create({
        data: { schoolId, classSectionId: dto.classSectionId, date: day, body, authorTeacherId: teacherId },
      });
      return { id: row.id, body: row.body, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async addTodo(schoolId: string, userId: string, dto: CreateClassTodoDto): Promise<ClassTodoRow> {
    const day = this.assertDate(dto.date);
    const body = dto.body.trim();
    if (!body) throw new ApiError('VALIDATION', 'A task cannot be empty.', 400, 'body');

    return withTenant(schoolId, async (tx) => {
      const teacherId = await this.requireTeacherFor(tx, userId, dto.classSectionId, dto.date);
      const row = await tx.classTodo.create({
        data: { schoolId, classSectionId: dto.classSectionId, date: day, body, authorTeacherId: teacherId },
      });
      return { id: row.id, body: row.body, done: row.done, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async setTodoDone(schoolId: string, userId: string, id: string, done: boolean): Promise<ClassTodoRow> {
    return withTenant(schoolId, async (tx) => {
      const existing = await tx.classTodo.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That task no longer exists.', 404, 'id');
      await this.requireTeacherFor(
        tx, userId, existing.classSectionId, existing.date.toISOString().slice(0, 10),
      );
      const row = await tx.classTodo.update({ where: { id }, data: { done } });
      return { id: row.id, body: row.body, done: row.done, createdAt: row.createdAt.toISOString(), authorTeacherId: row.authorTeacherId };
    });
  }

  async removeNote(schoolId: string, userId: string, id: string): Promise<void> {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.classNote.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That note no longer exists.', 404, 'id');
      await this.requireTeacherFor(
        tx, userId, existing.classSectionId, existing.date.toISOString().slice(0, 10),
      );
      await tx.classNote.delete({ where: { id } });
    });
  }

  async removeTodo(schoolId: string, userId: string, id: string): Promise<void> {
    await withTenant(schoolId, async (tx) => {
      const existing = await tx.classTodo.findFirst({ where: { id } });
      if (!existing) throw new ApiError('NOT_FOUND', 'That task no longer exists.', 404, 'id');
      await this.requireTeacherFor(
        tx, userId, existing.classSectionId, existing.date.toISOString().slice(0, 10),
      );
      await tx.classTodo.delete({ where: { id } });
    });
  }
}
