jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
    __store: store,
  };
});

import { family, accentFor } from '../family-store';
import { session, type Session } from '../session';

function child(name: string, host = 'raffles.sckools.com', over: Partial<Session> = {}): Session {
  return {
    accessToken: `at-${name}`,
    refreshToken: `rt-${name}`,
    role: 'STUDENT',
    schoolHost: host,
    displayName: name,
    ...over,
  };
}

async function wipe() {
  await family.clearAll();
  await session.clear();
}

describe('family-store (Phase 5·2 — the shelf)', () => {
  beforeEach(async () => {
    await wipe();
  });

  it('add() registers a child, makes them active, and upserts by host+name', async () => {
    await session.set(child('Aarav Sharma'));
    await family.add(child('Aarav Sharma'));

    expect((await family.list()).map((c) => c.displayName)).toEqual(['Aarav Sharma']);
    expect(await family.activeKey()).toBe('raffles.sckools.com::Aarav Sharma');

    // Re-adding the same child (fresh login) replaces tokens, not duplicates.
    await family.add(child('Aarav Sharma', 'raffles.sckools.com', { refreshToken: 'rt-new' }));
    const list = await family.list();
    expect(list).toHaveLength(1);
    expect(list[0].session.refreshToken).toBe('rt-new');
  });

  it('setActive() installs the target session AND captures the leaver’s rotated tokens', async () => {
    await session.set(child('Aarav Sharma'));
    await family.add(child('Aarav Sharma'));
    await session.set(child('Diya Sharma', 'gvs.sckools.com'));
    await family.add(child('Diya Sharma', 'gvs.sckools.com'));

    // Diya is active; api.ts rotates her refresh token in place:
    await session.set(child('Diya Sharma', 'gvs.sckools.com', { refreshToken: 'rt-rotated' }));

    // Switch to Aarav — Diya's ROTATED token must be captured, not lost.
    const target = await family.setActive('raffles.sckools.com::Aarav Sharma');
    expect(target?.displayName).toBe('Aarav Sharma');
    expect((await session.get())?.refreshToken).toBe('rt-Aarav Sharma');

    const diya = (await family.list()).find((c) => c.displayName === 'Diya Sharma');
    expect(diya?.session.refreshToken).toBe('rt-rotated');

    // And the active host follows the child (cross-school isolation).
    expect(await session.getSchoolHost()).toBe('raffles.sckools.com');
  });

  it('remove() of the active child falls over to the next, or signs out when last', async () => {
    await session.set(child('Aarav Sharma'));
    await family.add(child('Aarav Sharma'));
    await family.add(child('Diya Sharma', 'gvs.sckools.com'));

    const next = await family.remove('gvs.sckools.com::Diya Sharma'); // active one
    expect(next?.displayName).toBe('Aarav Sharma');
    expect((await session.get())?.displayName).toBe('Aarav Sharma');

    await family.remove('raffles.sckools.com::Aarav Sharma');
    expect(await session.get()).toBeNull();
    expect(await family.list()).toEqual([]);
  });

  it('migrateLegacy() lifts a lone pre-5·2 STUDENT session onto the shelf — once, students only', async () => {
    await session.set(child('Aarav Sharma'));
    await family.migrateLegacy();
    expect(await family.list()).toHaveLength(1);

    // Idempotent.
    await family.migrateLegacy();
    expect(await family.list()).toHaveLength(1);

    // A teacher session never lands on the family shelf.
    await family.clearAll();
    await session.set({ ...child('Ms Iyer'), role: 'TEACHER' });
    await family.migrateLegacy();
    expect(await family.list()).toEqual([]);
  });

  it('accentFor() is deterministic per host', () => {
    expect(accentFor('raffles.sckools.com')).toBe(accentFor('raffles.sckools.com'));
    expect(accentFor('raffles.sckools.com')).toMatch(/^#[0-9A-F]{6}$/i);
  });
});
