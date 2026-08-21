import { TenantContextService } from '../../tenancy';
import { CoursesService } from './courses.service';
import { UpsertCourseDto, UpsertCourseFeeDto } from './cms.dto';
export declare class CoursesController {
    private readonly courses;
    private readonly tenant;
    constructor(courses: CoursesService, tenant: TenantContextService);
    private sid;
    list(): Promise<({
        fee: {
            includes: string | null;
            id: string;
            schoolId: string;
            courseId: string;
            admissionFee: string | null;
            annualFee: string | null;
        } | null;
    } & {
        name: string;
        id: string;
        schoolId: string;
        order: number;
        tagline: string | null;
        description: string | null;
        highlights: string[];
        ageRange: string | null;
        imageAssetId: string | null;
        featured: boolean;
    })[]>;
    create(dto: UpsertCourseDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        tagline: string | null;
        description: string | null;
        highlights: string[];
        ageRange: string | null;
        imageAssetId: string | null;
        featured: boolean;
    }>;
    update(id: string, dto: UpsertCourseDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        tagline: string | null;
        description: string | null;
        highlights: string[];
        ageRange: string | null;
        imageAssetId: string | null;
        featured: boolean;
    }>;
    remove(id: string): Promise<{
        ok: boolean;
    }>;
    setFee(id: string, dto: UpsertCourseFeeDto): Promise<{
        includes: string | null;
        id: string;
        schoolId: string;
        courseId: string;
        admissionFee: string | null;
        annualFee: string | null;
    }>;
}
//# sourceMappingURL=courses.controller.d.ts.map