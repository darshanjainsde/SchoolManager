import type { UpsertStaffDto } from './cms.dto';
export declare class StaffService {
    list(schoolId: string): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        photoAssetId: string | null;
        teacherId: string | null;
        role: string;
    }[]>;
    create(schoolId: string, dto: UpsertStaffDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        photoAssetId: string | null;
        teacherId: string | null;
        role: string;
    }>;
    update(schoolId: string, id: string, dto: UpsertStaffDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        photoAssetId: string | null;
        teacherId: string | null;
        role: string;
    }>;
    remove(schoolId: string, id: string): Promise<{
        ok: boolean;
    }>;
}
//# sourceMappingURL=staff.service.d.ts.map