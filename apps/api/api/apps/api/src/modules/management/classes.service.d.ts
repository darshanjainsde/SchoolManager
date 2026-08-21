import type { ClassSectionSummary } from '@skoolos/types';
import type { CreateClassDto, UpdateClassDto } from './management.dto';
/**
 * The full `list()` row: `ClassSectionSummary` (`@skoolos/types`) plus the
 * admin-only fields (`classTeacher`, student `_count`) the SCHOOL_ADMIN
 * classes screen also reads off this same response.
 */
type ClassSectionAdminRow = ClassSectionSummary & {
    classTeacher: {
        firstName: string;
        lastName: string;
    } | null;
    _count: {
        students: number;
    };
};
export declare class ClassesService {
    list(schoolId: string): Promise<ClassSectionAdminRow[]>;
    create(schoolId: string, dto: CreateClassDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        gradeId: string;
        classTeacherId: string | null;
        academicYearId: string;
    }>;
    update(schoolId: string, id: string, dto: UpdateClassDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        gradeId: string;
        classTeacherId: string | null;
        academicYearId: string;
    }>;
    remove(schoolId: string, id: string): Promise<void>;
    /**
     * Validates that the referenced grade, academicYear, and (optionally) classTeacher
     * all belong to the same school. Uses withTenant so RLS scopes lookups — a foreign
     * id returns null and we surface a 400 instead of a FK 500.
     */
    private validateRefs;
}
export {};
//# sourceMappingURL=classes.service.d.ts.map