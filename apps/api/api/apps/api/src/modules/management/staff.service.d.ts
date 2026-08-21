import { PasswordService } from '../auth';
import { LoginInviteService } from './internal/login-invite.service';
import type { CreateLoginDto, CreateStaffDto, UpdateStaffDto } from './management.dto';
import type { LoginInviteResult } from './students.service';
export declare class StaffService {
    private readonly passwords;
    private readonly invites;
    constructor(passwords: PasswordService, invites: LoginInviteService);
    list(schoolId: string): Promise<{
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
    create(schoolId: string, dto: CreateStaffDto): Promise<{
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
    update(schoolId: string, id: string, dto: UpdateStaffDto): Promise<{
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
    remove(schoolId: string, id: string): Promise<void>;
    /**
     * Creates the staff member's login and emails a "welcome — set your
     * password" invite, mirroring TeachersService.createLogin. The account is
     * created with role STAFF (never TEACHER/STUDENT) so a staff login can
     * never be mistaken for, or granted the portal reach of, either — see the
     * UserRole enum in packages/db/prisma/schema.prisma.
     *
     * `dto.email` falls back to the staff member's existing contact email
     * (Staff.email) when omitted — either way a real, usable address is
     * required to send the invite.
     */
    createLogin(schoolId: string, staffId: string, dto: CreateLoginDto): Promise<LoginInviteResult>;
    /** Re-sends the welcome invite for a staff member who already has a login. */
    resendInvite(schoolId: string, staffId: string): Promise<LoginInviteResult>;
    private conflictFor;
}
//# sourceMappingURL=staff.service.d.ts.map