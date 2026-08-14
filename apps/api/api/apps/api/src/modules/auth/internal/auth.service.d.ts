import { JwtService } from '@nestjs/jwt';
import type { UserRole } from '@skoolos/db';
import { PasswordService } from './password.service';
export interface IssuedTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
export declare class AuthService {
    private readonly jwt;
    private readonly passwords;
    private readonly logger;
    private readonly env;
    constructor(jwt: JwtService, passwords: PasswordService);
    /**
     * Look up by (schoolId, identifier), where identifier is an email address,
     * a login username, or a student admission number (web-first portals,
     * Phase 2A). User row lookup uses the platform connection because we have
     * not yet established the request's tenant scope from a JWT; the schoolId
     * is trusted because it comes from the tenant-resolved Host.
     */
    login(schoolId: string, identifier: string, password: string): Promise<IssuedTokens>;
    refresh(rawToken: string): Promise<IssuedTokens>;
    /**
     * Exchanges a single-use owner-minted impersonation token for a short-lived
     * school-admin session. No refresh token is issued — the session hard-ends
     * when the access token expires, and the `imp` claim lets the UI show an
     * "Owner view" banner.
     */
    impersonate(schoolId: string, rawToken: string): Promise<{
        accessToken: string;
        expiresIn: number;
        impersonated: true;
    }>;
    logout(schoolId: string, rawToken: string): Promise<void>;
    private issueTokens;
    private signAccess;
    private signRefresh;
    /**
     * Non-email identifiers can be a login username (students or teachers may
     * have one) or a student admission number. Username is tried first —
     * cheap, direct lookup — then falls through to the admission-number path.
     * Either miss falls through to the SAME generic "Invalid credentials" the
     * caller already throws for a null result — no enumeration either way.
     */
    private resolveUserByUsernameOrAdmissionNo;
    /** Resolves a student's linked User by their RAF-00042 code (case-insensitive). */
    private resolveUserByStudentCode;
    /**
     * Resolves a student's linked User by admission number (case-insensitive).
     * Returns null (never throws) for an unknown admission number or a student
     * with no linked account, so the caller can fall through to the same
     * generic "Invalid credentials" response used for the email path — no
     * enumeration of which admission numbers exist.
     */
    private resolveUserByAdmissionNo;
    private recordFailedAttempt;
    /**
     * THE PERSON'S OWN NAME, for greeting them by it.
     *
     * `User` carries credentials, not identity — it has an email and a username
     * and no name column at all. With nothing better to hand, the app stored
     * whatever was typed into the login box and greeted teachers with their own
     * email address across the top of the home screen.
     *
     * The name lives on whichever role record points back at the user. The role
     * on the JWT says which table to read, but it is only a hint: an account can
     * be re-roled, and a SCHOOL_ADMIN is usually a Staff row. So the hinted table
     * is tried first and the others after, rather than trusting the hint alone
     * and returning nothing.
     *
     * Returns null when no role record claims the user — a real state for a fresh
     * admin invited by email before any staff record exists. Callers must render
     * something sensible instead of the word "null".
     */
    displayNameFor(schoolId: string, userId: string, role: UserRole): Promise<string | null>;
}
//# sourceMappingURL=auth.service.d.ts.map