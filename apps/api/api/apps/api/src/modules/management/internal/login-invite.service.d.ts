import { MailService } from '../../../common/mail/mail.service';
/**
 * Shared by StudentsService and TeachersService: mints a single-use
 * set-password token in the SAME table/mechanism as
 * `auth/internal/password-reset.service.ts` (so the existing
 * `/reset-password?token=…` page on the web app handles both "reset" and
 * "first-time welcome" links identically), then emails the welcome invite.
 *
 * Best-effort by design: a mail-provider outage must never make the account
 * or the token disappear — the caller gets `emailSent: false` back and the
 * admin can hit the resend endpoint once the mail path is healthy again.
 */
export declare class LoginInviteService {
    private readonly mail;
    private readonly logger;
    private readonly env;
    constructor(mail: MailService);
    sendInvite(userId: string, loginName: string): Promise<boolean>;
}
//# sourceMappingURL=login-invite.service.d.ts.map