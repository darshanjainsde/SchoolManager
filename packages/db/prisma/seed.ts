import { loadEnv } from '@skoolos/config';
loadEnv();
import { getPlatformPrisma, disconnectAll, DEFAULT_COURSES } from '@skoolos/db';
import { hash } from 'argon2';
import { authenticator } from 'otplib';

async function main() {
  const db = getPlatformPrisma();
  const PW = 'Passw0rd!';
  const OWNER_PW = 'OwnerPassw0rd!';

  // Platform owner (no school).
  const MFA_SECRET = 'AIRFGVZFLVAH6J2C';
  await db.user.upsert({
    where: { schoolId_email: { schoolId: null as unknown as string, email: 'owner@skoolos.local' } },
    update: { mfaSecret: MFA_SECRET },
    create: { email: 'owner@skoolos.local', passwordHash: await hash(OWNER_PW), role: 'OWNER', mfaSecret: MFA_SECRET },
  }).catch(async () => {
    // schoolId null can't use the compound unique in some Prisma versions; fall back to findFirst.
    const existing = await db.user.findFirst({ where: { email: 'owner@skoolos.local', schoolId: null } });
    if (!existing) {
      await db.user.create({ data: { email: 'owner@skoolos.local', passwordHash: await hash(OWNER_PW), role: 'OWNER', mfaSecret: MFA_SECRET } });
    } else {
      await db.user.update({ where: { id: existing.id }, data: { mfaSecret: MFA_SECRET } });
    }
  });
  console.log('Owner TOTP secret: AIRFGVZFLVAH6J2C  current code:', authenticator.generate(MFA_SECRET));

  for (const [slug, name, tier] of [
    ['acme', 'Acme International', 'STANDARD'],
    ['beacon', 'Beacon Public School', 'PRO'],
  ] as const) {
    const school = await db.school.upsert({
      where: { slug },
      update: { tier, status: 'LIVE' },
      create: { slug, name, tier, status: 'LIVE' },
    });
    await db.domain.upsert({
      where: { hostname: `${slug}.localhost` },
      update: {},
      create: { schoolId: school.id, hostname: `${slug}.localhost`, type: 'SUBDOMAIN', status: 'LIVE', isPrimary: true },
    });
    await db.user.upsert({
      where: { schoolId_email: { schoolId: school.id, email: `admin@${slug}.test` } },
      update: {},
      create: { schoolId: school.id, email: `admin@${slug}.test`, passwordHash: await hash(PW), role: 'SCHOOL_ADMIN' },
    });
    await db.schoolProfile.upsert({
      where: { schoolId: school.id },
      update: {},
      create: { schoolId: school.id, phone: '+91 98765 43210', email: `info@${slug}.test`, city: 'Bengaluru', country: 'India' },
    });
    await db.homepageContent.upsert({
      where: { schoolId: school.id },
      update: {},
      create: { schoolId: school.id, headline: `Welcome to ${name}`, subheadline: 'A future-ready school.' },
    });
    for (const [i, g] of ['Nursery', 'Grade 1', 'Grade 5', 'Grade 6'].entries()) {
      await db.grade.upsert({
        where: { schoolId_name: { schoolId: school.id, name: g } },
        update: {}, create: { schoolId: school.id, name: g, order: i },
      });
    }

    // Public-site courses (CMS content, all tiers). Idempotent by (schoolId, name).
    for (const [i, c] of DEFAULT_COURSES.entries()) {
      const existing = await db.course.findFirst({ where: { schoolId: school.id, name: c.name } });
      if (!existing) {
        await db.course.create({
          data: { ...c, highlights: [...c.highlights], schoolId: school.id, order: i },
        });
      }
    }

    if (tier === 'PRO') {
      const year = await db.academicYear.upsert({
        where: { schoolId_name: { schoolId: school.id, name: '2026-27' } },
        update: {}, create: { schoolId: school.id, name: '2026-27', startDate: new Date('2026-06-01'), endDate: new Date('2027-04-30'), isCurrent: true },
      });
      const grade5 = await db.grade.findFirstOrThrow({ where: { schoolId: school.id, name: 'Grade 5' } });

      // Teacher has no unique key — use findFirst+create to stay idempotent.
      let teacher = await db.teacher.findFirst({ where: { schoolId: school.id, email: 'meera@beacon.test' } });
      if (!teacher) {
        teacher = await db.teacher.create({
          data: { schoolId: school.id, firstName: 'Meera', lastName: 'Nair', email: 'meera@beacon.test' },
        });
      }

      // ClassSection unique: schoolId + gradeId + name + academicYearId.
      const section = await db.classSection.upsert({
        where: { schoolId_gradeId_name_academicYearId: { schoolId: school.id, gradeId: grade5.id, name: 'A', academicYearId: year.id } },
        update: { classTeacherId: teacher.id },
        create: { schoolId: school.id, gradeId: grade5.id, name: 'A', academicYearId: year.id, classTeacherId: teacher.id },
      });

      // Student unique: schoolId + admissionNo.
      await db.student.upsert({
        where: { schoolId_admissionNo: { schoolId: school.id, admissionNo: '05A-01' } },
        update: {},
        create: { schoolId: school.id, admissionNo: '05A-01', firstName: 'Aarav', lastName: 'Sharma', classSectionId: section.id, rollNo: '1', guardianName: 'Rohan Sharma', guardianPhone: '+91 90000 11111' },
      });
    }
  }

  console.log('\n──── SEED COMPLETE ────');
  console.log('Owner:  owner@skoolos.local /', OWNER_PW);
  console.log('Acme (STANDARD):   admin@acme.test /', PW, '→ http://acme.localhost');
  console.log('Beacon (PRO):      admin@beacon.test /', PW, '→ http://beacon.localhost');
  await disconnectAll();
}

main().catch((e) => { console.error(e); process.exit(1); });
