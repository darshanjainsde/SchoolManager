import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';
import type { PrismaClient } from '@skoolos/db';

describe('RLS on the new management tables', () => {
  let acmeId: string;
  let beaconId: string;
  let acmeSection: string;
  let beaconSection: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const acme = await p.school.upsert({
      where: { slug: 'rls-acme' },
      update: {},
      create: { slug: 'rls-acme', name: 'Acme', tier: 'STANDARD', status: 'LIVE' },
    });
    const beacon = await p.school.upsert({
      where: { slug: 'rls-beacon' },
      update: {},
      create: { slug: 'rls-beacon', name: 'Beacon', tier: 'PRO', status: 'LIVE' },
    });
    acmeId = acme.id;
    beaconId = beacon.id;
    // Build one class section per school. Read test/management.e2e-spec.ts for
    // the exact academicYear/grade scaffolding this needs and reuse it.
    acmeSection = await makeSection(p, acmeId, 'A');
    beaconSection = await makeSection(p, beaconId, 'B');

    await p.classNote.create({
      data: { schoolId: acmeId, classSectionId: acmeSection, date: new Date('2026-08-03'),
              body: 'acme note', authorTeacherId: acmeId },
    });
    await p.classNote.create({
      data: { schoolId: beaconId, classSectionId: beaconSection, date: new Date('2026-08-03'),
              body: 'beacon note', authorTeacherId: beaconId },
    });
  });

  afterAll(async () => { await disconnectAll(); });

  it('a tenant sees only its own class notes', async () => {
    const rows = await withTenant(acmeId, (tx) => tx.classNote.findMany());
    expect(rows.length).toBe(1);
    expect(rows[0].body).toBe('acme note');
  });

  it('a tenant cannot forge a note owned by another school', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.classNote.create({
          data: { schoolId: beaconId, classSectionId: beaconSection,
                  date: new Date('2026-08-03'), body: 'x', authorTeacherId: acmeId },
        }),
      ),
    ).rejects.toThrow(/row-level security|42501/);
  });

  it('a tenant sees only its own register change requests', async () => {
    await withTenant(acmeId, (tx) =>
      tx.registerChangeRequest.create({
        data: { schoolId: acmeId, classSectionId: acmeSection, date: new Date('2026-07-31'),
                requestedByTeacherId: acmeId, reason: 'late slip' },
      }),
    );
    const mine = await withTenant(acmeId, (tx) => tx.registerChangeRequest.findMany());
    const theirs = await withTenant(beaconId, (tx) => tx.registerChangeRequest.findMany());
    expect(mine.length).toBe(1);
    expect(theirs.length).toBe(0);
  });
});

/**
 * Creates a minimal AcademicYear + Grade + ClassSection for `schoolId` and
 * returns the ClassSection id. Field requirements copied from
 * packages/db/prisma/schema.prisma (AcademicYear, Grade, ClassSection).
 */
async function makeSection(
  p: PrismaClient,
  schoolId: string,
  label: string,
): Promise<string> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const academicYear = await p.academicYear.create({
    data: {
      schoolId,
      name: `AY-${label}-${suffix}`,
      startDate: new Date('2026-06-01'),
      endDate: new Date('2027-03-31'),
      isCurrent: true,
    },
  });
  const grade = await p.grade.create({
    data: { schoolId, name: `Grade-${label}-${suffix}`, order: 1 },
  });
  const classSection = await p.classSection.create({
    data: {
      schoolId,
      gradeId: grade.id,
      academicYearId: academicYear.id,
      name: `Section-${label}-${suffix}`,
    },
  });
  return classSection.id;
}
