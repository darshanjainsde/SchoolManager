/**
 * JWT payload shapes. Audience is encoded in `aud` AND is signed with a
 * distinct secret per audience — a school token literally cannot validate
 * against the platform secret.
 */
import type { UserRole } from '@skoolos/db';
export type Audience = 'school' | 'platform';
export interface SchoolJwtPayload {
    sub: string;
    aud: 'school';
    schoolId: string;
    role: UserRole;
    jti: string;
    /** Present (true) only on owner-impersonation sessions. */
    imp?: boolean;
    iat?: number;
    exp?: number;
}
export interface PlatformJwtPayload {
    sub: string;
    aud: 'platform';
    role: 'PLATFORM_OWNER' | 'PLATFORM_ADMIN' | 'OWNER';
    jti: string;
    iat?: number;
    exp?: number;
}
export type AnyJwtPayload = SchoolJwtPayload | PlatformJwtPayload;
//# sourceMappingURL=jwt-payload.d.ts.map