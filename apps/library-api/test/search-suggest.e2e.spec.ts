import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma, disconnectLibrary, withOrg, type LibraryTx } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { signAccessToken } from '../src/modules/auth/internal/auth.module';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

interface Org { orgId: string; slug: string; branchId: string; token: string }
const host = (o: Pick<Org, 'slug'>) => `${o.slug}.library.trackyour.in`;

async function seedOrg(suffix: string): Promise<Org> {
  const prisma = getLibraryPlatformPrisma();
  const org = await prisma.libraryOrg.create({ data: { slug: `sug-${suffix}`, name: 'Suggest E2E', status: 'LIVE' } });
  const branch = await prisma.branch.create({ data: { orgId: org.id, name: 'Main', code: 'MAIN' } });
  const passwordHash = await argon2.hash('sug-e2e-Pw1!', { type: argon2.argon2id });
  const u = await prisma.libUser.create({
    data: { orgId: org.id, email: `lib-${suffix}@sug.test`, passwordHash, role: 'LIBRARIAN', branchIds: [], active: true },
  });
  const jwt = new JwtService();
  return { orgId: org.id, slug: org.slug, branchId: branch.id,
    token: signAccessToken(jwt, { id: u.id, orgId: u.orgId, role: u.role, branchIds: u.branchIds }) };
}

describeLive('GET /search/suggest — the one box', () => {
  let app: INestApplication;
  let org: Org;
  let other: Org;

  const ask = (q: string, o: Org = org) =>
    request(app.getHttpServer())
      .get(`/search/suggest?q=${encodeURIComponent(q)}`)
      .set('X-Library-Host', host(o))
      .set('Authorization', `Bearer ${o.token}`);

  beforeAll(async () => {
    process.env.DISABLE_THROTTLER = 'true';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    configureApp(app);
    await app.init();

    const stamp = Date.now().toString(36);
    org = await seedOrg(stamp);
    other = await seedOrg(`x${stamp}`);
    const prisma = getLibraryPlatformPrisma();

    const title = await prisma.title.create({ data: { orgId: org.orgId, title: 'The Hungry Tide' } });
    const author = await prisma.author.create({ data: { orgId: org.orgId, name: 'Amitav Ghosh', sortName: 'Ghosh, Amitav' } });
    await prisma.titleAuthor.create({ data: { titleId: title.id, authorId: author.id } });
    await prisma.copy.create({ data: { orgId: org.orgId, titleId: title.id, branchId: org.branchId, accessionNumber: '4001' } });
    await prisma.copy.create({ data: { orgId: org.orgId, titleId: title.id, branchId: org.branchId, accessionNumber: '4002' } });
    await prisma.member.create({
      data: { orgId: org.orgId, homeBranchId: org.branchId, code: 'SUG-00042', firstName: 'Ravi', lastName: 'Menon', status: 'ACTIVE' },
    });

    // Same number and name in ANOTHER org — the cross-tenant probe.
    const t2 = await prisma.title.create({ data: { orgId: other.orgId, title: 'The Hungry Tide' } });
    await prisma.copy.create({ data: { orgId: other.orgId, titleId: t2.id, branchId: other.branchId, accessionNumber: '4001' } });
  }, 90_000);

  afterAll(async () => {
    delete process.env.DISABLE_THROTTLER;
    const prisma = getLibraryPlatformPrisma();
    await prisma.libraryOrg.deleteMany({ where: { id: { in: [org?.orgId, other?.orgId].filter(Boolean) as string[] } } });
    await app?.close();
    await closeOrgLookupRedis();
    await disconnectLibrary();
  });

  it('an exact book number outranks everything else', async () => {
    const res = await ask('4001').expect(200);
    expect(res.body[0]).toMatchObject({ kind: 'copy', accessionNumber: '4001', action: 'ISSUE' });
    expect(res.body[0].rank).toBe(0);
  });

  /** A partial accession number is a DIFFERENT book, never a near miss. */
  it('never prefix-matches a book number', async () => {
    const res = await ask('400').expect(200);
    expect(res.body.filter((r: { kind: string }) => r.kind === 'copy')).toHaveLength(0);
  });

  it('finds a person by name and by code', async () => {
    expect((await ask('Menon').expect(200)).body.some((r: { kind: string }) => r.kind === 'member')).toBe(true);
    const byCode = await ask('SUG-00042').expect(200);
    expect(byCode.body[0]).toMatchObject({ kind: 'member', label: 'Ravi Menon' });
  });

  it('finds a book by title and by author', async () => {
    expect((await ask('hungry').expect(200)).body.some((r: { label: string }) => r.label === 'The Hungry Tide')).toBe(true);
    expect((await ask('ghosh').expect(200)).body.some((r: { label: string }) => r.label === 'The Hungry Tide')).toBe(true);
  });

  it('reports how many copies are on the shelf', async () => {
    const hit = (await ask('hungry').expect(200)).body.find((r: { kind: string }) => r.kind === 'title');
    expect(hit).toMatchObject({ totalCopies: 2, availableCopies: 2 });
  });

  /**
   * The reason pg_trgm exists in this service. Full-text cannot do this — a
   * misspelt word simply is not the word — and a librarian half-remembering a
   * title should not be punished for it.
   *
   * This test also guards a portability trap: `similarity()` resolves through
   * the connection's search_path, so if the extension were ever installed into
   * a different schema on a cloud database than it is locally, every search
   * would 500. That difference is invisible until something calls it.
   */
  it('tolerates a typo — "hungy" still finds The Hungry Tide', async () => {
    const res = await ask('hungy').expect(200);
    expect(res.body.some((r: { label: string }) => r.label === 'The Hungry Tide')).toBe(true);
  });

  it('similarity() is callable on the app connection — the extension is reachable', async () => {
    const rows = await withOrg(org.orgId, (tx: LibraryTx) =>
      tx.$queryRaw<Array<{ s: number }>>`SELECT similarity('hungy', 'The Hungry Tide') AS s`);
    expect(Number(rows[0].s)).toBeGreaterThan(0);
  });

  it('a query matching nothing returns an empty list, not an error', async () => {
    expect((await ask('zzzzzzzz').expect(200)).body).toEqual([]);
  });

  it('treats a typed % as a literal, not a wildcard', async () => {
    expect((await ask('%').expect(200)).body).toEqual([]);
  });

  it('never crosses tenants, even on an identical book number', async () => {
    const mine = (await ask('4001').expect(200)).body[0];
    const theirs = (await ask('4001', other).expect(200)).body[0];
    expect(mine.id).not.toBe(theirs.id);
  });

  it('rejects an over-long query rather than turning it into a scan', async () => {
    await ask('x'.repeat(200)).expect(400);
  });
});
