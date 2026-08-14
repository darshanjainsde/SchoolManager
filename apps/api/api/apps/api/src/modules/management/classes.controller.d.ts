import { TenantContextService } from '../tenancy';
import { ClassesService } from './classes.service';
import { CreateClassDto, UpdateClassDto } from './management.dto';
export declare class ClassesController {
    private readonly classes;
    private readonly tenant;
    constructor(classes: ClassesService, tenant: TenantContextService);
    private sid;
    list(): Promise<(import("@skoolos/types").ClassSectionSummary & {
        classTeacher: {
            firstName: string;
            lastName: string;
        } | null;
        _count: {
            students: number;
        };
    })[]>;
    create(dto: CreateClassDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        gradeId: string;
        classTeacherId: string | null;
        academicYearId: string;
    }>;
    update(id: string, dto: UpdateClassDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        gradeId: string;
        classTeacherId: string | null;
        academicYearId: string;
    }>;
    remove(id: string): Promise<void>;
}
//# sourceMappingURL=classes.controller.d.ts.map