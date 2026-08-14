import { TenantContextService } from '../tenancy';
import { CatalogService } from './catalog.service';
import { TimetableService } from './timetable.service';
import { AvailabilityQueryDto, CreateGradeDto, CreatePeriodDto, CreateSubjectDto, CreateYearDto, UpdateGradeDto, UpdatePeriodDto, UpdateClassNoteVisibilityDto, UpdateSubjectDto, UpdateWorkingDaysDto } from './management.dto';
export declare class CatalogController {
    private readonly catalog;
    private readonly timetable;
    private readonly tenant;
    constructor(catalog: CatalogService, timetable: TimetableService, tenant: TenantContextService);
    private sid;
    listYears(): Promise<{
        name: string;
        id: string;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        isCurrent: boolean;
    }[]>;
    createYear(dto: CreateYearDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        isCurrent: boolean;
    }>;
    listGrades(): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
    }[]>;
    createGrade(dto: CreateGradeDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
    }>;
    updateGrade(id: string, dto: UpdateGradeDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
    }>;
    deleteGrade(id: string): Promise<void>;
    listSubjects(): Promise<import("@skoolos/types").Subject[]>;
    createSubject(dto: CreateSubjectDto): Promise<{
        code: string;
        name: string;
        id: string;
        schoolId: string;
    }>;
    updateSubject(id: string, dto: UpdateSubjectDto): Promise<{
        code: string;
        name: string;
        id: string;
        schoolId: string;
    }>;
    deleteSubject(id: string): Promise<void>;
    listPeriods(): Promise<{
        kind: import("@skoolos/db").$Enums.PeriodKind;
        id: string;
        schoolId: string;
        order: number;
        label: string;
        startTime: string;
        endTime: string;
    }[]>;
    createPeriod(dto: CreatePeriodDto): Promise<{
        kind: import("@skoolos/db").$Enums.PeriodKind;
        id: string;
        schoolId: string;
        order: number;
        label: string;
        startTime: string;
        endTime: string;
    }>;
    updatePeriod(id: string, dto: UpdatePeriodDto): Promise<{
        kind: import("@skoolos/db").$Enums.PeriodKind;
        id: string;
        schoolId: string;
        order: number;
        label: string;
        startTime: string;
        endTime: string;
    }>;
    deletePeriod(id: string): Promise<void>;
    getWorkingDays(): Promise<{
        workingDays: number[];
    }>;
    updateWorkingDays(dto: UpdateWorkingDaysDto): Promise<{
        workingDays: number[];
    }>;
    getClassNoteVisibility(): Promise<{
        classNoteVisibility: import("@skoolos/db").$Enums.ClassNoteVisibility;
    }>;
    updateClassNoteVisibility(dto: UpdateClassNoteVisibilityDto): Promise<{
        classNoteVisibility: import("@skoolos/db").$Enums.ClassNoteVisibility;
    }>;
    availability(query: AvailabilityQueryDto): Promise<{
        teachers: {
            id: string;
            firstName: string;
            lastName: string;
        }[];
        periods: {
            kind: import("@skoolos/db").$Enums.PeriodKind;
            id: string;
            order: number;
            label: string;
            startTime: string;
            endTime: string;
        }[];
        busy: {
            periodId: string;
            dayOfWeek: number;
            teacherId: string;
        }[];
    }>;
}
//# sourceMappingURL=catalog.controller.d.ts.map