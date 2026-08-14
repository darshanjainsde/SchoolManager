import { randomUUID } from 'node:crypto';
import { getLibraryPlatformPrisma } from '@library/db';
import { ProvisioningService } from '../src/modules/provisioning';
import { loadPolicy } from '../src/modules/circulation/internal/policy-loader';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

/**
 * Provisioning is what turns "the library is built" into "this school can use
 * it". Before it existed the only way to create a `LibraryOrg` was to run
 * `seed.ts` by hand.
 *
 * The assertion that carries the most weight is the LAST one: after
 * provisioning, `loadPolicy` resolves. That is the function that throws
 * NotFoundException at the counter when a `CirculationPolicy` is missing, so
 * proving it resolves is proving a librarian can actually issue a book — which
 * is the only definition of "provisioned" that matters.
 */
describeLive('provisioning a school library', () => {
  const service = new ProvisioningService();
  const prisma = getLibraryPlatformPrisma();
  const created: string[] = [];

  const input = () => ({
    schoolId: randomUUID(),
    slug: `prov-${Math.random().toString(36).slice(2, 10)}`,
    name: 'Provisioning Test School',
  });

  afterAll(async () => {
    // Cascades take branches, policies and settings with the org.
    if (created.length) await prisma.libraryOrg.deleteMany({ where: { id: { in: created } } });
  });

  async function provision(i: ReturnType<typeof input>) {
    const report = await service.provision(i);
    if (!created.includes(report.orgId)) created.push(report.orgId);
    return report;
  }

  it('creates every row a working library needs, from nothing', async () => {
    const report = await provision(input());

    expect(report.created.sort()).toEqual(
      ['branch', 'org', 'policy:EXTERNAL', 'policy:STUDENT', 'policy:TEACHER', 'settings'].sort(),
    );
    expect(report.alreadyPresent).toEqual([]);

    const orgId = report.orgId;
    await expect(prisma.branch.count({ where: { orgId } })).resolves.toBe(1);
    await expect(
      prisma.circulationPolicy.count({ where: { orgId, branchId: null } }),
    ).resolves.toBe(3);
    await expect(
      prisma.librarySettings.findUnique({ where: { orgId }, select: { id: true } }),
    ).resolves.not.toBeNull();
  });

  it('is idempotent — running it again creates nothing and is not an error', async () => {
    // This is also the "repair library" action, so it has to be safe to press
    // twice. A second run that duplicated the branch would split the collection.
    const i = input();
    await provision(i);
    const second = await provision(i);

    expect(second.created).toEqual([]);
    expect(second.alreadyPresent.sort()).toEqual(
      ['branch', 'org', 'policy:EXTERNAL', 'policy:STUDENT', 'policy:TEACHER', 'settings'].sort(),
    );
    await expect(prisma.branch.count({ where: { orgId: second.orgId } })).resolves.toBe(1);
  });

  it('REPAIRS a half-provisioned library rather than leaving it broken', async () => {
    // The nastiest state available: the org exists, so the catalogue and the
    // desk both load and everything looks configured — and then the first child
    // at the counter gets a 404 because `loadPolicy` found no policy.
    const i = input();
    const first = await provision(i);
    await prisma.circulationPolicy.deleteMany({
      where: { orgId: first.orgId, memberType: 'STUDENT' },
    });

    const repair = await provision(i);

    expect(repair.created).toEqual(['policy:STUDENT']);
    expect(repair.alreadyPresent).toContain('org');
    expect(repair.alreadyPresent).toContain('branch');
  });

  it('does not disturb settings a librarian has already changed', async () => {
    // Repair must complete what is missing, never reset what someone chose.
    // Overwriting `chargeStudentFines` would silently start billing children.
    const i = input();
    const { orgId } = await provision(i);
    await prisma.librarySettings.update({
      where: { orgId },
      data: { chargeStudentFines: true, concurrentClassCapacity: 5 },
    });

    await provision(i);

    const settings = await prisma.librarySettings.findUnique({ where: { orgId } });
    expect(settings?.chargeStudentFines).toBe(true);
    expect(settings?.concurrentClassCapacity).toBe(5);
  });

  it('leaves fines OFF by default, with the engine configured behind them', async () => {
    // Most schools charge children nothing. The engine must be ready the day a
    // school turns it on without billing anybody before that.
    const { orgId } = await provision(input());

    const settings = await prisma.librarySettings.findUnique({ where: { orgId } });
    expect(settings?.chargeStudentFines).toBe(false);

    const student = await prisma.circulationPolicy.findFirst({
      where: { orgId, branchId: null, memberType: 'STUDENT' },
    });
    expect(Number(student?.finePerDay)).toBeGreaterThan(0);
  });

  describe('readiness', () => {
    it('reports an unprovisioned school as not provisioned, listing everything missing', async () => {
      const report = await service.ready(randomUUID());

      expect(report.provisioned).toBe(false);
      expect(report.live).toBe(false);
      expect(report.orgId).toBeNull();
      expect(report.missing).toContain('org');
    });

    it('is provisioned but NOT live until there are books on the shelf', async () => {
      // The gap between "admin enabled Library" and "there are books in it" is
      // weeks of real work. A menu item opening onto an empty screen during
      // those weeks is the impression every student forms of the feature.
      const i = input();
      await provision(i);

      const report = await service.ready(i.schoolId);
      expect(report.provisioned).toBe(true);
      expect(report.missing).toEqual([]);
      expect(report.copies).toBe(0);
      expect(report.live).toBe(false);
    });

    it('names exactly what is missing when a library is half-built', async () => {
      const i = input();
      const { orgId } = await provision(i);
      await prisma.circulationPolicy.deleteMany({ where: { orgId, memberType: 'TEACHER' } });
      await prisma.librarySettings.deleteMany({ where: { orgId } });

      const report = await service.ready(i.schoolId);

      expect(report.provisioned).toBe(false);
      expect(report.missing.sort()).toEqual(['policy:TEACHER', 'settings']);
    });
  });

  it('leaves the library able to ISSUE — loadPolicy resolves for every member type', async () => {
    // The assertion the whole service exists for. `loadPolicy` is what throws
    // NotFoundException at the counter, so this is the difference between
    // "rows were written" and "a librarian can hand a child a book".
    const { orgId } = await provision(input());

    await prisma.$transaction(async (tx) => {
      for (const memberType of ['STUDENT', 'TEACHER', 'EXTERNAL'] as const) {
        const policy = await loadPolicy(tx, orgId, memberType, null);
        expect(policy.maxBooks).toBeGreaterThan(0);
        expect(policy.issueDays).toBeGreaterThan(0);
      }
    });
  });
});
