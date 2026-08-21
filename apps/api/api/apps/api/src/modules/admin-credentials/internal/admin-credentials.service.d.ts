import { PasswordService } from '../../auth';
export interface AdminRow {
    userId: string;
    email: string;
    isActive: boolean;
    lastLoginAt: Date | null;
    lockedUntil: Date | null;
}
/**
 * Owner-side school-admin credential control. Runs on the BYPASSRLS platform
 * connection, so every lookup is explicitly scoped by schoolId + role — that
 * scoping is the only thing preventing an IDOR onto another school or an OWNER.
 */
export declare class AdminCredentialsService {
    private readonly passwords;
    private readonly logger;
    constructor(passwords: PasswordService);
    listAdmins(schoolId: string): Promise<AdminRow[]>;
    resetPassword(schoolId: string, userId: string): Promise<{
        password: string;
    }>;
}
//# sourceMappingURL=admin-credentials.service.d.ts.map