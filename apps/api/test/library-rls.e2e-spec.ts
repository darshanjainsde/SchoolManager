import { randomUUID } from 'node:crypto';
import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';

/**
 * RLS on the seven Library Wing tables (migration 20260816090000_library_wing)
 * — the same shape as new-models-rls.e2e-spec.ts: seed two schools on the
 * platform (BYPASSRLS) client, then prove the tenant client sees only its own
 * rows and cannot forge a row for the other school. Nothing in the library is
 * ever read cross-tenant, so single-tenant isolation is the whole contract.
 */
describe('RLS on the library tables', () => {
  let acmeId: string;
  let beaconId: string;
  let acmeCopy: string;
  let beaconCopy: string;
  let acmeStudent: string;
  let acmeIssue: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const acme = await p.school.upsert({
      where: { slug: 'rls-lib-acme' },
      update: {},
      create: { slug: 'rls-lib-acme', name: 'Lib Acme', tier: 'PRO', status: 'LIVE' },
    });
    const beacon = await p.school.upsert({
      where: { slug: 'rls-lib-beacon' },
      update: {},
      create: { slug: 'rls-lib-beacon', name: 'Lib Beacon', tier: 'PRO', status: 'LIVE' },
    });
    acmeId = acme.id;
    beaconId = beacon.id;

    await p.librarySettings.upsert({
      where: { schoolId: acmeId },
      update: {},
      create: { schoolId: acmeId },
    });
    await p.librarySettings.upsert({
      where: { schoolId: beaconId },
      update: {},
      create: { schoolId: beaconId, fineTeachers: true },
    });

    const acmeTitle = await p.libraryBookTitle.create({
      data: { schoolId: acmeId, title: 'Acme Matilda', author: 'Roald Dahl' },
    });
    const beaconTitle = await p.libraryBookTitle.create({
      data: { schoolId: beaconId, title: 'Beacon Wonder', author: 'R.J. Palacio' },
    });
    acmeCopy = (
      await p.libraryBookCopy.create({
        data: { schoolId: acmeId, titleId: acmeTitle.id, accessionNo: 'B-00001' },
      })
    ).id;
    beaconCopy = (
      await p.libraryBookCopy.create({
        data: { schoolId: beaconId, titleId: beaconTitle.id, accessionNo: 'B-00001' },
      })
    ).id;

    acmeStudent = (
      await p.student.create({
        data: {
          schoolId: acmeId,
          admissionNo: `LIB-${randomUUID().slice(0, 8)}`,
          firstName: 'Ananya',
          lastName: 'Rao',
        },
      })
    ).id;

    acmeIssue = (
      await p.libraryIssue.create({
        data: {
          schoolId: acmeId,
          copyId: acmeCopy,
          studentId: acmeStudent,
          issuedOn: new Date('2026-08-02'),
          dueOn: new Date('2026-08-16'),
          issuedById: randomUUID(),
        },
      })
    ).id;
    await p.libraryFine.create({
      data: {
        schoolId: acmeId,
        issueId: acmeIssue,
        studentId: acmeStudent,
        amountRupees: 10,
        reason: 'LATE',
      },
    });
    const visit = await p.libraryHallVisit.create({
      data: {
        schoolId: acmeId,
        classSectionId: randomUUID(),
        date: new Date('2026-08-16'),
        source: 'SYNCED',
        savedById: randomUUID(),
      },
    });
    await p.libraryHallMark.create({
      data: { schoolId: acmeId, visitId: visit.id, studentId: acmeStudent, status: 'PRESENT' },
    });
  });

  afterAll(async () => {
    await disconnectAll();
  });

  it('settings: each school reads exactly its own row', async () => {
    const mine = await withTenant(acmeId, (tx) => tx.librarySettings.findMany());
    expect(mine.length).toBe(1);
    expect(mine[0].schoolId).toBe(acmeId);
    expect(mine[0].fineTeachers).toBe(false);
    const theirs = await withTenant(beaconId, (tx) => tx.librarySettings.findMany());
    expect(theirs.length).toBe(1);
    expect(theirs[0].fineTeachers).toBe(true);
  });

  it('catalogue: titles and copies are invisible across the fence', async () => {
    const acmeTitles = await withTenant(acmeId, (tx) => tx.libraryBookTitle.findMany());
    expect(acmeTitles.map((t) => t.title)).toEqual(['Acme Matilda']);
    const beaconSees = await withTenant(beaconId, (tx) =>
      tx.libraryBookCopy.findMany({ where: { id: acmeCopy } }),
    );
    expect(beaconSees.length).toBe(0);
  });

  it('a tenant cannot forge a title owned by another school', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.libraryBookTitle.create({ data: { schoolId: beaconId, title: 'forged', author: 'x' } }),
      ),
    ).rejects.toThrow(/row-level security|42501/);
  });

  it('issues and fines: only the owning school reads them', async () => {
    const mine = await withTenant(acmeId, (tx) => tx.libraryIssue.findMany());
    expect(mine.map((i) => i.id)).toEqual([acmeIssue]);
    expect(await withTenant(beaconId, (tx) => tx.libraryIssue.findMany())).toEqual([]);
    expect((await withTenant(acmeId, (tx) => tx.libraryFine.findMany())).length).toBe(1);
    expect(await withTenant(beaconId, (tx) => tx.libraryFine.findMany())).toEqual([]);
  });

  it('a tenant cannot issue against another school (even its own copy id)', async () => {
    await expect(
      withTenant(beaconId, (tx) =>
        tx.libraryIssue.create({
          data: {
            schoolId: acmeId,
            copyId: beaconCopy,
            studentId: acmeStudent,
            issuedOn: new Date('2026-08-16'),
            dueOn: new Date('2026-08-30'),
            issuedById: randomUUID(),
          },
        }),
      ),
    ).rejects.toThrow(/row-level security|42501|foreign key/);
  });

  it('hall visits and marks stay behind the fence', async () => {
    expect((await withTenant(acmeId, (tx) => tx.libraryHallVisit.findMany())).length).toBe(1);
    expect(await withTenant(beaconId, (tx) => tx.libraryHallVisit.findMany())).toEqual([]);
    expect((await withTenant(acmeId, (tx) => tx.libraryHallMark.findMany())).length).toBe(1);
    expect(await withTenant(beaconId, (tx) => tx.libraryHallMark.findMany())).toEqual([]);
  });

  it('the open-copy partial unique index blocks a double issue of one copy', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.libraryIssue.create({
          data: {
            schoolId: acmeId,
            copyId: acmeCopy,
            studentId: acmeStudent,
            issuedOn: new Date('2026-08-16'),
            dueOn: new Date('2026-08-30'),
            issuedById: randomUUID(),
          },
        }),
      ),
    ).rejects.toThrow(/Unique constraint|P2002|open_copy/);
  });
});
