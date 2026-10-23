/**
 * JWT payload shapes. Audience is encoded in `aud` AND is signed with a
 * distinct secret per audience — a school token literally cannot validate
 * against the platform secret.
 */
import type { UserRole } from '@skoolos/db';

export type Audience = 'school' | 'platform' | 'promoter';

export interface SchoolJwtPayload {
  sub: string;          // userId
  aud: 'school';
  schoolId: string;
  role: UserRole;
  jti: string;
  /** Present (true) only on owner-impersonation sessions. */
  imp?: boolean;
  /** The platform user behind an impersonation session, for the audit trail.
   *  Absent on sessions minted before attribution existed. */
  impBy?: string;
  iat?: number;
  exp?: number;
}

export interface PlatformJwtPayload {
  sub: string;          // platformUserId
  aud: 'platform';
  role: 'PLATFORM_OWNER' | 'PLATFORM_ADMIN' | 'OWNER';
  jti: string;
  iat?: number;
  exp?: number;
}

/**
 * Refer & Earn. Signed with a secret DERIVED from the platform secret
 * (HMAC-SHA256 of it with the label "promoter"), so it is distinct from both
 * real secrets without a new environment variable in three places. `ver`
 * must equal the promoter's tokenVersion: suspend/remove bumps it, and every
 * earlier token dies at its next request.
 */
export interface PromoterJwtPayload {
  sub: string;          // promoterId
  aud: 'promoter';
  ver: number;
  jti: string;
  iat?: number;
  exp?: number;
}

/** The two payloads `CurrentUser` can hand out. A promoter is never a `user`; its guard attaches `req.promoter` instead. */
export type AnyJwtPayload = SchoolJwtPayload | PlatformJwtPayload;
