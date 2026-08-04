import * as SecureStore from 'expo-secure-store';
import { session, type Session } from './session';

/**
 * The family shelf (Phase 5·2, Option B — linked profiles). Each child is a
 * complete, ordinary per-school STUDENT session; the app holds several and
 * switches which one is "active". Isolation is structural: every child keeps
 * their own tokens for their own school host, and the api layer only ever
 * sees the single active session (`@/lib/session`), so nothing can bleed
 * between children or schools.
 *
 * TOKEN ROTATION: `api.ts` refreshes rotate the refresh token and persist it
 * via `session.set` — into the ACTIVE slot only. So before switching away,
 * `setActive`/`add` first CAPTURE the live session back into the child that
 * owned it; skipping that would strand a stale (already-rotated → revoked)
 * refresh token in the shelf copy and force a re-login on switch-back.
 */

export interface ChildProfile {
  /** Stable identity: schoolHost + displayName (one login per child per school). */
  key: string;
  displayName: string;
  schoolHost: string;
  /** Deterministic accent for the spine band / avatar ring — stable per school. */
  accent: string;
  session: Session;
}

interface FamilyState {
  children: ChildProfile[];
  activeKey: string | null;
}

const KEY = 'sckools.family';

const ACCENTS = ['#4F46E5', '#178A5B', '#B45309', '#7C3AED', '#0E7490', '#BE185D'];

/** Stable accent per school host — same school, same colour, every child. */
export function accentFor(host: string): string {
  let h = 0;
  for (let i = 0; i < host.length; i++) h = (h * 31 + host.charCodeAt(i)) >>> 0;
  return ACCENTS[h % ACCENTS.length];
}

function keyFor(s: Session): string {
  return `${s.schoolHost}::${s.displayName}`;
}

async function load(): Promise<FamilyState> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as FamilyState) : { children: [], activeKey: null };
}

async function save(state: FamilyState): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(state));
}

/** Pull the live (possibly token-rotated) session back into its owning child. */
async function captureActive(state: FamilyState): Promise<void> {
  if (!state.activeKey) return;
  const live = await session.get();
  if (!live) return;
  const owner = state.children.find((c) => c.key === state.activeKey);
  if (owner && keyFor(live) === owner.key) owner.session = live;
}

export const family = {
  async list(): Promise<ChildProfile[]> {
    return (await load()).children;
  },

  async activeKey(): Promise<string | null> {
    return (await load()).activeKey;
  },

  /**
   * Registers a freshly logged-in STUDENT session as a child (upsert by
   * host+name — re-adding the same child just refreshes their tokens) and
   * makes them active. The caller has already `session.set` via api.login;
   * we capture the PREVIOUS child first so their rotation isn't lost.
   */
  async add(s: Session): Promise<ChildProfile> {
    const state = await load();
    // The live session is already the NEW child's, so the previous child's
    // last-known tokens are whatever we stored — nothing newer to capture.
    const key = keyFor(s);
    const child: ChildProfile = {
      key,
      displayName: s.displayName,
      schoolHost: s.schoolHost,
      accent: accentFor(s.schoolHost),
      session: s,
    };
    const at = state.children.findIndex((c) => c.key === key);
    if (at >= 0) state.children[at] = child;
    else state.children.push(child);
    state.activeKey = key;
    await save(state);
    return child;
  },

  /** Switch the active child: capture the leaver's live tokens, then install the target's. */
  async setActive(key: string): Promise<ChildProfile | null> {
    const state = await load();
    const target = state.children.find((c) => c.key === key);
    if (!target) return null;
    await captureActive(state);
    state.activeKey = key;
    await save(state);
    await session.set(target.session);
    await session.setSchoolHost(target.schoolHost);
    return target;
  },

  /** Remove one child; if they were active, fall over to the next (or sign out). */
  async remove(key: string): Promise<ChildProfile | null> {
    const state = await load();
    state.children = state.children.filter((c) => c.key !== key);
    let next: ChildProfile | null = null;
    if (state.activeKey === key) {
      next = state.children[0] ?? null;
      state.activeKey = next?.key ?? null;
      if (next) {
        await session.set(next.session);
        await session.setSchoolHost(next.schoolHost);
      } else {
        await session.clear();
      }
    }
    await save(state);
    return next;
  },

  /** Full sign-out — the drawer's Log out: every child forgotten. */
  async clearAll(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  },

  /**
   * One-time boot migration: a device holding a single pre-5·2 STUDENT
   * session becomes a one-child shelf, so "Switch diary" and add-a-child
   * work immediately after the update.
   */
  async migrateLegacy(): Promise<void> {
    const state = await load();
    if (state.children.length > 0) return;
    const live = await session.get();
    if (live?.role === 'STUDENT') {
      await this.add(live);
    }
  },
};
