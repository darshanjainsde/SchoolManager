import { JwtService } from '@nestjs/jwt';
import { PasswordService } from '../../auth';
export interface IssuedTokens {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}
/** Constant-time password check (compares sha256 digests, so length never leaks). */
export declare function gatePasswordMatches(candidate: string, expected: string | undefined): boolean;
/** Pure, unit-testable TOTP check (window ±1 step for clock skew). */
export declare function verifyTotp(code: string, secret: string | null): boolean;
export declare class OwnerAuthService {
    private readonly jwt;
    private readonly passwords;
    private readonly env;
    private readonly logger;
    constructor(jwt: JwtService, passwords: PasswordService);
    login(email: string, password: string, totp?: string): Promise<IssuedTokens>;
    /**
     * Single-password console unlock for sckools.com/owner. Issues the same
     * platform tokens as email login, for the (single) OWNER user. Disabled
     * (503) unless OWNER_GATE_PASSWORD is configured.
     */
    gateLogin(password: string): Promise<IssuedTokens>;
    refresh(rawToken: string): Promise<IssuedTokens>;
    private issue;
    private recordFailedAttempt;
}
//# sourceMappingURL=owner-auth.service.d.ts.map