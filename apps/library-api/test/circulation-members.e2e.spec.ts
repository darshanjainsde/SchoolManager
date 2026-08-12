import request from 'supertest';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { getLibraryPlatformPrisma, disconnectLibrary } from '@library/db';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { closeOrgLookupRedis } from '../src/modules/tenancy';
import { signAccessToken } from '../src/modules/auth/internal/auth.module';
import { LIVE } from './helpers/live-db';

const describeLive = LIVE ? describe : describe.skip;

interface MembersOrg {
  orgId: string;
  slug: string;
  mainBranchId: string;
  annexeBranchId: string;
  librarianToken: string;
  /** Scoped to the annexe only — proves branch scope on this route. */
  annexeLibrarianToken: string;
  memberToken: string;
}

/** Stands in for a Sckools `Student.id` the school app already holds. */
const SCKOOLS_STUDENT_ID = '9f1d2c3b-4a5e-4f60-8712-abcdef012345';

const host = (org: Pick<MembersOrg, 'slug'>) => `${org.slug}.library.trackyour.in`;

async function seedOrg(suffix: string): Promise<MembersOrg> {
  const prisma = getLibraryPlatformPrisma();
  const org = await prisma.libraryOrg.create({
    data: { slug: `members-${suffix}`, name: 'Members E2E', status: 'LIVE' },
  });
  const main = await prisma.branch.create({ data: { orgId: org.id, name: 'Main', code: 'MAIN' } });
  const annexe = await prisma.branch.create({ data: { orgId: org.id, name: 'Annexe', code: 'ANNX' } });

  const passwordHash = await argon2.hash('members-e2e-Pw1!', { type: argon2.argon2id });
  const jwt = new JwtService();

  const mk = async (role: 'LIBRARIAN' | 'MEMBER', branchIds: string[], tag: string) => {
    const u = await prisma.libUser.create({
      data: { orgId: org.id, email: `${tag}-${suffix}@members.test`, passwordHash, role, branchIds, active: true },
    });
    return signAccessToken(jwt, { id: u.id, orgId: u.orgId, role: u.role, branchIds: u.branchIds });
  };

  return {
    orgId: org.id,
    slug: org.slug,
    mainBranchId: main.id,
    annexeBranchId: annexe.id,
    librarianToken: await mk('LIBRARIAN', [], 'librarian'),
    annexeLibrarianToken: await mk('LIBRARIAN', [annexe.id], 'annexe'),
    memberToken: await mk('MEMBER', [], 'member'),
  };
}

function seedMember(
  orgId: string,
  homeBranchId: string | null,
  code: string,
  firstName: string,
  lastName: string,
  status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE',
) {
  return getLibraryPlatformPrisma().member.create({
    data: { orgId, homeBranchId, code, firstName, lastName, status, memberType: 'STUDENT' },
  });
}

describeLive('GET /circulation/members', () => {
  let app: INestApplication;
  let org: MembersOrg;
  let other: MembersOrg;

  const search = (q: string, token = org.librarianToken, o: MembersOrg = org) =>
    request(app.getHttpServer())
      .get(`/circulation/members${q}`)
      .set('X-Library-Host', host(o))
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    const stamp = Date.now();
    org = await seedOrg(`a${stamp}`);
    other = await seedOrg(`b${stamp}`);

    await seedMember(org.orgId, org.mainBranchId, 'RAF-00042', 'Ravi', 'Menon');
    await seedMember(org.orgId, org.mainBranchId, 'RAF-00043', 'Anita', 'Rafferty');
    await seedMember(org.orgId, org.mainBranchId, 'RAF-00044', 'Suspended', 'Menon', 'SUSPENDED');
    await seedMember(org.orgId, org.annexeBranchId, 'RAF-00050', 'Annexe', 'Only');
    await seedMember(org.orgId, null, 'RAF-00060', 'Roaming', 'Nobranch');

    // Carries a Sckools Student.id — the cross-service link (design §13).
    await getLibraryPlatformPrisma().member.update({
      where: { id: (await seedMember(org.orgId, org.mainBranchId, 'RAF-00070', 'Linked', 'ToSckools')).id },
      data: { externalRef: SCKOOLS_STUDENT_ID },
    });

    // Same code and name in a DIFFERENT org — the cross-tenant probe.
    await seedMember(other.orgId, other.mainBranchId, 'RAF-00042', 'Ravi', 'Menon');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await closeOrgLookupRedis();
    await disconnectLibrary();
  });

  it('finds a member by their canonical code', async () => {
    const res = await search('?q=RAF-00042').expect(200);
    expect(res.body[0]).toMatchObject({ code: 'RAF-00042', firstName: 'Ravi', lastName: 'Menon' });
  });

  it.each([['lowercase', 'raf-00042'], ['no hyphen', 'RAF00042'], ['unpadded', 'RAF-42']])(
    'finds the same member from a %s code',
    async (_label, typed) => {
      const res = await search(`?q=${encodeURIComponent(typed)}`).expect(200);
      expect(res.body[0].code).toBe('RAF-00042');
    },
  );

  it('finds a member by name', async () => {
    const res = await search('?q=Ravi').expect(200);
    expect(res.body.map((m: { code: string }) => m.code)).toContain('RAF-00042');
  });

  it('finds a member by full name', async () => {
    const res = await search(`?q=${encodeURIComponent('Ravi Menon')}`).expect(200);
    expect(res.body[0].code).toBe('RAF-00042');
  });

  /**
   * The ranking is the reason this endpoint is raw SQL rather than a findMany.
   * "RAF-00042" is both an exact code AND a substring of nothing else, but
   * "Rafferty" contains "Raf" — so a code-shaped query must not be outranked
   * by a surname that merely starts the same way.
   */
  it('ranks an exact code above a name that happens to start with the same letters', async () => {
    const res = await search('?q=RAF-00042').expect(200);
    expect(res.body[0].code).toBe('RAF-00042');
    const rafferty = res.body.findIndex((m: { lastName: string }) => m.lastName === 'Rafferty');
    if (rafferty !== -1) expect(rafferty).toBeGreaterThan(0);
  });

  it('ranks ACTIVE members above suspended ones within the same rank', async () => {
    const res = await search('?q=Menon').expect(200);
    const codes = res.body.map((m: { code: string }) => m.code);
    expect(codes.indexOf('RAF-00042')).toBeLessThan(codes.indexOf('RAF-00044'));
  });

  it('matches bare digits against the end of a code', async () => {
    const res = await search('?q=00043').expect(200);
    expect(res.body.map((m: { code: string }) => m.code)).toContain('RAF-00043');
  });

  it('lists the roll alphabetically for an empty query, rather than returning nothing', async () => {
    const res = await search('?q=').expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    const surnames = res.body.map((m: { lastName: string }) => m.lastName);
    expect([...surnames].sort()).toEqual(surnames);
  });

  it('honours the limit', async () => {
    const res = await search('?q=&limit=2').expect(200);
    expect(res.body).toHaveLength(2);
  });

  it('rejects a limit above the typeahead cap', async () => {
    await search('?q=&limit=500').expect(400);
  });

  /**
   * Prove-by-deletion: if the projection were widened, this test is what fails.
   * These are children's contact details — see MEMBER_CARD_SELECT's doc.
   */
  it('never returns a member’s phone, email, address or photo', async () => {
    const res = await search('?q=RAF-00042').expect(200);
    expect(Object.keys(res.body[0]).sort()).toEqual(
      ['code', 'firstName', 'homeBranchId', 'id', 'lastName', 'memberType', 'status'],
    );
  });

  it('treats a typed % as a literal, not an ILIKE wildcard', async () => {
    const res = await search('?q=%25').expect(200);
    expect(res.body).toEqual([]);
  });

  it('never returns a member from another org, even on an identical code', async () => {
    const res = await search('?q=RAF-00042').expect(200);
    const ids = res.body.map((m: { id: string }) => m.id);
    const foreign = await getLibraryPlatformPrisma().member.findFirst({
      where: { orgId: other.orgId, code: 'RAF-00042' },
      select: { id: true },
    });
    expect(foreign).not.toBeNull();
    expect(ids).not.toContain(foreign!.id);
  });

  describe('branch scope', () => {
    it('a branch-scoped librarian sees their own branch’s members', async () => {
      const res = await search('?q=Annexe', org.annexeLibrarianToken).expect(200);
      expect(res.body.map((m: { code: string }) => m.code)).toContain('RAF-00050');
    });

    it('a branch-scoped librarian does NOT see another branch’s members', async () => {
      const res = await search('?q=Ravi', org.annexeLibrarianToken).expect(200);
      expect(res.body.map((m: { code: string }) => m.code)).not.toContain('RAF-00042');
    });

    it('a member with no home branch is visible to every branch — the module’s "unknown passes through" convention', async () => {
      const res = await search('?q=Roaming', org.annexeLibrarianToken).expect(200);
      expect(res.body.map((m: { code: string }) => m.code)).toContain('RAF-00060');
    });
  });

  /**
   * How Sckools answers "what has this student borrowed?" — it calls here with
   * the Student.id it already holds, rather than reading the library's tables.
   * That is what lets the two services live in separate databases (design §13).
   */
  describe('externalRef — the Sckools link', () => {
    it('finds the member a Sckools student id maps to', async () => {
      const res = await search(`?externalRef=${SCKOOLS_STUDENT_ID}`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].code).toBe('RAF-00070');
    });

    it('returns nothing for a student who has no library member — not an error', async () => {
      const res = await search('?externalRef=11111111-2222-4333-8444-555555555555').expect(200);
      expect(res.body).toEqual([]);
    });

    it('rejects a non-uuid externalRef rather than treating it as a search term', async () => {
      await search('?externalRef=not-a-uuid').expect(400);
    });

    it('never crosses tenants: another org cannot resolve this org’s student id', async () => {
      const res = await search(`?externalRef=${SCKOOLS_STUDENT_ID}`, other.librarianToken, other).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  it('denies a MEMBER — a borrower must not be able to enumerate the roll', async () => {
    await search('?q=Ravi', org.memberToken).expect(403);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/circulation/members?q=Ravi')
      .set('X-Library-Host', host(org))
      .expect(401);
  });
});
