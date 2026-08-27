import { getPlatformPrisma, disconnectAll, withTenant } from '@skoolos/db';
import { createHash } from 'node:crypto';
import { AlumniAuthService } from '../src/modules/alumni/internal/alumni-auth.service';
import { AlumniPortalService } from '../src/modules/alumni/internal/alumni-portal.service';

/**
 * The alumnus's door.
 *
 * This is the only new authentication surface in Homecoming, so it gets the
 * hardest tests in the module. The property under test throughout is not "a
 * good link works" — it is that every OTHER path is closed:
 *
 *   a used link, an expired link, a forged link, a link from another school,
 *   a session whose owner has since been un-verified, and a claim redeemed
 *   twice concurrently.
 */
describe('The alumnus door', () => {
  const auth = new AlumniAuthService();
  const portal = new AlumniPortalService();
  let schoolId: string;
  let otherSchoolId: string;
  let alumniId: string;
  let otherAlumniId: string;

  beforeAll(async () => {
    const p = getPlatformPrisma();
    const a = await p.school.upsert({
      where: { slug: 'door-a' },
      update: {},
      create: { slug: 'door-a', name: 'Door A', tier: 'PRO', status: 'LIVE' },
    });
    const b = await p.school.upsert({
      where: { slug: 'door-b' },
      update: {},
      create: { slug: 'door-b', name: 'Door B', tier: 'PRO', status: 'LIVE' },
    });
    schoolId = a.id;
    otherSchoolId = b.id;
    const al = await p.alumni.create({
      data: { schoolId, firstName: 'Vikram', lastName: 'Chauhan', batchYear: 2004, status: 'VERIFIED' },
    });
    alumniId = al.id;
    const ob = await p.alumni.create({
      data: { schoolId: otherSchoolId, firstName: 'Other', lastName: 'Person', batchYear: 2004, status: 'VERIFIED' },
    });
    otherAlumniId = ob.id;
  });

  afterAll(async () => {
    await disconnectAll();
  });

  describe('minting', () => {
    it('returns the raw token exactly once and stores only its hash', async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      expect(token.length).toBeGreaterThanOrEqual(40);

      const rows = await withTenant(schoolId, (tx) =>
        tx.alumniAccessToken.findMany({ where: { alumniId, kind: 'CLAIM' } }),
      );
      const stored = rows.map((r) => r.tokenHash);
      // A database dump must not hand anybody a working key.
      expect(stored).not.toContain(token);
      expect(stored).toContain(createHash('sha256').update(token).digest('hex'));
    });

    it('supersedes any earlier live link for the same person', async () => {
      const first = await auth.mintClaimToken(schoolId, alumniId);
      const second = await auth.mintClaimToken(schoolId, alumniId);
      // Two working links for one alumnus means the older keeps working after
      // the newer is used — exactly the surprise nobody debugs at the time.
      await expect(auth.redeemClaim(schoolId, first.token)).rejects.toThrow(/not valid/i);
      await expect(auth.redeemClaim(schoolId, second.token)).resolves.toBeTruthy();
    });

    it('refuses to mint for a hidden or declined record', async () => {
      const p = getPlatformPrisma();
      const hidden = await p.alumni.create({
        data: { schoolId, firstName: 'Gone', lastName: 'Away', batchYear: 1999, status: 'HIDDEN' },
      });
      await expect(auth.mintClaimToken(schoolId, hidden.id)).rejects.toThrow(/hidden/i);
    });

    it('refuses to mint across schools', async () => {
      await expect(auth.mintClaimToken(schoolId, otherAlumniId)).rejects.toThrow(/No such alumni/i);
    });
  });

  describe('redeeming', () => {
    it('swaps a claim link for a session', async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      const r = await auth.redeemClaim(schoolId, token);
      expect(r.session).toBeTruthy();
      expect(r.alumni.alumniId).toBe(alumniId);
      expect(r.expiresAt.getTime()).toBeGreaterThan(Date.now() + 80 * 24 * 3600 * 1000);
    });

    it('is SINGLE USE', async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      await auth.redeemClaim(schoolId, token);
      await expect(auth.redeemClaim(schoolId, token)).rejects.toThrow(/not valid/i);
    });

    it('refuses a link that has expired', async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      const hash = createHash('sha256').update(token).digest('hex');
      await withTenant(schoolId, (tx) =>
        tx.alumniAccessToken.updateMany({
          where: { tokenHash: hash },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );
      await expect(auth.redeemClaim(schoolId, token)).rejects.toThrow(/not valid/i);
    });

    it('refuses a forged token', async () => {
      await expect(auth.redeemClaim(schoolId, 'a'.repeat(43))).rejects.toThrow(/not valid/i);
    });

    it('refuses another school’s token even when it is otherwise valid', async () => {
      const { token } = await auth.mintClaimToken(otherSchoolId, otherAlumniId);
      // Presented at the wrong school. The token is real; the tenant is not.
      await expect(auth.redeemClaim(schoolId, token)).rejects.toThrow(/not valid/i);
      // And it still works at its own school afterwards — the failed attempt
      // must not have burned it.
      await expect(auth.redeemClaim(otherSchoolId, token)).resolves.toBeTruthy();
    });

    it('gives the SAME message for used, expired and never-existed', async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      await auth.redeemClaim(schoolId, token);
      const used = await auth.redeemClaim(schoolId, token).catch((e: Error) => e.message);
      const forged = await auth.redeemClaim(schoolId, 'b'.repeat(43)).catch((e: Error) => e.message);
      // Distinguishing them tells somebody probing links which of the three
      // they hit, which is an oracle.
      expect(used).toBe(forged);
    });

    /**
     * HONEST LIMITATION, recorded rather than papered over.
     *
     * This assertion holds, and it also holds with the single-use conditional
     * REMOVED from redeemClaim — verified by deleting it and watching all 29
     * tests still pass, at two and at eight concurrent callers. Prisma's
     * interactive transactions serialize on the local pool, so the interleaving
     * that would expose a read-then-write never occurs on this machine.
     *
     * So: this test documents the requirement, it does NOT prove it. The proof
     * that the code is right is the mechanism test below plus reading
     * redeemClaim; the proof it is WRONG would need a barrier the Prisma client
     * does not expose. Claiming a sabotage-proof here would be the false green
     * this project already has a ledger entry for.
     */
    it('cannot be redeemed twice concurrently (documents, does not prove — see comment)', async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, () => auth.redeemClaim(schoolId, token)),
      );
      const ok = results.filter((r) => r.status === 'fulfilled');
      expect(ok).toHaveLength(1);
    });

    it('the single-use guarantee is a CONDITIONAL update, and the condition bites', async () => {
      // Asserts the database primitive redeemClaim depends on: a conditional
      // write on `usedAt: null` matches exactly once, so the second caller gets
      // count 0 and is refused. A read-then-write would let both through under
      // READ COMMITTED, because both would have read null before either
      // committed — the same shape as the double-booked period, and the fourth
      // time this project has met it.
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      const hash = createHash('sha256').update(token).digest('hex');
      const row = await withTenant(schoolId, (tx) =>
        tx.alumniAccessToken.findFirst({ where: { tokenHash: hash } }),
      );
      const first = await withTenant(schoolId, (tx) =>
        tx.alumniAccessToken.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: new Date() } }),
      );
      const second = await withTenant(schoolId, (tx) =>
        tx.alumniAccessToken.updateMany({ where: { id: row!.id, usedAt: null }, data: { usedAt: new Date() } }),
      );
      expect(first.count).toBe(1);
      expect(second.count).toBe(0);
    });

    it('does NOT promote a pending alumnus', async () => {
      const p = getPlatformPrisma();
      const pending = await p.alumni.create({
        data: { schoolId, firstName: 'Not', lastName: 'Verified', batchYear: 1998, status: 'PENDING' },
      });
      const { token } = await auth.mintClaimToken(schoolId, pending.id);
      const r = await auth.redeemClaim(schoolId, token);
      expect(r.alumni.status).toBe('PENDING');
      // Holding a link proves possession of a link. Only the office decides
      // who is real, so the session it minted resolves to nothing.
      expect(await auth.resolveSession(schoolId, r.session)).toBeNull();
    });
  });

  describe('sessions', () => {
    let session: string;

    beforeEach(async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      session = (await auth.redeemClaim(schoolId, token)).session;
    });

    it('resolves to the alumnus', async () => {
      const who = await auth.resolveSession(schoolId, session);
      expect(who?.alumniId).toBe(alumniId);
    });

    it('does not resolve at another school', async () => {
      expect(await auth.resolveSession(otherSchoolId, session)).toBeNull();
    });

    it('stops resolving the moment the office un-verifies them', async () => {
      const p = getPlatformPrisma();
      await p.alumni.update({ where: { id: alumniId }, data: { status: 'PENDING' } });
      try {
        // Status is re-read on EVERY request rather than trusted from when the
        // token was minted. A revocation that takes ninety days is not one.
        expect(await auth.resolveSession(schoolId, session)).toBeNull();
      } finally {
        await p.alumni.update({ where: { id: alumniId }, data: { status: 'VERIFIED' } });
      }
    });

    it('stops resolving when they are marked deceased', async () => {
      const p = getPlatformPrisma();
      await p.alumni.update({ where: { id: alumniId }, data: { isDeceased: true } });
      try {
        expect(await auth.resolveSession(schoolId, session)).toBeNull();
      } finally {
        await p.alumni.update({ where: { id: alumniId }, data: { isDeceased: false } });
      }
    });

    it('is revoked by signing out, and other devices survive', async () => {
      const { token: t2 } = await auth.mintClaimToken(schoolId, alumniId);
      const otherDevice = (await auth.redeemClaim(schoolId, t2)).session;
      await auth.revokeSession(schoolId, session);
      expect(await auth.resolveSession(schoolId, session)).toBeNull();
      expect(await auth.resolveSession(schoolId, otherDevice)).not.toBeNull();
    });

    it('revokeAllSessions closes every device at once', async () => {
      const { token: t3 } = await auth.mintClaimToken(schoolId, alumniId);
      const another = (await auth.redeemClaim(schoolId, t3)).session;
      const n = await auth.revokeAllSessions(schoolId, alumniId);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(await auth.resolveSession(schoolId, another)).toBeNull();
    });

    it('refuses a claim token presented as a session token', async () => {
      const { token } = await auth.mintClaimToken(schoolId, alumniId);
      // Different `kind`, so the lookup misses. Without the kind filter a claim
      // link would double as a ninety-day session.
      expect(await auth.resolveSession(schoolId, token)).toBeNull();
    });

    it('refuses absurd token shapes without touching the database', async () => {
      expect(await auth.resolveSession(schoolId, '')).toBeNull();
      expect(await auth.resolveSession(schoolId, 'short')).toBeNull();
      expect(await auth.resolveSession(schoolId, 'x'.repeat(9999))).toBeNull();
    });
  });

  describe('what the audiences actually see', () => {
    let openId: string;
    let closedId: string;

    beforeAll(async () => {
      const p = getPlatformPrisma();
      const open = await p.alumni.create({
        data: {
          schoolId, firstName: 'Open', lastName: 'Book', batchYear: 2011, status: 'VERIFIED',
          city: 'Pune', profession: 'Engineer', phone: '+919000000001', email: 'open@x.test',
          privacy: { name: 'PUBLIC', city: 'PUBLIC', work: 'ALUMNI', phone: 'ALUMNI' },
        },
      });
      openId = open.id;
      const closed = await p.alumni.create({
        data: {
          schoolId, firstName: 'Closed', lastName: 'Door', batchYear: 2011, status: 'VERIFIED',
          city: 'Jaipur', profession: 'Doctor', phone: '+919000000002',
          // No privacy blob at all — every field must read as HIDDEN.
        },
      });
      closedId = closed.id;
      await p.alumni.create({
        data: { schoolId, firstName: 'Still', lastName: 'Pending', batchYear: 2011, status: 'PENDING' },
      });
    });

    it('never shows a PENDING alumnus to anybody', async () => {
      const pub = await portal.publicBatch(schoolId, 2011);
      expect(pub.alumni.map((a) => a.name)).not.toContain('Still Pending');
      const dir = await portal.directory(schoolId, 2004, { batchYear: 2011 });
      expect(dir.rows.map((r) => r.name)).not.toContain('Still Pending');
    });

    it('never publishes a phone number to the public page', async () => {
      const pub = await portal.publicBatch(schoolId, 2011);
      for (const a of pub.alumni) {
        expect(a.phone).toBeNull();
        expect(a.email).toBeNull();
      }
    });

    it('hides every field of an alumnus who set no privacy at all', async () => {
      const pub = await portal.publicBatch(schoolId, 2011);
      const closed = pub.alumni.find((a) => a.id === closedId)!;
      // An absent key reads as HIDDEN, never as visible — so a field added in a
      // later release is closed for everyone who has not seen it yet.
      expect(closed.name).toBe('A former student');
      expect(closed.city).toBeNull();
      expect(closed.profession).toBeNull();
    });

    it('publishes only what its owner opened to the public', async () => {
      const pub = await portal.publicBatch(schoolId, 2011);
      const open = pub.alumni.find((a) => a.id === openId)!;
      expect(open.name).toBe('Open Book');
      expect(open.city).toBe('Pune');
      // work was opened to ALUMNI, not PUBLIC.
      expect(open.profession).toBeNull();
    });

    it('shows a fellow alumnus what was opened to alumni', async () => {
      const dir = await portal.directory(schoolId, 2004, { batchYear: 2011 });
      const open = dir.rows.find((r) => r.id === openId)!;
      expect(open.profession).toBe('Engineer');
      expect(open.phone).toBe('+919000000001');
    });

    it('gives a batch-mate the batch reach and a stranger only the alumni reach', async () => {
      const p = getPlatformPrisma();
      const batchOnly = await p.alumni.create({
        data: {
          schoolId, firstName: 'Batch', lastName: 'Only', batchYear: 2011, status: 'VERIFIED',
          city: 'Kota', privacy: { name: 'ALUMNI', city: 'BATCH' },
        },
      });
      const asBatchMate = await portal.directory(schoolId, 2011, { batchYear: 2011 });
      const asStranger = await portal.directory(schoolId, 1999, { batchYear: 2011 });
      expect(asBatchMate.rows.find((r) => r.id === batchOnly.id)!.city).toBe('Kota');
      expect(asStranger.rows.find((r) => r.id === batchOnly.id)!.city).toBeNull();
    });

    it('reports coverage as null when no register strength was recorded', async () => {
      const pub = await portal.publicBatch(schoolId, 2011);
      expect(pub.registerStrength).toBe(0);
      expect(pub.coverage).toBeNull();
    });

    it('never returns a school record, a date of birth or an address to any audience', async () => {
      const pub = await portal.publicBatch(schoolId, 2011);
      const dir = await portal.directory(schoolId, 2011, {});
      for (const row of [...pub.alumni, ...dir.rows]) {
        const keys = Object.keys(row);
        // The projection chooses its columns rather than fetching a row and
        // pruning it — LIBRARY-TRAPS #17 is the strip that failed one join away.
        expect(keys).not.toContain('dob');
        expect(keys).not.toContain('admissionNo');
        expect(keys).not.toContain('privacy');
        expect(keys).not.toContain('studentId');
      }
    });
  });
});
