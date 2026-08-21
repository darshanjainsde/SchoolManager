import { TenantContextService } from '../../tenancy';
import { StaffService } from './staff.service';
import { UpsertStaffDto } from './cms.dto';
export declare class StaffController {
    private readonly staff;
    private readonly tenant;
    constructor(staff: StaffService, tenant: TenantContextService);
    private sid;
    list(): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        photoAssetId: string | null;
        teacherId: string | null;
        role: string;
    }[]>;
    create(dto: UpsertStaffDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        photoAssetId: string | null;
        teacherId: string | null;
        role: string;
    }>;
    update(id: string, dto: UpsertStaffDto): Promise<{
        name: string;
        id: string;
        schoolId: string;
        order: number;
        photoAssetId: string | null;
        teacherId: string | null;
        role: string;
    }>;
    remove(id: string): Promise<{
        ok: boolean;
    }>;
}
//# sourceMappingURL=staff.controller.d.ts.map