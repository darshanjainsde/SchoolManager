/**
 * Shared e2e test helpers.
 *
 * The rest of the e2e suite (management.e2e-spec.ts, student.e2e-spec.ts,
 * cms.e2e-spec.ts, ...) exercises a SEPARATELY BOOTED API on localhost:3001
 * via raw fetch(), authenticating through real POST /auth/login calls
 * against a couple of hand-seeded schools (acme, beacon). That's the right
 * shape for suites that want to prove the login flow itself.
 *
 * management-authz.e2e-spec.ts instead boots the Nest app in-process
 * (Test.createTestingModule + supertest) and needs three roles
 * (STUDENT/TEACHER/SCHOOL_ADMIN) on a disposable school with no interest in
 * password auth — minting tokens directly is both faster and keeps the
 * authorization test independent of the login module. `signSchoolToken` and
 * `seedMinimalSchool` below exist for that purpose; they mirror
 * AuthService.signAccess()'s payload shape exactly (see
 * src/modules/auth/internal/auth.service.ts) so a minted token is
 * indistinguishable from one issued by a real login.
 */
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '@skoolos/config';
import { getPlatformPrisma } from '@skoolos/db';
import type { UserRole } from '@skoolos/db';
import type { SchoolJwtPayload } from '../../src/common/auth/jwt-payload';

const jwt = new JwtService();

/**
 * Mints a school-audience access token without going through /auth/login.
 * Signed with the same secret/claims AuthService.signAccess() uses, so
 * SchoolJwtGuard accepts it exactly as it would a real login token.
 */
export function signSchoolToken(claims: {
  sub: string;
  schoolId: string;
  role: UserRole;
}): string {
  const env = loadEnv();
  const payload: Omit<SchoolJwtPayload, 'iat' | 'exp'> = {
    sub: claims.sub,
    aud: 'school',
    schoolId: claims.schoolId,
    role: claims.role,
    jti: randomUUID(),
  };
  return jwt.sign(payload, {
    secret: env.JWT_SCHOOL_ACCESS_SECRET,
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

/**
 * Mints a platform-audience token the way owner-auth.service does, so
 * PlatformJwtGuard accepts it — for asserting the operator desk's wall
 * without walking the TOTP login.
 */
export function signPlatformToken(sub = randomUUID()): string {
  const env = loadEnv();
  const payload = { sub, aud: 'platform' as const, role: 'PLATFORM_OWNER' as const, jti: randomUUID() };
  return jwt.sign(payload, {
    secret: env.JWT_PLATFORM_ACCESS_SECRET,
    expiresIn: env.JWT_ACCESS_TTL,
  });
}

export interface MinimalSchool {
  schoolId: string;
  host: string;
  studentUserId: string;
  teacherUserId: string;
  /** A SECOND, distinct teacher — for tests that need to prove one teacher cannot act on another's rows (e.g. announcement authorship). */
  teacherUserId2: string;
  adminUserId: string;
  /** A non-teaching Staff login — role STAFF, with a linked `Staff` row (see `Staff.userId`). */
  staffUserId: string;
}

/**
 * Creates a disposable PRO-tier school (PRO includes the MANAGEMENT feature
 * — see packages/db/src/features.ts) with one User per role, via the
 * platform Prisma client (BYPASSRLS), so no login/invite flow is needed.
 * `host` resolves the same way beacon.localhost / acme.localhost do: a
 * subdomain of PLATFORM_HOST (defaults to "localhost") matching the
 * school's slug — see school-lookup.service.ts.
 */
export async function seedMinimalSchool(): Promise<MinimalSchool> {
  const db = getPlatformPrisma();
  const slug = `authz-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const school = await db.school.create({
    data: { slug, name: `Authz Test School ${slug}`, tier: 'PRO', status: 'LIVE' },
  });

  // Real hash so these rows would also work if a future suite reuses them
  // for a genuine login — never actually exercised by this suite.
  const passwordHash = await argon2.hash('not-used-in-this-suite', { type: argon2.argon2id });

  const [student, teacher, teacher2, admin, staffUser] = await Promise.all([
    db.user.create({
      data: { schoolId: school.id, email: `student@${slug}.test`, role: 'STUDENT', passwordHash },
    }),
    db.user.create({
      data: { schoolId: school.id, email: `teacher@${slug}.test`, role: 'TEACHER', passwordHash },
    }),
    db.user.create({
      data: { schoolId: school.id, email: `teacher2@${slug}.test`, role: 'TEACHER', passwordHash },
    }),
    db.user.create({
      data: { schoolId: school.id, email: `admin@${slug}.test`, role: 'SCHOOL_ADMIN', passwordHash },
    }),
    db.user.create({
      data: { schoolId: school.id, email: `staff@${slug}.test`, role: 'STAFF', passwordHash },
    }),
  ]);

  // The Staff row is what `StaffAttendanceService.mine` resolves the caller
  // from (`Staff.userId`) — a STAFF-role User with no linked Staff row would
  // fail `mine()` with NOT_STAFF, which is not what this fixture is for.
  await db.staff.create({
    data: {
      schoolId: school.id,
      firstName: 'Sam',
      lastName: 'Staff',
      role: 'OFFICE',
      userId: staffUser.id,
    },
  });

  const env = loadEnv();
  return {
    schoolId: school.id,
    host: `${slug}.${env.PLATFORM_HOST}`,
    studentUserId: student.id,
    teacherUserId: teacher.id,
    teacherUserId2: teacher2.id,
    adminUserId: admin.id,
    staffUserId: staffUser.id,
  };
}
