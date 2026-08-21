import { PasswordService } from './password.service';
import { MailService } from '../../../common/mail/mail.service';
/** "sonia@gmail.com" → "s•••a@gmail.com" (short local parts keep first char only). */
export declare function maskEmail(email: string): string;
export declare class PasswordResetService {
    private readonly passwords;
    private readonly mail;
    private readonly logger;
    private readonly env;
    constructor(passwords: PasswordService, mail: MailService);
    /**
     * Always resolves (no account enumeration). When the email matches an active
     * user of this school, mints a single-use token and emails the reset link.
     * The link host comes from the school's own DB record — never from request
     * headers, which would allow host-header injection into the emailed link.
     */
    requestReset(schoolId: string, email: string): Promise<void>;
    /**
     * Phase 5·1 — reset with ONLY the student code (RAF-00042): resolves
     * code → student → linked login, sends the same reset link to the email on
     * the child's profile, and returns a MASKED form of that address for the
     * "sent to s•••a@gmail.com" confirmation. Returns null (still 200 at the
     * controller) when the code doesn't resolve or the student has no
     * login/email — the copy then points at the school office. Tightly
     * throttled at the route; codes are semi-public (printed in the diary), so
     * the mask is the confirmation, never the full address.
     */
    requestResetByCode(schoolId: string, code: string): Promise<string | null>;
    private mintAndSend;
    /** Validates the token, sets the new password, revokes sessions, burns the token. */
    resetPassword(schoolId: string, token: string, newPassword: string): Promise<void>;
}
//# sourceMappingURL=password-reset.service.d.ts.map