import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { ClassNotesService } from './class-notes.service';
import { CreateClassNoteDto, CreateClassTodoDto, UpdateClassTodoDto } from './management.dto';
export declare class ClassNotesController {
    private readonly svc;
    private readonly tenant;
    constructor(svc: ClassNotesService, tenant: TenantContextService);
    private sid;
    list(classSectionId: string, date: string, subjectId: string, u: SchoolJwtPayload): Promise<{
        notes: import("@skoolos/types").ClassNoteRow[];
        todos: import("@skoolos/types").ClassTodoRow[];
    }>;
    /** Notes-tab class list — the (section, subject) pairs the caller teaches. */
    noteClasses(u: SchoolJwtPayload): Promise<import("@skoolos/types").NoteClass[]>;
    /** One class+subject's full notes/to-dos history (newest day first). */
    log(classSectionId: string, subjectId: string, u: SchoolJwtPayload): Promise<import("@skoolos/types").ClassLog>;
    addNote(dto: CreateClassNoteDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").ClassNoteRow>;
    removeNote(id: string, u: SchoolJwtPayload): Promise<void>;
    addTodo(dto: CreateClassTodoDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").ClassTodoRow>;
    setDone(id: string, dto: UpdateClassTodoDto, u: SchoolJwtPayload): Promise<import("@skoolos/types").ClassTodoRow>;
    removeTodo(id: string, u: SchoolJwtPayload): Promise<void>;
}
//# sourceMappingURL=class-notes.controller.d.ts.map