import { BadRequestException, ConflictException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of, throwError, type Observable } from 'rxjs';
import { IdempotencyInterceptor, hashRequest, type CreateResult, type IdempotencyRecord, type IdempotencyStore } from './idempotency.interceptor';
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
    const req = { method: 'POST', path: '/loans', headers: {}, body: { a: 1 } };

    const result = await interceptor.intercept(makeContext(req, res), handler);
    await expect(firstValue(result)).resolves.toEqual({ ok: true });
    expect(store.calls.find).toHaveLength(0);
    expect(store.calls.create).toHaveLength(0);
  });

  it('miss: runs the handler and stores the response', async () => {
    const store = fakeStore();
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
    const { handler, res } = handlerReturning({ loanId: 'L1' }, 201);
    const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };

    const result = await interceptor.intercept(makeContext(req, res), handler);
    await expect(firstValue(result)).resolves.toEqual({ loanId: 'L1' });
    expect(store.calls.create).toHaveLength(1);
    const stored = store.calls.create[0] as { orgId: string; key: string; responseStatus: number; responseBody: unknown };
    expect(stored.orgId).toBe(ORG);
    expect(stored.key).toBe('key-1');
    expect(stored.responseStatus).toBe(201);
    expect(stored.responseBody).toEqual({ loanId: 'L1' });
  });

  it('hit, same requestHash: replays the stored response without running the handler', async () => {
    const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
    const requestHash = hashRequest(req.method, `${req.method} ${req.path}`, req.body);
    const store = fakeStore({
      find: async () => ({ requestHash, responseStatus: 201, responseBody: { loanId: 'L1' } }),
    });
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
    let handlerRan = false;
    const handler: CallHandler = { handle: () => { handlerRan = true; return of('should not run'); } };
    const res = fakeResponse();

    const result = await interceptor.intercept(makeContext(req, res), handler);
    await expect(firstValue(result)).resolves.toEqual({ loanId: 'L1' });
    expect(handlerRan).toBe(false);
    expect(res.statusCode).toBe(201);
    expect(store.calls.create).toHaveLength(0);
  });

  it('hit, different requestHash: throws 409 without running the handler', async () => {
    const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
    const store = fakeStore({
      find: async () => ({ requestHash: 'a-different-hash', responseStatus: 201, responseBody: { loanId: 'L1' } }),
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
      const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: {} };

      await expect(
        interceptor.intercept(makeContext(req, fakeResponse()), handlerThrowing(new Error('db exploded'))),
      ).rejects.toThrow('db exploded');
      expect(store.calls.create).toHaveLength(0);
    });

    it('stores a response when the handler throws a 4xx error, so a replay does not re-run it', async () => {
      const store = fakeStore();
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
      const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: {} };

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
      const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
      const requestHash = hashRequest(req.method, `${req.method} ${req.path}`, req.body);
      const winner: IdempotencyRecord = { requestHash, responseStatus: 201, responseBody: { loanId: 'WINNER' } };
      const store = fakeStore({ create: async (): Promise<CreateResult> => ({ won: false, existing: winner }) });
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
      const { handler, res } = handlerReturning({ loanId: 'LOSER' }, 201);

      const result = await interceptor.intercept(makeContext(req, res), handler);
      await expect(firstValue(result)).resolves.toEqual({ loanId: 'WINNER' });
    });

    it('different requestHash lost the race: throws 409 instead of silently returning the wrong body', async () => {
      const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: { memberId: 'M1' } };
      const winner: IdempotencyRecord = { requestHash: 'not-mine', responseStatus: 201, responseBody: { loanId: 'OTHER' } };
      const store = fakeStore({ create: async (): Promise<CreateResult> => ({ won: false, existing: winner }) });
      const interceptor = new IdempotencyInterceptor(store, fakeOrgs());
      const { handler, res } = handlerReturning({ loanId: 'MINE' }, 201);

      await expect(interceptor.intercept(makeContext(req, res), handler)).rejects.toThrow(ConflictException);
    });
  });

  it('throws (via requireOrgId) when the header is present but no tenant has been resolved', async () => {
    const store = fakeStore();
    const interceptor = new IdempotencyInterceptor(store, fakeOrgs(null));
    const req = { method: 'POST', path: '/loans', headers: { 'idempotency-key': 'key-1' }, body: {} };
    const { handler, res } = handlerReturning({}, 201);

    await expect(interceptor.intercept(makeContext(req, res), handler)).rejects.toThrow('No tenant resolved');
  });
});

function firstValue<T>(obs: unknown): Promise<T> {
  return firstValueFrom(obs as Observable<T>);
}
