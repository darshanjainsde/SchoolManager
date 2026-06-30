/**
 * Test fixtures: seed two isolated schools with one of every role each, plus
 * a platform owner with a known TOTP secret. Each spec calls `resetAndSeed()`
 * in beforeEach to start from a clean slate.
 */
import argon2 from 'argon2';
import { authenticator } from 'otplib';
import Redis from 'ioredis';
import { PrismaClient } from '@skoolos/db';

export const TEST_PASSWORD = 'TestPassw0rd!';
export const PLATFORM_PASSWORD = 'PlatformPassw0rd!';

let _prisma: PrismaClient | undefined;

function prisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
  }
  return _prisma;
}

export async function closeFixtures(): Promise<void> {
  await _prisma?.$disconnect();
  _prisma = undefined;
}

/** Clear the tenant-resolution cache so test-to-test schoolId changes propagate. */
export async function clearTenantCache(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await redis.connect();
    const keys = await redis.keys('host:*');
    if (keys.length > 0) await redis.del(...keys);
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

export interface SeededUser {
  id: string;
  email: string;
  role:
    | 'SCHOOL_ADMIN'
    | 'TEACHER'
    | 'STUDENT'
    | 'PARENT'
    | 'STAFF';
  schoolId: string;
}

export interface SeededWorld {
  schoolA: { id: string; slug: string; admin: SeededUser; teacher: SeededUser; student: SeededUser; student2: SeededUser; parent: SeededUser; staff: SeededUser };
  schoolB: { id: string; slug: string; admin: SeededUser; teacher: SeededUser; student: SeededUser };
  platformOwner: { id: string; email: string; totpSecret: string };
}

export async function resetAndSeed(): Promise<SeededWorld> {
  const db = prisma();
  // Truncate all phase-1 tables.
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog",
      "PlatformRefreshToken",
      "PlatformUser",
      "RefreshToken",
      "ParentStudent",
      "ParentProfile",
      "TeacherProfile",
      "StudentProfile",
      "CustomDomain",
      "User",
      "School"
    RESTART IDENTITY CASCADE
  `);

  const passwordHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });

  async function mkSchool(slug: string, name: string) {
    return db.school.create({
      data: {
        slug,
        name,
        timezone: 'UTC',
        currency: 'USD',
        locale: 'en-US',
        subscriptionPlan: 'PRO',
        subscriptionStatus: 'ACTIVE',
      },
    });
  }

  async function mkUser(
    schoolId: string,
    email: string,
    role: SeededUser['role'],
    first: string,
    last: string,
  ): Promise<SeededUser> {
    const u = await db.user.create({
      data: {
        schoolId,
        email,
        role,
        firstName: first,
        lastName: last,
        passwordHash,
        isActive: true,
      },
    });
    if (role === 'STUDENT') {
      await db.studentProfile.create({ data: { schoolId, userId: u.id } });
    } else if (role === 'TEACHER') {
      await db.teacherProfile.create({ data: { schoolId, userId: u.id } });
    } else if (role === 'PARENT') {
      await db.parentProfile.create({ data: { schoolId, userId: u.id } });
    }
    return { id: u.id, email: u.email, role, schoolId };
  }

  const a = await mkSchool('alpha', 'Alpha Academy');
  const b = await mkSchool('bravo', 'Bravo School');

  const totpSecret = authenticator.generateSecret();
  const platformOwner = await db.platformUser.create({
    data: {
      email: 'owner@test.local',
      passwordHash: await argon2.hash(PLATFORM_PASSWORD, { type: argon2.argon2id }),
      role: 'PLATFORM_OWNER',
      totpSecret,
    },
  });

  const result: SeededWorld = {
    schoolA: {
      id: a.id,
      slug: a.slug,
      admin: await mkUser(a.id, 'admin@alpha.test', 'SCHOOL_ADMIN', 'Ada', 'Admin'),
      teacher: await mkUser(a.id, 'teacher@alpha.test', 'TEACHER', 'Tara', 'Teacher'),
      student: await mkUser(a.id, 'student@alpha.test', 'STUDENT', 'Sam', 'Student'),
      student2: await mkUser(a.id, 'student2@alpha.test', 'STUDENT', 'Sky', 'Student'),
      parent: await mkUser(a.id, 'parent@alpha.test', 'PARENT', 'Pat', 'Parent'),
      staff: await mkUser(a.id, 'staff@alpha.test', 'STAFF', 'Sage', 'Staff'),
    },
    schoolB: {
      id: b.id,
      slug: b.slug,
      admin: await mkUser(b.id, 'admin@bravo.test', 'SCHOOL_ADMIN', 'Bea', 'Boss'),
      teacher: await mkUser(b.id, 'teacher@bravo.test', 'TEACHER', 'Ben', 'Teach'),
      student: await mkUser(b.id, 'student@bravo.test', 'STUDENT', 'Bo', 'Student'),
    },
    platformOwner: { id: platformOwner.id, email: platformOwner.email, totpSecret },
  };
  return result;
}

export function currentTotp(secret: string): string {
  return authenticator.generate(secret);
}
