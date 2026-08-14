import { TenantContextService } from '../tenancy';
import { StaffService } from './staff.service';
import { CreateLoginDto, CreateStaffDto, UpdateStaffDto } from './management.dto';
export declare class StaffController {
    private readonly staff;
    private readonly tenant;
    constructor(staff: StaffService, tenant: TenantContextService);
    private sid;
    list(): Promise<{
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
        photoAssetId: string | null;
        isActive: boolean;
        role: import("@skoolos/db").$Enums.StaffRole;
    }[]>;
    create(dto: CreateStaffDto): Promise<{
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
        photoAssetId: string | null;
        isActive: boolean;
        role: import("@skoolos/db").$Enums.StaffRole;
    }>;
    update(id: string, dto: UpdateStaffDto): Promise<{
        email: string | null;
        id: string;
        createdAt: Date;
        schoolId: string;
        userId: string | null;
        firstName: string;
        lastName: string;
        phone: string | null;
        photoAssetId: string | null;
        isActive: boolean;
        role: import("@skoolos/db").$Enums.StaffRole;
    }>;
    remove(id: string): Promise<void>;
    /**
     * Login-invite routes are SCHOOL_ADMIN-only (mirrors TeachersController),
     * so RolesGuard + @Roles are applied per-handler here rather than at the
     * class level — the other handlers on this controller intentionally stay
     * open to any authenticated MANAGEMENT-feature role.
     */
    createLogin(id: string, dto: CreateLoginDto): Promise<import("./students.service").LoginInviteResult>;
    resendInvite(id: string): Promise<import("./students.service").LoginInviteResult>;
}
//# sourceMappingURL=staff.controller.d.ts.map