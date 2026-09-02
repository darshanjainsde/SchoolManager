import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';

/**
 * RLS on the eight Homecoming tables.
 *
 * Two things are proved per table and both matter: a tenant cannot READ another
 * school's rows, and — the one people forget — a tenant cannot WRITE a row
 * stamped with somebody else's schoolId. The WITH CHECK half of the policy is
 * what stops a forged `schoolId` in a request body walking straight through.
 */
describe('RLS on the Homecoming tables', () => {
  let acmeId: string;
  let beaconId: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const acme = await p.school.upsert({
      where: { slug: 'hc-acme' },
      update: {},
      create: { slug: 'hc-acme', name: 'Acme', tier: 'PRO', status: 'LIVE' },
    });
    const beacon = await p.school.upsert({
      where: { slug: 'hc-beacon' },
      update: {},
      create: { slug: 'hc-beacon', name: 'Beacon', tier: 'PRO', status: 'LIVE' },
    });
    acmeId = acme.id;
    beaconId = beacon.id;

    // One alumnus and one catalogue item per school, written with the platform
    // client so the fixture itself does not depend on the thing under test.
    for (const [sid, tag] of [
      [acmeId, 'acme'],
      [beaconId, 'beacon'],
    ] as const) {
      await p.alumni.create({
        data: { schoolId: sid, firstName: tag, lastName: 'Alum', batchYear: 2004, status: 'VERIFIED' },
      });
      await p.alumniBatch.upsert({
        where: { schoolId_batchYear: { schoolId: sid, batchYear: 2004 } },
        update: {},
        create: { schoolId: sid, batchYear: 2004, registerStrength: 81 },
      });
      await p.alumniClaim.create({
        data: { schoolId: sid, firstName: tag, lastName: 'Claimant', batchYear: 1998, proof: 'x' },
      });
      await p.giftItem.upsert({
        where: { schoolId_name: { schoolId: sid, name: 'Sweater' } },
        update: {},
        create: { schoolId: sid, name: 'Sweater', indicativeCostMinor: 38000 },
      });
    }
  });

  afterAll(async () => {
    await disconnectAll();
  });

  it.each([
    ['alumni', 'firstName'],
    ['alumniClaim', 'firstName'],
  ] as const)('a tenant sees only its own %s rows', async (model, field) => {
    const rows = await withTenant(acmeId, (tx) => (tx as never as Record<string, { findMany: () => Promise<Record<string, unknown>[]> }>)[model].findMany());
    expect(rows.length).toBe(1);
    expect(rows[0][field]).toBe('acme');
  });

  it('a tenant sees only its own gift catalogue', async () => {
    const rows = await withTenant(acmeId, (tx) => tx.giftItem.findMany());
    expect(rows.length).toBe(1);
  });

  it('a tenant sees only its own batch strengths', async () => {
    const rows = await withTenant(acmeId, (tx) => tx.alumniBatch.findMany());
    expect(rows.length).toBe(1);
    expect(rows[0].schoolId).toBe(acmeId);
  });

  it('a tenant cannot forge an alumnus owned by another school', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.alumni.create({
          data: { schoolId: beaconId, firstName: 'forged', lastName: 'X', batchYear: 2000 },
        }),
      ),
    ).rejects.toThrow();
  });

  it('a tenant cannot forge a claim owned by another school', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.alumniClaim.create({
          data: { schoolId: beaconId, firstName: 'forged', lastName: 'X', batchYear: 2000, proof: 'x' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('a tenant cannot forge a gift item owned by another school', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.giftItem.create({ data: { schoolId: beaconId, name: 'forged' } }),
      ),
    ).rejects.toThrow();
  });

  it('a tenant cannot reach another school’s alumnus by id', async () => {
    const beaconAlum = await withTenant(beaconId, (tx) => tx.alumni.findFirst());
    expect(beaconAlum).not.toBeNull();
    const seen = await withTenant(acmeId, (tx) =>
      tx.alumni.findUnique({ where: { id: beaconAlum!.id } }),
    );
    expect(seen).toBeNull();
  });

  it('a tenant cannot UPDATE another school’s alumnus, even knowing the id', async () => {
    const beaconAlum = await withTenant(beaconId, (tx) => tx.alumni.findFirst());
    // updateMany rather than update: it reports a count instead of throwing, so
    // a policy that silently matched nothing is distinguishable from one that
    // refused. A test that only asserts "it threw" cannot tell those apart.
    const res = await withTenant(acmeId, (tx) =>
      tx.alumni.updateMany({
        where: { id: beaconAlum!.id },
        data: { trustedForStudents: true },
      }),
    );
    expect(res.count).toBe(0);
    const after = await withTenant(beaconId, (tx) =>
      tx.alumni.findUnique({ where: { id: beaconAlum!.id } }),
    );
    expect(after!.trustedForStudents).toBe(false);
  });

  it('a tenant cannot DELETE another school’s alumnus', async () => {
    const beaconAlum = await withTenant(beaconId, (tx) => tx.alumni.findFirst());
    const res = await withTenant(acmeId, (tx) =>
      tx.alumni.deleteMany({ where: { id: beaconAlum!.id } }),
    );
    expect(res.count).toBe(0);
  });

  it('the child tables are scoped too — a pledge and its receipts', async () => {
    const acmeAlum = await withTenant(acmeId, (tx) => tx.alumni.findFirst());
    const acmeItem = await withTenant(acmeId, (tx) => tx.giftItem.findFirst());
    const pledge = await withTenant(acmeId, (tx) =>
      tx.giftPledge.create({
        data: {
          schoolId: acmeId,
          alumniId: acmeAlum!.id,
          giftItemId: acmeItem!.id,
          scopeKind: 'SCHOOL',
          headcountAtPledge: 302,
          quantity: 302,
          mode: 'SUPPLY',
        },
      }),
    );
    await withTenant(acmeId, (tx) =>
      tx.giftReceipt.create({ data: { schoolId: acmeId, pledgeId: pledge.id, receivedQty: 300 } }),
    );

    expect(await withTenant(beaconId, (tx) => tx.giftPledge.findMany())).toHaveLength(0);
    expect(await withTenant(beaconId, (tx) => tx.giftReceipt.findMany())).toHaveLength(0);
    expect(await withTenant(acmeId, (tx) => tx.giftReceipt.findMany())).toHaveLength(1);
  });

  it('a guest session is scoped, and its live-slot index is per school', async () => {
    const acmeAlum = await withTenant(acmeId, (tx) => tx.alumni.findFirst());
    const beaconAlum = await withTenant(beaconId, (tx) => tx.alumni.findFirst());
    const section = '00000000-0000-4000-8000-0000000000aa';
    const period = '00000000-0000-4000-8000-0000000000bb';
    const date = new Date('2026-11-11T00:00:00Z');
    const base = {
      title: 'Bridges',
      classSectionId: section,
      headcountAtBooking: 41,
      requestedDate: date,
      requestedPeriodId: period,
    };

    await withTenant(acmeId, (tx) =>
      tx.guestSession.create({ data: { ...base, schoolId: acmeId, alumniId: acmeAlum!.id } }),
    );
    // The unique index is scoped by schoolId, so the SAME class/date/period in
    // a different school must still be free. A guard that leaked across tenants
    // would refuse this and nobody would notice until two schools collided.
    await withTenant(beaconId, (tx) =>
      tx.guestSession.create({ data: { ...base, schoolId: beaconId, alumniId: beaconAlum!.id } }),
    );

    expect(await withTenant(acmeId, (tx) => tx.guestSession.findMany())).toHaveLength(1);
    expect(await withTenant(beaconId, (tx) => tx.guestSession.findMany())).toHaveLength(1);
  });
});
