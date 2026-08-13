import { BadRequestException, ConflictException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError, type Observable } from 'rxjs';
import {
  IdempotencyInterceptor,
  hashRequest,
  concreteRequestPath,
  type CreateResult,
  type IdempotencyRecord,
  type IdempotencyStore,
} from './idempotency.interceptor';
import { OrgContextService } from '../../modules/tenancy';

const ORG = '11111111-1111-4111-8111-111111111111';

function fakeStore(overrides: Partial<IdempotencyStore> = {}): IdempotencyStore & { calls: { find: unknown[]; create: unknown[] } } {
  const calls = { find: [] as unknown[], create: [] as unknown[] };
  return {
    calls,
    find: async (orgId, key) => {
      calls.find.push({ orgId, key });
      return overrides.find ? overrides.find(orgId, key) : null;
    },
    create: async (row) => {
      calls.create.push(row);
      return overrides.create ? overrides.create(row) : { won: true };
    },
  };
}

function fakeOrgs(orgId: string | null = ORG): OrgContextService {
  return {
    requireOrgId: () => {
      if (!orgId) throw new Error('No tenant resolved for this request');
      return orgId;
    },
  } as unknown as OrgContextService;
}

function fakeResponse(): { statusCode: number; status: (code: number) => unknown } {
  const res = {
    statusCode: 200,
    status(code: number) { res.statusCode = code; return res; },
  };
  return res;
}

function makeContext(req: Record<string, unknown>, res: ReturnType<typeof fakeResponse>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

function handlerReturning(body: unknown, status = 200): { handler: CallHandler; res: ReturnType<typeof fakeResponse> } {
  const res = fakeResponse();
  res.statusCode = status;
  return { handler: { handle: () => of(body) } as CallHandler, res };
}

function handlerThrowing(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) } as CallHandler;
}

describe('IdempotencyInterceptor', () => {
  it('no Idempotency-Key header: passes straight through, never touches the store', async () => {
    const store = fakeStore();
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
    const { handler, res } = handlerReturning({ ok: true }, 201);
    const req = { method: 'POST', path: '/issues', headers: {}, body: { a: 1 } };

    const result = await interceptor.intercept(makeContext(req, res), handler);
    await expect(firstValue(result)).resolves.toEqual({ ok: true });
    expect(store.calls.find).toHaveLength(0);
    expect(store.calls.create).toHaveLength(0);
  });

  it('miss: runs the handler and stores the response', async () => {
    const store = fakeStore();
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
    const { handler, res } = handlerReturning({ issueId: 'L1' }, 201);
    const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };

    const result = await interceptor.intercept(makeContext(req, res), handler);
    await expect(firstValue(result)).resolves.toEqual({ issueId: 'L1' });
    expect(store.calls.create).toHaveLength(1);
    const stored = store.calls.create[0] as { orgId: string; key: string; responseStatus: number; responseBody: unknown };
    expect(stored.orgId).toBe(ORG);
    expect(stored.key).toBe('key-1');
    expect(stored.responseStatus).toBe(201);
    expect(stored.responseBody).toEqual({ issueId: 'L1' });
  });

  it('hit, same requestHash: replays the stored response without running the handler', async () => {
    const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
    const requestHash = hashRequest(req.method, concreteRequestPath(req as never), req.body);
    const store = fakeStore({
      find: async () => ({ requestHash, responseStatus: 201, responseBody: { issueId: 'L1' } }),
    });
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
    let handlerRan = false;
    const handler: CallHandler = { handle: () => { handlerRan = true; return of('should not run'); } };
    const res = fakeResponse();

    const result = await interceptor.intercept(makeContext(req, res), handler);
    await expect(firstValue(result)).resolves.toEqual({ issueId: 'L1' });
    expect(handlerRan).toBe(false);
    expect(res.statusCode).toBe(201);
    expect(store.calls.create).toHaveLength(0);
  });

  it('hit, different requestHash: throws 409 without running the handler', async () => {
    const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
    const store = fakeStore({
      find: async () => ({ requestHash: 'a-different-hash', responseStatus: 201, responseBody: { issueId: 'L1' } }),
    });
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
    let handlerRan = false;
    const handler: CallHandler = { handle: () => { handlerRan = true; return of('should not run'); } };

    await expect(interceptor.intercept(makeContext(req, fakeResponse()), handler)).rejects.toThrow(ConflictException);
    expect(handlerRan).toBe(false);
  });

  describe('decision 1: which statuses get cached', () => {
    it('does not store a response when the handler throws a 500-class error', async () => {
      const store = fakeStore();
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
      const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: {} };

      await expect(
        interceptor.intercept(makeContext(req, fakeResponse()), handlerThrowing(new Error('db exploded'))),
      ).rejects.toThrow('db exploded');
      expect(store.calls.create).toHaveLength(0);
    });

    it('stores a response when the handler throws a 4xx error, so a replay does not re-run it', async () => {
      const store = fakeStore();
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
      const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: {} };

      await expect(
        interceptor.intercept(makeContext(req, fakeResponse()), handlerThrowing(new BadRequestException('bad body'))),
      ).rejects.toThrow(BadRequestException);
      expect(store.calls.create).toHaveLength(1);
      const stored = store.calls.create[0] as { responseStatus: number };
      expect(stored.responseStatus).toBe(400);
    });
  });

  describe('decision 2: concurrent duplicates racing store.create', () => {
    it('same requestHash lost the race: returns the winner\'s stored response, not a crash', async () => {
      const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
      const requestHash = hashRequest(req.method, concreteRequestPath(req as never), req.body);
      const winner: IdempotencyRecord = { requestHash, responseStatus: 201, responseBody: { issueId: 'WINNER' } };
      const store = fakeStore({ create: async (): Promise<CreateResult> => ({ won: false, existing: winner }) });
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
      const { handler, res } = handlerReturning({ issueId: 'LOSER' }, 201);

      const result = await interceptor.intercept(makeContext(req, res), handler);
      await expect(firstValue(result)).resolves.toEqual({ issueId: 'WINNER' });
    });

    it('different requestHash lost the race: throws 409 instead of silently returning the wrong body', async () => {
      const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
      const winner: IdempotencyRecord = { requestHash: 'not-mine', responseStatus: 201, responseBody: { issueId: 'OTHER' } };
      const store = fakeStore({ create: async (): Promise<CreateResult> => ({ won: false, existing: winner }) });
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
      const { handler, res } = handlerReturning({ issueId: 'MINE' }, 201);

      await expect(interceptor.intercept(makeContext(req, res), handler)).rejects.toThrow(ConflictException);
    });
  });

  it('throws (via requireOrgId) when the header is present but no tenant has been resolved', async () => {
    const store = fakeStore();
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs(null));
    const req = { method: 'POST', path: '/issues', headers: { 'idempotency-key': 'key-1' }, body: {} };
    const { handler, res } = handlerReturning({}, 201);

    await expect(interceptor.intercept(makeContext(req, res), handler)).rejects.toThrow('No tenant resolved');
  });

  describe('requestHash uses the concrete request URL, not the route pattern (Group B, finding 2)', () => {
    // Production shape: Express has matched the route by the time this
    // interceptor runs, so req.route.path is the *pattern* ('/issues/:id'),
    // req.params reservations the matched segment, and req.originalUrl is the real
    // request target. The old bug used req.route?.path for hashing, so
    // POST /issues/1 and POST /issues/2 — two different resources — with the
    // same Idempotency-Key and the same body hashed identically.
    function productionShapeRequest(id: string, key = 'key-1') {
      return {
        method: 'POST',
        path: `/issues/${id}`,
        originalUrl: `/issues/${id}`,
        route: { path: '/issues/:id' },
        params: { id },
        headers: { 'idempotency-key': key },
        body: { action: 'return' }, // deliberately identical across both requests
      };
    }

    // A real in-memory store (not a single canned `find` response) so both
    // requests go through the interceptor's own hashing end to end — the
    // second request's outcome depends entirely on what the interceptor
    // itself computed and stored for the first, exactly like the real
    // PrismaIdempotencyStore keyed by (orgId, key). A test that instead
    // hand-computes the "expected" hash independently would only prove the
    // test's own math, not the interceptor's behaviour.
    function statefulStore(): IdempotencyStore {
      const records = new Map<string, IdempotencyRecord>();
      return {
        find: async (orgId, key) => records.get(`${orgId}:${key}`) ?? null,
        create: async (row) => {
          const mapKey = `${row.orgId}:${row.key}`;
          const existing = records.get(mapKey);
          if (existing) return { won: false, existing };
          records.set(mapKey, {
            requestHash: row.requestHash,
            responseStatus: row.responseStatus,
            responseBody: row.responseBody,
          });
          return { won: true };
        },
      };
    }

    it('two different concrete paths under the same route pattern + key: second request gets 409, not the first resource\'s response replayed', async () => {
      const store = statefulStore();
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());

      const first = productionShapeRequest('1');
      const { handler: handler1, res: res1 } = handlerReturning({ issueId: '1' }, 200);
      const result1 = await interceptor.intercept(makeContext(first, res1), handler1);
      await expect(firstValue(result1)).resolves.toEqual({ issueId: '1' });

      // Same Idempotency-Key, same route pattern, same body — only the
      // concrete resource id differs. Bug (pre-fix): hashing the route
      // pattern instead of the concrete URL made this indistinguishable
      // from a retry of the FIRST request, so it would silently resolve to
      // { issueId: '1' } — the wrong resource's response — for a POST to
      // /issues/2, without ever running its own handler or surfacing an
      // error to the caller.
      const second = productionShapeRequest('2');
      let handler2Ran = false;
      const handler2: CallHandler = { handle: () => { handler2Ran = true; return of({ issueId: '2' }); } };

      await expect(
        interceptor.intercept(makeContext(second, fakeResponse()), handler2),
      ).rejects.toThrow(ConflictException);
      expect(handler2Ran).toBe(false);
    });

    it('sanity check: a genuine retry of the same concrete path still replays cleanly, end to end', async () => {
      const store = statefulStore();
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());

      const req = productionShapeRequest('1');
      const { handler: firstHandler, res: firstRes } = handlerReturning({ issueId: '1' }, 200);
      await interceptor.intercept(makeContext(req, firstRes), firstHandler);

      let retryHandlerRan = false;
      const retryHandler: CallHandler = { handle: () => { retryHandlerRan = true; return of('should not run'); } };
      const retryRes = fakeResponse();
      const result = await interceptor.intercept(makeContext(productionShapeRequest('1'), retryRes), retryHandler);

      await expect(firstValue(result)).resolves.toEqual({ issueId: '1' });
      expect(retryHandlerRan).toBe(false);
      expect(retryRes.statusCode).toBe(200);
    });
  });
});

function firstValue<T>(obs: unknown): Promise<T> {
  return firstValueFrom(obs as Observable<T>);
}
