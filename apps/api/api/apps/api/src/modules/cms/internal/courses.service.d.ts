import type { UpsertCourseDto, UpsertCourseFeeDto } from './cms.dto';
export declare class CoursesService {
    list(schoolId: string): Promise<({
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
    create(schoolId: string, dto: UpsertCourseDto): Promise<{
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
    update(schoolId: string, id: string, dto: UpsertCourseDto): Promise<{
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
    remove(schoolId: string, id: string): Promise<{
        ok: boolean;
    }>;
    setFee(schoolId: string, courseId: string, dto: UpsertCourseFeeDto): Promise<{
        includes: string | null;
        id: string;
        schoolId: string;
        courseId: string;
        admissionFee: string | null;
        annualFee: string | null;
    }>;
    private mustOwn;
}
//# sourceMappingURL=courses.service.d.ts.map