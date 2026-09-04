import { of, throwError, lastValueFrom } from 'rxjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OwnerCacheInterceptor } from './owner-cache.interceptor';
import type { OwnerOverviewService } from './owner-overview.service';

function ctx(method: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ method }) }),
  } as unknown as Parameters<OwnerCacheInterceptor['intercept']>[0];
}

describe('OwnerCacheInterceptor', () => {
  let invalidated: number;
  let interceptor: OwnerCacheInterceptor;

  beforeEach(() => {
    invalidated = 0;
    const overview = {
      invalidate: async () => {
        invalidated += 1;
      },
    } as unknown as OwnerOverviewService;
    interceptor = new OwnerCacheInterceptor(overview);
  });

  const handler = (value: unknown = { ok: true }) => ({ handle: () => of(value) });

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    'drops the dashboard cache after a %s',
    async (method) => {
      await lastValueFrom(await interceptor.intercept(ctx(method), handler()));
      expect(invalidated).toBe(1);
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS'])('leaves it alone on a %s', async (method) => {
    await lastValueFrom(await interceptor.intercept(ctx(method), handler()));
    expect(invalidated).toBe(0);
  });

  it('does not invalidate when the write itself failed', async () => {
    const failing = { handle: () => throwError(() => new Error('constraint violation')) };
    await expect(lastValueFrom(await interceptor.intercept(ctx('POST'), failing))).rejects.toThrow();
    expect(invalidated).toBe(0);
  });

  it('still returns the handler result untouched', async () => {
    const body = { id: 'abc', slug: 'sample' };
    const out = await lastValueFrom(await interceptor.intercept(ctx('POST'), handler(body)));
    expect(out).toBe(body);
  });
});

/**
 * The interceptor is only worth anything if it is actually attached. A future
 * refactor that drops the decorator would restore the stale-dashboard bug
 * silently — every test above would still pass.
 */
describe('the owner controller', () => {
  it('applies the cache interceptor, so new endpoints inherit it', () => {
    const src = readFileSync(join(__dirname, 'owner.controller.ts'), 'utf8');
    expect(src).toMatch(/@UseInterceptors\(\s*OwnerCacheInterceptor\s*\)/);
  });
});
