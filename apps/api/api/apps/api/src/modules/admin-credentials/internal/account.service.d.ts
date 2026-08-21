import { PasswordService } from '../../auth';
/**
 * Self-service password change for a logged-in school user. Requires the
 * current password, and revokes all of the user's sessions so the change
 * propagates everywhere.
 */
export declare class AccountService {
    private readonly passwords;
    private readonly logger;
    constructor(passwords: PasswordService);
    changePassword(schoolId: string, userId: string, currentPassword: string, newPassword: string): Promise<{
        ok: true;
    }>;
}
//# sourceMappingURL=account.service.d.ts.map