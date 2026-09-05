// @vitest-environment node
//
// The purge endpoint is the thing that makes a school's edit appear at once
// instead of within 60 seconds. It is also an endpoint that asks the server to
// throw work away, so the guard matters as much as the behaviour.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tagged: string[] = [];
vi.mock('next/cache', () => ({
  revalidateTag: (t: string) => {
    tagged.push(t);
  },
}));

async function post(body: unknown, secret?: string, envSecret?: string) {
  vi.resetModules();
  tagged.length = 0;
  process.env.REVALIDATE_SECRET = envSecret ?? '';
  const { POST } = await import('./route');
  const req = {
    headers: new Headers(secret ? { 'x-revalidate-secret': secret } : {}),
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
  return POST(req);
}

beforeEach(() => vi.resetModules());

describe('POST /api/revalidate', () => {
  it('purges exactly the hosts it is given', async () => {
    const res = await post({ hosts: ['stmarys.edu.in', 'stmarys.sckools.com'] }, 's3cret', 's3cret');
    expect(res.status).toBe(200);
    expect(tagged).toEqual(['site:stmarys.edu.in', 'site:stmarys.sckools.com']);
  });

  it('lower-cases and trims, so a host is tagged the way it was cached', async () => {
    await post({ hosts: ['  StMarys.Edu.In  '] }, 's3cret', 's3cret');
    expect(tagged).toEqual(['site:stmarys.edu.in']);
  });

  it('refuses a wrong or missing secret, and purges nothing', async () => {
    for (const s of [undefined, 'wrong']) {
      const res = await post({ hosts: ['a.com'] }, s, 's3cret');
      expect(res.status).toBe(403);
    }
    expect(tagged).toEqual([]);
  });

  it('answers 503 when the deployment has no secret configured', async () => {
    const res = await post({ hosts: ['a.com'] }, 'anything', '');
    expect(res.status).toBe(503);
    expect(tagged).toEqual([]);
  });

  it('rejects a malformed body rather than guessing', async () => {
    for (const b of [{}, { hosts: 'a.com' }, { hosts: [1, 2] }]) {
      const res = await post(b, 's3cret', 's3cret');
      expect(res.status).toBe(400);
    }
    expect(tagged).toEqual([]);
  });
});
