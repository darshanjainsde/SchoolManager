import * as SecureStore from 'expo-secure-store';
import type { SaveAttendanceRequest } from '@skoolos/types';
import { ApiError } from './api';

/**
 * Attendance saves ONLY — not notes, not todos, not leave, not results.
 * Those flows fail loudly and the teacher retries; attendance is the one
 * flow where a teacher stands in a corridor with a dead signal and a marked
 * roster they must not lose. `PUT /manage/attendance` is idempotent for the
 * same class+date (the server deletes and recreates that day's rows per
 * save, and the newly-absent-guardian-email diff is computed server-side),
 * so replaying a queued save later — even twice — is harmless.
 */

/** One slot per class+date — see `enqueueSave`. */
export function queueKey(classSectionId: string, date: string): string {
  return `${classSectionId}:${date}`;
}

export interface QueuedSave {
  key: string;
  payload: SaveAttendanceRequest;
  /** epoch ms, from the injected clock (see `QueueDeps.now`). */
  queuedAt: number;
}

export interface RejectedSave {
  entry: QueuedSave;
  /** Server `message`, verbatim. */
  message: string;
}

export interface FlushResult {
  synced: QueuedSave[];
  rejected: RejectedSave[];
  retained: QueuedSave[];
}

/**
 * The minimal key-value contract the queue needs from a backing store —
 * lets tests inject an in-memory fake instead of touching real device
 * storage, and lets the real implementation hide SecureStore's per-value
 * size limit behind chunking (see `createSecureStoreQueueStorage` below).
 */
export interface QueueStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

export interface QueueDeps {
  storage?: QueueStorage;
  now?: () => number;
}

interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

// expo-secure-store documents a ~2048-byte per-value limit on Android. A
// realistic 40-student roster (real UUID student ids, per
// packages/db/prisma/schema.prisma's `Student.id`) serializes to *more*
// than that on its own — see the "40-student payload" test in
// offline-queue.test.ts — so a single SecureStore key cannot hold the queue
// once more than a handful of students are marked. AsyncStorage has no such
// limit, but it is not currently a dependency of this app (see
// apps/mobile/package.json); pulling in a new native module for one flow
// was judged worse than a small amount of chunking logic contained
// entirely in this file. The serialized queue is therefore split across
// multiple SecureStore keys and reassembled on read.
const CHUNK_SIZE = 1500;
const MANIFEST_KEY = 'sckools.offlineAttendanceQueue.chunks';
const chunkKey = (i: number) => `sckools.offlineAttendanceQueue.chunk.${i}`;

export function createSecureStoreQueueStorage(store: SecureStoreLike): QueueStorage {
  return {
    async read() {
      const countRaw = await store.getItemAsync(MANIFEST_KEY);
      if (!countRaw) return null;
      const count = Number(countRaw);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        parts.push((await store.getItemAsync(chunkKey(i))) ?? '');
      }
      return parts.join('');
    },
    async write(value: string) {
      const prevCountRaw = await store.getItemAsync(MANIFEST_KEY);
      const prevCount = prevCountRaw ? Number(prevCountRaw) : 0;
      const nextChunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE) {
        nextChunks.push(value.slice(i, i + CHUNK_SIZE));
      }
      for (let i = 0; i < nextChunks.length; i++) {
        await store.setItemAsync(chunkKey(i), nextChunks[i]);
      }
      // Drop any chunks left over from a previous, longer write.
      for (let i = nextChunks.length; i < prevCount; i++) {
        await store.deleteItemAsync(chunkKey(i));
      }
      // Manifest written last: if the app dies mid-write, the old manifest
      // (if any) still points only at a complete, previously-written set of
      // chunks — never a mix of new and stale ones. A read that still lands
      // on a torn write is caught by `readQueue`'s JSON.parse guard below,
      // which treats it as an empty queue rather than throwing.
      await store.setItemAsync(MANIFEST_KEY, String(nextChunks.length));
    },
  };
}

export const secureStoreQueueStorage: QueueStorage = createSecureStoreQueueStorage(SecureStore);

async function readQueue(storage: QueueStorage): Promise<Record<string, QueuedSave>> {
  const raw = await storage.read();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, QueuedSave>;
  } catch {
    // A corrupted/partial blob is treated as an empty queue rather than
    // thrown — losing an unsynced local save is unfortunate, but strictly
    // better than crashing every attendance screen on every future launch.
    return {};
  }
}

async function writeQueue(storage: QueueStorage, queue: Record<string, QueuedSave>): Promise<void> {
  await storage.write(JSON.stringify(queue));
}

/**
 * Persists a save keyed by `${classSectionId}:${date}` — a teacher
 * re-marking the same register replaces the queued save, it never appends.
 * The queue is a map, not a list.
 */
export async function enqueueSave(payload: SaveAttendanceRequest, deps: QueueDeps = {}): Promise<void> {
  const storage = deps.storage ?? secureStoreQueueStorage;
  const now = deps.now ?? Date.now;
  const queue = await readQueue(storage);
  const key = queueKey(payload.classSectionId, payload.date);
  queue[key] = { key, payload, queuedAt: now() };
  await writeQueue(storage, queue);
}

export async function pendingSaves(deps: QueueDeps = {}): Promise<QueuedSave[]> {
  const storage = deps.storage ?? secureStoreQueueStorage;
  const queue = await readQueue(storage);
  return Object.values(queue);
}

interface FlushApi {
  request<T>(path: string, opts: { method: string; body: unknown }): Promise<T>;
}

/**
 * Attempts every queued save against the real API.
 *
 * - Success: removed from the queue, reported in `synced`.
 * - A 4xx response (validation, 403, 409 REGISTER_LOCKED) means the server
 *   has looked at this exact payload and refused it — retrying it forever
 *   is wrong, so it's removed from the queue and reported in `rejected`
 *   with the server's `message` verbatim; the teacher must be told, not
 *   silently retried.
 * - A 401 is the one 4xx treated like a network failure (kept, not
 *   rejected): unlike the other cases it doesn't mean *this payload* is
 *   invalid, only that the session couldn't be re-authenticated by the
 *   time flush ran. Discarding a teacher's marked roster because of an
 *   expired token would recreate exactly the data loss this queue exists
 *   to prevent.
 * - Anything else (network failure — `ApiError` status 0 from
 *   `safeFetch` — or a 5xx) is transient and the entry is kept for the
 *   next flush, reported in `retained`.
 */
export async function flush(api: FlushApi, deps: QueueDeps = {}): Promise<FlushResult> {
  const storage = deps.storage ?? secureStoreQueueStorage;
  const queue = await readQueue(storage);
  const synced: QueuedSave[] = [];
  const rejected: RejectedSave[] = [];
  const retained: QueuedSave[] = [];

  for (const entry of Object.values(queue)) {
    try {
      await api.request('/manage/attendance', { method: 'PUT', body: entry.payload });
      synced.push(entry);
      delete queue[entry.key];
    } catch (e) {
      const isClientRejection =
        e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401;
      if (isClientRejection) {
        rejected.push({ entry, message: (e as ApiError).message });
        delete queue[entry.key];
      } else {
        retained.push(entry);
      }
    }
  }

  await writeQueue(storage, queue);
  return { synced, rejected, retained };
}
