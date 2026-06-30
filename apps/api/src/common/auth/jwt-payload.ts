/**
 * JWT payload shapes. Audience is encoded in `aud` AND is signed with a
 * distinct secret per audience — a school token literally cannot validate
 * against the platform secret.
 */

export type Audience = 'school' | 'platform';

export interface SchoolJwtPayload {
  sub: string;          // userId
  aud: 'school';
  schoolId: string;
  role: 'SCHOOL_ADMIN' | 'TEACHER' | 'STUDENT' | 'PARENT' | 'STAFF';
  jti: string;
  iat?: number;
  exp?: number;
}

export interface PlatformJwtPayload {
  sub: string;          // platformUserId
  aud: 'platform';
  role: 'PLATFORM_OWNER' | 'PLATFORM_ADMIN';
  jti: string;
  iat?: number;
  exp?: number;
}

export type AnyJwtPayload = SchoolJwtPayload | PlatformJwtPayload;
