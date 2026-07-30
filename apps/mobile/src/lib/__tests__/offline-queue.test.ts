import type { SaveAttendanceRequest } from '@skoolos/types';
import { ApiError } from '@/lib/api';
import {
  createSecureStoreQueueStorage,
  enqueueSave,
  flush,
  pendingSaves,
  type QueueStorage,
} from '../offline-queue';

function inMemoryStorage(): QueueStorage {
  let value: string | null = null;
  return {
    async read() {
      return value;
    },
    async write(v: string) {
      value = v;
    },
  };
}

function payload(overrides: Partial<SaveAttendanceRequest> = {}): SaveAttendanceRequest {
  return {
    classSectionId: 'cs-1',
    date: '2026-07-30',
    marks: [{ studentId: 's1', status: 'PRESENT' }],
    ...overrides,
  };
}

describe('offline-queue', () => {
  it('enqueue then flush success: PUT is called with the exact payload, and the queue is empty after', async () => {
    const storage = inMemoryStorage();
    const p = payload();
    await enqueueSave(p, { storage, now: () => 1000 });

    const request = jest.fn().mockResolvedValue({ saved: 1, absentees: 0 });
    const result = await flush({ request }, { storage });

    expect(request).toHaveBeenCalledWith('/manage/attendance', { method: 'PUT', body: p });
    expect(result.synced).toHaveLength(1);
    expect(result.synced[0].payload).toEqual(p);
    expect(result.rejected).toHaveLength(0);
    expect(result.retained).toHaveLength(0);
    expect(await pendingSaves({ storage })).toEqual([]);
  });

  it('edge: two enqueues for the same class+date collapse into ONE entry holding the second payload (last-write-wins)', async () => {
    const storage = inMemoryStorage();
    await enqueueSave(payload({ marks: [{ studentId: 's1', status: 'ABSENT' }] }), {
      storage,
      now: () => 1000,
    });
    await enqueueSave(payload({ marks: [{ studentId: 's1', status: 'PRESENT' }] }), {
      storage,
      now: () => 2000,
    });

    const pending = await pendingSaves({ storage });
    expect(pending).toHaveLength(1);
    expect(pending[0].payload.marks).toEqual([{ studentId: 's1', status: 'PRESENT' }]);
    expect(pending[0].queuedAt).toBe(2000); // the injected clock, not a real Date.now()
  });

  it('a different class+date makes a separate entry, and both flush', async () => {
    const storage = inMemoryStorage();
    const a = payload({ classSectionId: 'cs-1' });
    const b = payload({ classSectionId: 'cs-2' });
    await enqueueSave(a, { storage, now: () => 1000 });
    await enqueueSave(b, { storage, now: () => 1000 });

    expect(await pendingSaves({ storage })).toHaveLength(2);

    const request = jest.fn().mockResolvedValue({ saved: 1, absentees: 0 });
    const result = await flush({ request }, { storage });

    expect(result.synced).toHaveLength(2);
    expect(request).toHaveBeenCalledWith('/manage/attendance', { method: 'PUT', body: a });
    expect(request).toHaveBeenCalledWith('/manage/attendance', { method: 'PUT', body: b });
    expect(await pendingSaves({ storage })).toEqual([]);
  });

  it('a network failure during flush retains the entry — nothing is lost', async () => {
    const storage = inMemoryStorage();
    const p = payload();
    await enqueueSave(p, { storage, now: () => 1000 });

    const request = jest.fn().mockRejectedValue(new ApiError(0, 'Could not reach the school server.'));
    const result = await flush({ request }, { storage });

    expect(result.synced).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.retained).toHaveLength(1);
    expect(await pendingSaves({ storage })).toHaveLength(1);
    expect((await pendingSaves({ storage }))[0].payload).toEqual(p);
  });

  it('edge: a 409 REGISTER_LOCKED removes the entry and reports it rejected, preserving the server message', async () => {
    const storage = inMemoryStorage();
    const p = payload();
    await enqueueSave(p, { storage, now: () => 1000 });

    const request = jest
      .fn()
      .mockRejectedValue(
        new ApiError(409, 'That day is closed. Ask your admin to reopen it from Requests.'),
      );
    const result = await flush({ request }, { storage });

    expect(result.synced).toHaveLength(0);
    expect(result.retained).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].message).toBe(
      'That day is closed. Ask your admin to reopen it from Requests.',
    );
    expect(result.rejected[0].entry.payload).toEqual(p);
    expect(await pendingSaves({ storage })).toEqual([]); // never retried again
  });

  it('edge: a 403 gets the same removal+report treatment as a 409', async () => {
    const storage = inMemoryStorage();
    const p = payload();
    await enqueueSave(p, { storage, now: () => 1000 });

    const request = jest.fn().mockRejectedValue(new ApiError(403, 'You do not have access to this class.'));
    const result = await flush({ request }, { storage });

    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].message).toBe('You do not have access to this class.');
    expect(await pendingSaves({ storage })).toEqual([]);
  });

  it('a 401 is retained, not rejected — an expired session must not discard a marked roster', async () => {
    const storage = inMemoryStorage();
    const p = payload();
    await enqueueSave(p, { storage, now: () => 1000 });

    const request = jest.fn().mockRejectedValue(new ApiError(401, 'Session expired — please log in again.'));
    const result = await flush({ request }, { storage });

    expect(result.rejected).toHaveLength(0);
    expect(result.retained).toHaveLength(1);
    expect(await pendingSaves({ storage })).toHaveLength(1);
  });

  it('payload size: a 40-student payload round-trips through the real storage mock within the limit found', async () => {
    // Simulates SecureStore's documented ~2048-byte per-value limit on
    // Android by throwing if any single write would exceed it — this
    // proves the chunking in `createSecureStoreQueueStorage` actually keeps
    // every individual stored value under that ceiling, using the real
    // chunking code path (not a reimplementation).
    const LIMIT = 2048;
    const backing = new Map<string, string>();
    const fakeSecureStore = {
      async getItemAsync(key: string) {
        return backing.get(key) ?? null;
      },
      async setItemAsync(key: string, value: string) {
        if (value.length > LIMIT) {
          throw new Error(`value for ${key} is ${value.length} bytes, over the ${LIMIT}-byte limit`);
        }
        backing.set(key, value);
      },
      async deleteItemAsync(key: string) {
        backing.delete(key);
      },
    };
    const storage = createSecureStoreQueueStorage(fakeSecureStore);

    // Real Student ids are UUIDs (see packages/db/prisma/schema.prisma —
    // `Student.id String @id @default(uuid())`), 36 characters each.
    const marks = Array.from({ length: 40 }, (_, i) => ({
      studentId: `${String(i).padStart(8, '0')}-89ab-4def-8123-456789abcdef`,
      status: 'PRESENT' as const,
    }));
    const p = payload({ marks });
    // Sanity check the premise: a real 40-student payload alone is already
    // bigger than a single SecureStore value can hold, so this test is
    // actually exercising the chunking path, not accidentally fitting in
    // one write.
    expect(JSON.stringify(p).length).toBeGreaterThan(LIMIT);

    await enqueueSave(p, { storage, now: () => 1000 });
    const pending = await pendingSaves({ storage });

    expect(pending).toHaveLength(1);
    expect(pending[0].payload).toEqual(p);
  });
});
