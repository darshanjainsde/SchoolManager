import type { ClassNoteVisibilityValue, Subject } from '@skoolos/types';
import type { CreateYearDto, CreateGradeDto, UpdateGradeDto, CreateSubjectDto, UpdateSubjectDto, CreatePeriodDto, UpdatePeriodDto } from './management.dto';
export declare class CatalogService {
    listYears(schoolId: string): Promise<{
        name: string;
        id: string;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        isCurrent: boolean;
    }[]>;
    createYear(schoolId: string, dto: CreateYearDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        startDate: Date;
        endDate: Date;
        isCurrent: boolean;
    }>;
    listGrades(schoolId: string): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
    }[]>;
    createGrade(schoolId: string, dto: CreateGradeDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
    }>;
    updateGrade(schoolId: string, id: string, dto: UpdateGradeDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
    }>;
    deleteGrade(schoolId: string, id: string): Promise<void>;
    /** Matches the shared `Subject` contract (`@skoolos/types`) field for field — `GET /manage/subjects`. */
    listSubjects(schoolId: string): Promise<Subject[]>;
    createSubject(schoolId: string, dto: CreateSubjectDto): Promise<{
        code: string;
        name: string;
        id: string;
        schoolId: string;
    }>;
    updateSubject(schoolId: string, id: string, dto: UpdateSubjectDto): Promise<{
        code: string;
        name: string;
        id: string;
        schoolId: string;
    }>;
    deleteSubject(schoolId: string, id: string): Promise<void>;
    listPeriods(schoolId: string): Promise<{
        kind: import("@skoolos/db").$Enums.PeriodKind;
        id: string;
        schoolId: string;
        order: number;
        label: string;
        startTime: string;
        endTime: string;
    }[]>;
    createPeriod(schoolId: string, dto: CreatePeriodDto): Promise<{
        kind: import("@skoolos/db").$Enums.PeriodKind;
        id: string;
        schoolId: string;
        order: number;
        label: string;
        startTime: string;
        endTime: string;
    }>;
    updatePeriod(schoolId: string, id: string, dto: UpdatePeriodDto): Promise<{
        kind: import("@skoolos/db").$Enums.PeriodKind;
        id: string;
        schoolId: string;
        order: number;
        label: string;
        startTime: string;
        endTime: string;
    }>;
    deletePeriod(schoolId: string, id: string): Promise<void>;
    getWorkingDays(schoolId: string): Promise<{
        workingDays: number[];
    }>;
    updateWorkingDays(schoolId: string, workingDays: number[]): Promise<{
        workingDays: number[];
    }>;
    getClassNoteVisibility(schoolId: string): Promise<{
        classNoteVisibility: import("@skoolos/db").$Enums.ClassNoteVisibility;
    }>;
    updateClassNoteVisibility(schoolId: string, classNoteVisibility: ClassNoteVisibilityValue): Promise<{
        classNoteVisibility: import("@skoolos/db").$Enums.ClassNoteVisibility;
    }>;
}
//# sourceMappingURL=catalog.service.d.ts.map