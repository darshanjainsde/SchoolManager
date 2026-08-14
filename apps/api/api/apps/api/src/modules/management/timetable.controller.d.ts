import type { SchoolJwtPayload } from '../../common/auth/jwt-payload';
import { TenantContextService } from '../tenancy';
import { TimetableService } from './timetable.service';
import { TeacherDayService } from './teacher-day.service';
import { AssignSlotDto } from './management.dto';
export declare class TimetableController {
    private readonly timetable;
    private readonly teacherDay;
    private readonly tenant;
    constructor(timetable: TimetableService, teacherDay: TeacherDayService, tenant: TenantContextService);
    private sid;
    /**
     * The caller's own day. Declared above `@Get()` so the static path matches
     * before the class-scoped read.
     */
    myDay(u: SchoolJwtPayload, date?: string): Promise<import("@skoolos/types").TeacherDay>;
    /** The caller's own week, for the timetable grid. */
    myWeek(u: SchoolJwtPayload, date?: string): Promise<import("@skoolos/types").TimetableSlot[]>;
    listForClass(classSectionId: string, date?: string): Promise<import("@skoolos/types").TimetableSlot[]>;
    assign(dto: AssignSlotDto): Promise<{
        subject: {
            code: string;
            name: string;
            id: string;
        };
        classSection: {
            name: string;
            id: string;
            grade: {
                name: string;
            };
        };
        teacher: {
            id: string;
            firstName: string;
            lastName: string;
        };
        period: {
            kind: import("@skoolos/db").$Enums.PeriodKind;
            id: string;
            schoolId: string;
            order: number;
            label: string;
            startTime: string;
            endTime: string;
        };
    } & {
        id: string;
        schoolId: string;
        classSectionId: string;
        academicYearId: string;
        subjectId: string;
        periodId: string;
        dayOfWeek: number;
        teacherId: string;
        effectiveFrom: Date;
        effectiveTo: Date | null;
    }>;
    unassign(id: string): Promise<void>;
}
//# sourceMappingURL=timetable.controller.d.ts.map