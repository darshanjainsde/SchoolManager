import type { ClassLog, ClassNoteRow, ClassTodoRow, NoteClass } from '@skoolos/types';
import type { CreateClassNoteDto, CreateClassTodoDto } from './management.dto';
export type { ClassNoteRow, ClassTodoRow };
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
export declare class ClassNotesService {
    private assertDate;
    /** Same rule as taking the register, including substitution cover — see internal/class-access.ts. */
    private requireTeacherFor;
    /**
     * Throws the same 403 the list endpoint returns when the caller may not
     * read (and therefore may not write) this subject's notes. `subjectId` must
     * always come from a stored row for mutations on existing notes/todos —
     * never from caller input — so a caller cannot claim a different subject
     * than the one the row actually belongs to.
     */
    private requireReadAccess;
    list(schoolId: string, classSectionId: string, date: string, subjectId: string, userId: string, role: string): Promise<{
        notes: ClassNoteRow[];
        todos: ClassTodoRow[];
    }>;
    addNote(schoolId: string, userId: string, role: string, dto: CreateClassNoteDto): Promise<ClassNoteRow>;
    addTodo(schoolId: string, userId: string, role: string, dto: CreateClassTodoDto): Promise<ClassTodoRow>;
    setTodoDone(schoolId: string, userId: string, role: string, id: string, done: boolean): Promise<ClassTodoRow>;
    removeNote(schoolId: string, userId: string, role: string, id: string): Promise<void>;
    removeTodo(schoolId: string, userId: string, role: string, id: string): Promise<void>;
    /**
     * The Notes-tab class list: every (section, subject) the teacher teaches on
     * their OWN current timetable, deduped, with a class-teacher flag and note /
     * open-to-do counts. Substitution cover is intentionally NOT listed — a
     * one-day cover only surfaces the live panel that day, never a browsable
     * class here. SCHOOL_ADMIN has no Teacher row, so gets an empty list.
     */
    noteClasses(schoolId: string, userId: string): Promise<NoteClass[]>;
    /** Teacher regularly teaches this (section, subject) on their timetable (or is
     * SCHOOL_ADMIN). This — not the substitution-inclusive `requireClassAccess` —
     * is the gate for the browsable Notes tab, so a one-day substitute cannot page
     * through a class's whole history. */
    private assertTeachesPair;
    /**
     * One class+subject's full notes/to-dos history, newest day first, capped to
     * the last 120 days. Authorised only for a class the teacher regularly teaches
     * (see `assertTeachesPair`).
     */
    log(schoolId: string, classSectionId: string, subjectId: string, userId: string, role: string): Promise<ClassLog>;
}
//# sourceMappingURL=class-notes.service.d.ts.map