import { createHash, randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { disconnectLibrary, getLibraryPlatformPrisma } from '@library/db';
import { PrismaRefreshStore } from '../src/modules/auth/internal/auth.module';
import { REFRESH_GRACE_REPLAY_CAP, RefreshService, type RefreshStore } from '../src/modules/auth/internal/refresh.service';
import { LIVE } from './helpers/live-db';

const sha256 = (raw: string): string => createHash('sha256').update(raw).digest('hex');

const describeLive = LIVE ? describe : describe.skip;

/**
 * The double-mint race that `RefreshService.rotate` cannot see on its own —
 * two concurrent calls both reading `revokedAt: null` before either write
 * lands — is closed entirely inside `PrismaRefreshStore.markUsed`'s
 * conditional UPDATE. `refresh.service.spec.ts` mocks `markUsed` as
 * `async () => {}`, so it can never exercise that guarantee; it's a
 * property of how Postgres re-evaluates an UPDATE's WHERE clause under
 * concurrent writers, which only real Postgres can prove.
 */
describeLive('PrismaRefreshStore.markUsed is atomic against duplicate consumption', () => {
  let orgId: string;
  let userId: string;

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = Date.now().toString(36);
    const org = await prisma.libraryOrg.create({
      data: { slug: `refresh-store-e2e-${suffix}`, name: 'Refresh Store E2E', status: 'LIVE' },
    });
    orgId = org.id;
    const user = await prisma.libUser.create({
      data: {
        orgId,
        email: `refresh-store-e2e-${suffix}@test.local`,
        passwordHash: await argon2.hash('irrelevant', { type: argon2.argon2id }),
        role: 'LIBRARIAN',
        branchIds: [],
        active: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: orgId } });
    await disconnectLibrary();
  });

  it('the first markUsed consumes the row; a second markUsed on the same id is rejected, not silently repeated', async () => {
    const store = new PrismaRefreshStore();
    const row = await getLibraryPlatformPrisma().refreshToken.create({
      data: {
        userId,
        tokenHash: `dup-consume-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        familyId: '55555555-5555-4555-8555-555555555555',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const supersededAt = new Date();

    // First consumption: the row is currently revokedAt: null, so this succeeds.
    await expect(store.markUsed(row.id, supersededAt)).resolves.toBeUndefined();

    // Second consumption of the SAME id: the row is no longer revokedAt: null
    // (the first call already set it), so a correct, atomic implementation
    // must reject this rather than mark it "used" a second time — that second
    // "success" is exactly what would let a race double-mint a child token.
    await expect(store.markUsed(row.id, new Date())).rejects.toBeInstanceOf(UnauthorizedException);

    const after = await getLibraryPlatformPrisma().refreshToken.findUnique({ where: { id: row.id } });
    expect(after?.revokedAt).not.toBeNull();
    // The loser's write must not have clobbered the winner's timestamp —
    // the WHERE clause guards the whole SET, not just `revokedAt`.
    expect(after?.supersededAt?.getTime()).toBe(supersededAt.getTime());
  });
});

/**
 * `RefreshService.rotate` end-to-end, through a real `PrismaRefreshStore`
 * against real Postgres, for the false-positive-logout race this task
 * exists to fix: a client double-tap, a duplicate tab, or a mobile
 * retry-on-timeout fires TWO concurrent `rotate()` calls on the SAME
 * still-valid token. Phase 0a's `markUsed` already stops the loser from
 * double-minting a child on the SAME markUsed write (proven above); the
 * property this suite proves is the NEXT layer — that the loser doesn't get
 * treated as a thief and doesn't revoke the family out from under the
 * winner, and instead gets its own fresh, independently valid child (see
 * Finding-1 fix: nothing is stored/reused across replayers, so each grace
 * hit mints its own).
 *
 * Verified by deliberately breaking the fix: see the third test, which
 * forces `graceMs: 0` on the SAME race and shows the loser gets rejected and
 * the family gets revoked — i.e. this suite doesn't just test that things
 * pass, it proves the grace window is *why* they pass.
 */
describeLive('RefreshService.rotate — grace window under real concurrency', () => {
  let userId: string;
  let orgId: string;
  let orgIds: string[];

  beforeAll(async () => {
    const prisma = getLibraryPlatformPrisma();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const org = await prisma.libraryOrg.create({
      data: { slug: `refresh-race-e2e-${suffix}`, name: 'Refresh Race E2E', status: 'LIVE' },
    });
    orgId = org.id;
    orgIds = [org.id];
    const user = await prisma.libUser.create({
      data: {
        orgId: org.id,
        email: `refresh-race-e2e-${suffix}@test.local`,
        passwordHash: await argon2.hash('irrelevant', { type: argon2.argon2id }),
        role: 'LIBRARIAN',
        branchIds: [],
        active: true,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await getLibraryPlatformPrisma().libraryOrg.deleteMany({ where: { id: { in: orgIds } } });
    await disconnectLibrary();
  });

  /**
   * Wraps a real `PrismaRefreshStore` so BOTH callers' `findByHash` reads
   * are held at a barrier until both have arrived, then released together.
   * Without this, two `rotate()` calls fired via `Promise.allSettled` could
   * — depending on scheduling — have the second call's read land after the
   * first has already committed its write, which would "pass" even a
   * broken implementation (the second call would just see a normal,
   * long-ago-superseded-looking row) and prove nothing about the race this
   * task fixes. The barrier forces genuine overlap deterministically:
   * both calls read `revokedAt: null` before either has had a chance to
   * write, exactly like a real double-tap.
   */
  function barrieredStore(parties: number): () => RefreshStore {
    let arrived = 0;
    let release!: () => void;
    const everyoneArrived = new Promise<void>((resolve) => { release = resolve; });
    return () => {
      const inner = new PrismaRefreshStore();
      return {
        findByHash: async (hash) => {
          const row = await inner.findByHash(hash);
          arrived += 1;
          if (arrived >= parties) release();
          await everyoneArrived;
          return row;
        },
        create: (row) => inner.create(row),
        revokeFamily: (familyId) => inner.revokeFamily(familyId),
        markUsed: (id, supersededAt) => inner.markUsed(id, supersededAt),
        loadUser: (uid) => inner.loadUser(uid),
        recordGraceReplay: (event) => inner.recordGraceReplay(event),
        incrementGraceReplay: (id, cap) => inner.incrementGraceReplay(id, cap),
      };
    };
  }

  /**
   * Same barrier idea as `barrieredStore`, but forces overlap on
   * `incrementGraceReplay` instead of `findByHash` — every party reads the
   * SAME already-revoked-and-superseded row (seeded directly, not raced
   * into existence), so the property under test is purely "can concurrent
   * increments exceed the cap," isolated from the markUsed race already
   * proven above. `broken: true` swaps in a deliberately non-atomic
   * read-then-write increment to prove the barrier and assertions actually
   * discriminate — see the "deliberately broken" cap test below.
   */
  function capRaceStore(parties: number, options: { broken?: boolean } = {}): () => RefreshStore {
    let arrived = 0;
    let release!: () => void;
    const everyoneArrived = new Promise<void>((resolve) => { release = resolve; });
    return () => {
      const inner = new PrismaRefreshStore();
      const incrementGraceReplay = options.broken
        ? async (id: string, cap: number): Promise<boolean> => {
            // Deliberately broken: read, decide, THEN write — two concurrent
            // calls can both read the same pre-increment count, both decide
            // "under cap," and both write, letting the count exceed the cap.
            // This is exactly the shape `PrismaRefreshStore.incrementGraceReplay`'s
            // doc comment warns against; it exists only to prove the real,
            // atomic version's test actually discriminates.
            const prisma = getLibraryPlatformPrisma();
            const row = await prisma.refreshToken.findUniqueOrThrow({ where: { id } });
            if (row.graceReplayCount >= cap) return false;
            await prisma.refreshToken.update({
              where: { id },
              data: { graceReplayCount: row.graceReplayCount + 1 },
            });
            return true;
          }
        : (id: string, cap: number) => inner.incrementGraceReplay(id, cap);
      return {
        findByHash: (hash) => inner.findByHash(hash),
        create: (row) => inner.create(row),
        revokeFamily: (familyId) => inner.revokeFamily(familyId),
        markUsed: (id, supersededAt) => inner.markUsed(id, supersededAt),
        loadUser: (uid) => inner.loadUser(uid),
        recordGraceReplay: (event) => inner.recordGraceReplay(event),
        incrementGraceReplay: async (id, cap) => {
          arrived += 1;
          if (arrived >= parties) release();
          await everyoneArrived;
          return incrementGraceReplay(id, cap);
        },
      };
    };
  }

  async function seedSupersededParent(overrides: { graceReplayCount?: number } = {}): Promise<{ raw: string; familyId: string; id: string }> {
    const familyId = randomUUID();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const raw = `cap-${suffix}`;
    const supersededAt = new Date(Date.now() - 500); // well within the 15s default grace window
    const row = await getLibraryPlatformPrisma().refreshToken.create({
      data: {
        userId, tokenHash: sha256(raw), familyId,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: supersededAt,
        supersededAt,
        graceReplayCount: overrides.graceReplayCount ?? 0,
      },
    });
    return { raw, familyId, id: row.id };
  }

  async function seedParent(): Promise<{ raw: string; familyId: string }> {
    const familyId = randomUUID();
    const raw = `race-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    await getLibraryPlatformPrisma().refreshToken.create({
      data: { userId, tokenHash: sha256(raw), familyId, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    return { raw, familyId };
  }

  it('two concurrent rotate() calls on one valid token both resolve, and the family stays unrevoked', async () => {
    const { raw, familyId } = await seedParent();
    const makeStore = barrieredStore(2);
    const signer = { signAccess: () => 'access-token' };
    const serviceA = new RefreshService(makeStore(), signer, 30);
    const serviceB = new RefreshService(makeStore(), signer, 30);

    // Fire concurrently — sequential awaits would trivially serialize the
    // two calls and prove nothing about the race.
    const [a, b] = await Promise.allSettled([serviceA.rotate(raw), serviceB.rotate(raw)]);

    expect(a.status).toBe('fulfilled');
    expect(b.status).toBe('fulfilled');
    const tokenA = a.status === 'fulfilled' ? a.value.refreshToken : undefined;
    const tokenB = b.status === 'fulfilled' ? b.value.refreshToken : undefined;
    expect(tokenA).toBeDefined();
    expect(tokenB).toBeDefined();
    // The loser is NOT handed a copy of the winner's child — it mints its
    // OWN fresh, independent child (Finding-1 fix: nothing reusable is
    // persisted for a replayer to be handed back).
    expect(tokenA).not.toBe(tokenB);

    const rows = await getLibraryPlatformPrisma().refreshToken.findMany({ where: { familyId } });
    expect(rows).toHaveLength(3); // parent + two independently-minted children
    const active = rows.filter((r) => r.revokedAt === null);
    // The family was NOT revoked: both children are live, and both callers'
    // tokens correspond to a real, active row.
    expect(active).toHaveLength(2);
    const activeHashes = active.map((r) => r.tokenHash).sort();
    expect(activeHashes).toEqual([sha256(tokenA!), sha256(tokenB!)].sort());
  });

  /**
   * Finding 2 (review): a grace hit must be investigable after the fact.
   * This proves the audit signal actually lands in Postgres, through the
   * real `RefreshService.rotate` → `PrismaRefreshStore.recordGraceReplay`
   * path, with the right ids/duration and nothing token-shaped in it.
   */
  it('a grace-window replay writes an AuditLog row with ids and elapsed time, and no token or hash anywhere in it', async () => {
    const prisma = getLibraryPlatformPrisma();
    const familyId = randomUUID();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const raw = `audited-parent-${suffix}`;
    const supersededAt = new Date(Date.now() - 2_000);
    const parent = await prisma.refreshToken.create({
      data: {
        userId, tokenHash: sha256(raw), familyId,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: supersededAt,
        supersededAt,
      },
    });

    const service = new RefreshService(new PrismaRefreshStore(), { signAccess: () => 'access-token' }, 30);
    const result = await service.rotate(raw);
    expect(result.refreshToken).toBeTruthy();

    const events = await prisma.auditLog.findMany({
      where: { orgId, action: 'auth.refresh.grace_replay', entityId: parent.id },
    });
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.actorUserId).toBe(userId);
    expect(event.entity).toBe('RefreshToken');
    const after = event.after as { familyId: string; replayedAfterMs: number };
    expect(after.familyId).toBe(familyId);
    expect(after.replayedAfterMs).toBeGreaterThanOrEqual(2_000);

    // Nothing token-shaped anywhere in the row: not the raw token, not its
    // hash, not the minted child's raw value or hash.
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(raw);
    expect(serialized).not.toContain(sha256(raw));
    expect(serialized).not.toContain(result.refreshToken);
    expect(serialized).not.toContain(sha256(result.refreshToken));
  });

  /**
   * Second review finding: minting fresh on every grace-window replay
   * (Finding 1's fix) made the NUMBER of replays unbounded — anyone holding
   * the raw parent could fire rapid replays inside the window and mint an
   * arbitrary number of independent tokens. `REFRESH_GRACE_REPLAY_CAP`
   * bounds it: the replay that reaches the cap still mints; the next one
   * is treated as theft.
   */
  it('a replay that reaches the cap mints; the next replay of the SAME parent is treated as theft', async () => {
    const prisma = getLibraryPlatformPrisma();
    const { raw, familyId, id } = await seedSupersededParent({ graceReplayCount: REFRESH_GRACE_REPLAY_CAP - 1 });
    const service = new RefreshService(new PrismaRefreshStore(), { signAccess: () => 'access-token' }, 30);

    // This replay pushes graceReplayCount from cap-1 to cap — still allowed.
    const atCap = await service.rotate(raw);
    expect(atCap.refreshToken).toBeTruthy();
    const afterAtCap = await prisma.refreshToken.findUniqueOrThrow({ where: { id } });
    expect(afterAtCap.graceReplayCount).toBe(REFRESH_GRACE_REPLAY_CAP);

    // The SAME parent, replayed again: graceReplayCount is now at the cap,
    // so this one is theft, not another retry.
    await expect(service.rotate(raw)).rejects.toBeInstanceOf(UnauthorizedException);
    const rows = await prisma.refreshToken.findMany({ where: { familyId } });
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);

    // Crossing the cap records the family revoke, not a second grace
    // replay — exactly one audit row exists (from the in-cap mint above).
    const events = await prisma.auditLog.findMany({
      where: { orgId, action: 'auth.refresh.grace_replay', entityId: id },
    });
    expect(events).toHaveLength(1);
  });

  it('the counter is per parent: a fresh child from an ordinary rotation starts at 0', async () => {
    const prisma = getLibraryPlatformPrisma();
    const { raw } = await seedParent();
    const service = new RefreshService(new PrismaRefreshStore(), { signAccess: () => 'access-token' }, 30);
    const result = await service.rotate(raw);
    const child = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(result.refreshToken) } });
    expect(child.graceReplayCount).toBe(0);
  });

  it('concurrent replays of the SAME parent cannot exceed the cap', async () => {
    const prisma = getLibraryPlatformPrisma();
    const parties = REFRESH_GRACE_REPLAY_CAP + 2; // more attempts than the cap allows
    const { raw, id } = await seedSupersededParent();
    const makeStore = capRaceStore(parties);
    const signer = { signAccess: () => 'access-token' };
    const services = Array.from({ length: parties }, () => new RefreshService(makeStore(), signer, 30));

    const outcomes = await Promise.allSettled(services.map((s) => s.rotate(raw)));
    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(REFRESH_GRACE_REPLAY_CAP);
    expect(rejected).toHaveLength(parties - REFRESH_GRACE_REPLAY_CAP);
    for (const r of rejected) expect((r as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);

    const after = await prisma.refreshToken.findUniqueOrThrow({ where: { id } });
    // The atomic guard held: exactly at the cap, never past it, regardless
    // of how many concurrent attempts raced it.
    expect(after.graceReplayCount).toBe(REFRESH_GRACE_REPLAY_CAP);
  });

  /**
   * Deliberately broken: swaps in a non-atomic read-then-write increment
   * (see `capRaceStore`'s `broken` option) for the SAME race as the test
   * above, and shows the cap gets exceeded — proving the previous test's
   * green result comes from `incrementGraceReplay`'s atomicity, not from
   * the barrier or from the cap simply being generous enough not to matter.
   */
  it('deliberately broken: a non-atomic increment lets concurrent replays exceed the cap', async () => {
    const prisma = getLibraryPlatformPrisma();
    const parties = REFRESH_GRACE_REPLAY_CAP + 2;
    const { raw, id } = await seedSupersededParent();
    const makeStore = capRaceStore(parties, { broken: true });
    const signer = { signAccess: () => 'access-token' };
    const services = Array.from({ length: parties }, () => new RefreshService(makeStore(), signer, 30));

    const outcomes = await Promise.allSettled(services.map((s) => s.rotate(raw)));
    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');

    // With the broken, non-atomic increment, more than `cap` concurrent
    // replays can all read the same pre-increment count and all pass —
    // this is the exact bug the atomic `updateMany` guard prevents, and the
    // property that actually matters (how many tokens got minted).
    expect(fulfilled.length).toBeGreaterThan(REFRESH_GRACE_REPLAY_CAP);

    // The stored counter itself is NOT a reliable witness of this failure
    // mode, and deliberately not asserted on here: each racing writer
    // computes `staleRead + 1` and does a plain SET rather than a DB-side
    // increment, so concurrent writers produce a classic lost update — the
    // column ends up holding whichever writer committed LAST (often just
    // 1), not a sum of every successful replay. The counter can silently
    // UNDER-report while `fulfilled.length` above proves the real harm:
    // strictly more requests were let through than the cap allows.
    const after = await prisma.refreshToken.findUniqueOrThrow({ where: { id } });
    expect(after.graceReplayCount).toBeLessThanOrEqual(fulfilled.length);
  });

  it('deliberately broken: with graceMs forced to 0 on the SAME race, the loser is rejected and the family IS revoked', async () => {
    const { raw } = await seedParent();
    const parentBefore = await getLibraryPlatformPrisma().refreshToken.findUniqueOrThrow({
      where: { tokenHash: sha256(raw) },
    });
    const makeStore = barrieredStore(2);
    const signer = { signAccess: () => 'access-token' };
    // graceMs: 0 removes the tolerance this task adds — this proves the
    // PREVIOUS test's green result comes from the grace window, not from
    // some other accidental effect of the barrier or the atomic markUsed.
    const serviceA = new RefreshService(makeStore(), signer, 30, 0);
    const serviceB = new RefreshService(makeStore(), signer, 30, 0);

    const [a, b] = await Promise.allSettled([serviceA.rotate(raw), serviceB.rotate(raw)]);
    const outcomes = [a, b];
    const fulfilled = outcomes.filter((r) => r.status === 'fulfilled');
    const rejected = outcomes.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);

    // With no grace window, the loser's replay of the just-superseded parent
    // reads as theft and revokes the family — logging the legitimate winner
    // out. This is the exact bug Task 1 fixes; forcing graceMs to 0
    // reintroduces it on demand. We only assert on the PARENT row here
    // (identified by id, not swept by familyId): whether the winner's
    // brand-new child has committed by the time the loser's revokeFamily
    // query runs is a genuine, unordered race between two independent
    // async chains once both pass the barrier — the barrier only forces the
    // two *reads* to overlap, which is all the property under test needs.
    // (In production this ambiguity does not arise: the grace window is
    // seconds long, so by the time anything is far enough past it to be
    // treated as theft, the winner's single fast INSERT finished it long
    // ago.)
    const parentAfter = await getLibraryPlatformPrisma().refreshToken.findUniqueOrThrow({
      where: { id: parentBefore.id },
    });
    expect(parentAfter.revokedAt).not.toBeNull();
  });

  /**
   * No concurrency, no graceMs override — the DEFAULT `REFRESH_GRACE_MS`
   * (15s) against real Postgres, replaying a token that was superseded long
   * enough ago that grace cannot apply. This is the property the whole
   * feature exists alongside: a genuine offline theft replay (not a
   * same-second retry) must still take the family down.
   */
  it('a replay well outside the default grace window still revokes the family, via real RefreshService.rotate', async () => {
    const prisma = getLibraryPlatformPrisma();
    const familyId = randomUUID();
    const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const raw = `stale-parent-${suffix}`;
    await prisma.refreshToken.create({
      data: {
        userId, tokenHash: sha256(raw), familyId,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: new Date(Date.now() - 600_000),
        supersededAt: new Date(Date.now() - 600_000), // 10 minutes ago — 40x the 15s grace window
      },
    });
    // The live child descended from that old rotation, exactly like a real session.
    const childRaw = `child-of-stale-parent-${suffix}`;
    const child = await prisma.refreshToken.create({
      data: { userId, tokenHash: sha256(childRaw), familyId, expiresAt: new Date(Date.now() + 86_400_000) },
    });

    const service = new RefreshService(new PrismaRefreshStore(), { signAccess: () => 'access-token' }, 30);
    await expect(service.rotate(raw)).rejects.toBeInstanceOf(UnauthorizedException);

    const rows = await prisma.refreshToken.findMany({ where: { familyId } });
    expect(rows).toHaveLength(2);
    // The family — including the still-live child the legitimate owner is
    // presumably still using — is revoked. This is the correct, intended
    // consequence of a stale-token replay: it looks like theft because,
    // this far outside the grace window, it is.
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    const childAfter = rows.find((r) => r.id === child.id);
    expect(childAfter?.revokedAt).not.toBeNull();

    // And no audit event was written for it — outside the grace window this
    // is theft-handling, not a grace hit, and should not be recorded as one.
    const events = await prisma.auditLog.findMany({
      where: { orgId, action: 'auth.refresh.grace_replay', after: { path: ['familyId'], equals: familyId } },
    });
    expect(events).toEqual([]);
  });
});
