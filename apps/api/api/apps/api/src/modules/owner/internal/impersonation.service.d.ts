/**
 * Owner → school-admin login handoff. Mints a single-use 15-minute token and
 * returns the school-host URL that exchanges it (see POST /auth/impersonate).
 * The link host comes from the school's own DB record, mirroring the
 * password-reset link rules — never from request headers.
 */
export declare class ImpersonationService {
    private readonly logger;
    private readonly env;
    mint(schoolId: string): Promise<{
        url: string;
        expiresInSeconds: number;
    }>;
}
//# sourceMappingURL=impersonation.service.d.ts.map