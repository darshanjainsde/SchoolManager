/**
 * Seed: 2 schools (Acme Academy, Beacon Hill) + a full set of users per
 * school + 1 platform owner. Deterministic — re-running upserts in place
 * rather than duplicating rows. Demo credentials are printed at the end.
 */
import { loadEnv } from '@skoolos/config'; // ensures .env is loaded before Prisma reads DATABASE_URL
loadEnv();

import argon2 from 'argon2';
import { authenticator } from 'otplib';
import { Prisma, PrismaClient, UserRole, PlatformRole } from '@prisma/client';

// Migrations + seeding run as the superuser so we don't fight RLS here.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const DEMO_PASSWORD = 'Passw0rd!';
const PLATFORM_PASSWORD = 'OwnerPassw0rd!';

async function hash(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

async function upsertSchool(slug: string, name: string) {
  return prisma.school.upsert({
    where: { slug },
    update: { name },
    create: {
      slug,
      name,
      timezone: 'America/Los_Angeles',
      currency: 'USD',
      locale: 'en-US',
      subscriptionPlan: 'PRO',
      subscriptionStatus: 'ACTIVE',
      brandColors: { primary: '#0f766e' } as Prisma.InputJsonValue,
    },
  });
}

async function upsertUser(
  schoolId: string,
  email: string,
  role: UserRole,
  first: string,
  last: string,
  passwordHash: string,
) {
  const user = await prisma.user.upsert({
    where: { schoolId_email: { schoolId, email } },
    update: {
      role,
      firstName: first,
      lastName: last,
      passwordHash,
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
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
    await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { schoolId, userId: user.id },
    });
  } else if (role === 'TEACHER') {
    await prisma.teacherProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { schoolId, userId: user.id },
    });
  } else if (role === 'PARENT') {
    await prisma.parentProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: { schoolId, userId: user.id },
    });
  }
  return user;
}

async function main() {
  const passwordHash = await hash(DEMO_PASSWORD);

  const acme = await upsertSchool('acme', 'Acme Academy');
  const beacon = await upsertSchool('beacon', 'Beacon Hill School');

  for (const school of [acme, beacon]) {
    const tag = school.slug;
    await upsertUser(school.id, `admin@${tag}.test`, 'SCHOOL_ADMIN', 'Ada', 'Admin', passwordHash);
    await upsertUser(school.id, `teacher@${tag}.test`, 'TEACHER', 'Tara', 'Teacher', passwordHash);
    await upsertUser(school.id, `student@${tag}.test`, 'STUDENT', 'Sam', 'Student', passwordHash);
    await upsertUser(school.id, `parent@${tag}.test`, 'PARENT', 'Pat', 'Parent', passwordHash);
    await upsertUser(school.id, `staff@${tag}.test`, 'STAFF', 'Sage', 'Staff', passwordHash);
  }

  // Platform owner — TOTP secret is regenerated only if the row is new, so
  // re-running the seed keeps an existing owner's authenticator working.
  const existingOwner = await prisma.platformUser.findUnique({
    where: { email: 'owner@skoolos.local' },
  });
  const totpSecret = existingOwner?.totpSecret ?? authenticator.generateSecret();
  await prisma.platformUser.upsert({
    where: { email: 'owner@skoolos.local' },
    update: {
      passwordHash: await hash(PLATFORM_PASSWORD),
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
    create: {
      email: 'owner@skoolos.local',
      passwordHash: await hash(PLATFORM_PASSWORD),
      role: PlatformRole.PLATFORM_OWNER,
      totpSecret,
    },
  });

  const otpauth = authenticator.keyuri('owner@skoolos.local', 'SkoolOS Platform', totpSecret);

  console.log('\n──────────────── SEED COMPLETE ────────────────');
  console.log('School subdomains (use locally with Host header):');
  console.log(`  Acme:   http://acme.localhost:3001`);
  console.log(`  Beacon: http://beacon.localhost:3001`);
  console.log('\nSchool demo users (password: Passw0rd! for ALL):');
  for (const slug of ['acme', 'beacon']) {
    for (const role of ['admin', 'teacher', 'student', 'parent', 'staff']) {
      console.log(`  ${role}@${slug}.test`);
    }
  }
  console.log('\nPlatform owner (host: owner.localhost):');
  console.log(`  email:    owner@skoolos.local`);
  console.log(`  password: ${PLATFORM_PASSWORD}`);
  console.log(`  TOTP secret (base32): ${totpSecret}`);
  console.log(`  otpauth URL:          ${otpauth}`);
  console.log(`  Current TOTP code:    ${authenticator.generate(totpSecret)}`);
  console.log('───────────────────────────────────────────────\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
