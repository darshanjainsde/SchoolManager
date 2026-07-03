import { getPlatformPrisma, withTenant, disconnectAll } from '@skoolos/db';

describe('RLS tenant isolation', () => {
  let acmeId: string;
  let beaconId: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();

    // Upsert schools so this spec is self-sufficient on a freshly-migrated
    // test DB (globalSetup runs migrations but not the seed script).
    const acme = await p.school.upsert({
      where: { slug: 'acme' },
      update: {},
      create: { slug: 'acme', name: 'Acme International', tier: 'STANDARD', status: 'LIVE' },
    });
    const beacon = await p.school.upsert({
      where: { slug: 'beacon' },
      update: {},
      create: { slug: 'beacon', name: 'Beacon Public School', tier: 'PRO', status: 'LIVE' },
    });
    acmeId = acme.id;
    beaconId = beacon.id;

    // Ensure each school has at least one enquiry to read.
    await p.enquiry.create({ data: { schoolId: acmeId, parentName: 'A-Parent', phone: '1' } });
    await p.enquiry.create({ data: { schoolId: beaconId, parentName: 'B-Parent', phone: '2' } });
  });

  afterAll(async () => { await disconnectAll(); });

  it('tenant A cannot see tenant B enquiries', async () => {
    const rows = await withTenant(acmeId, (tx) => tx.enquiry.findMany());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.schoolId === acmeId)).toBe(true);
    expect(rows.some((r) => r.schoolId === beaconId)).toBe(false);
  });

  it('tenant A sees only its own school row', async () => {
    const schools = await withTenant(acmeId, (tx) => tx.school.findMany());
    expect(schools.map((s) => s.id)).toEqual([acmeId]);
  });

  it('a write under A cannot forge a B-owned row (RLS WITH CHECK)', async () => {
    await expect(
      withTenant(acmeId, (tx) =>
        tx.enquiry.create({ data: { schoolId: beaconId, parentName: 'X', phone: '3' } }),
      ),
    ).rejects.toThrow(/row-level security|42501/);
  });

  it('approved NETWORK events are visible cross-tenant; SCHOOL events are not', async () => {
    const p = getPlatformPrisma();
    await p.event.create({ data: { schoolId: beaconId, title: 'Net', startAt: new Date(), scope: 'NETWORK', status: 'APPROVED' } });
    await p.event.create({ data: { schoolId: beaconId, title: 'Local', startAt: new Date(), scope: 'SCHOOL', status: 'APPROVED' } });
    const visible = await withTenant(acmeId, (tx) => tx.event.findMany());
    const titles = visible.map((e) => e.title);
    expect(titles).toContain('Net');
    expect(titles).not.toContain('Local');
  });
});
