import type { TeacherDay, TeacherDayEntry } from '@skoolos/types';
import { AttendanceService } from './attendance.service';
export type { TeacherDay, TeacherDayEntry };
/**
 * One call that answers "what is my day, and what still needs marking?".
 * The Today screen on both clients renders straight from this, so the two
 * surfaces cannot drift on which period is current or which register is open.
 */
export declare class TeacherDayService {
    private readonly attendance;
    constructor(attendance: AttendanceService);
    forTeacher(schoolId: string, userId: string, role: string, date: string): Promise<TeacherDay>;
}
//# sourceMappingURL=teacher-day.service.d.ts.map