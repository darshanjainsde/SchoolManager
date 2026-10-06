import { lastValueFrom, of } from 'rxjs';
import { InvocationClockInterceptor, invocationStartedAt, runInvocation } from './invocation-clock';

const httpCtx = (req: unknown) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => req }) }) as never;

describe('invocation clock', () => {
  it('is empty outside a request and set inside one', () => {
    expect(invocationStartedAt()).toBeUndefined();
    expect(runInvocation(() => invocationStartedAt(), 123)).toBe(123);
  });

  it('the interceptor starts the clock at the stamp server.ts put on the request — cold start included', async () => {
    const next = { handle: () => of(invocationStartedAt()) };
    const seen = await lastValueFrom(new InvocationClockInterceptor().intercept(httpCtx({ skInvokedAt: 42 }), next));
    expect(seen).toBe(42);
  });

  it('with no stamp (local dev) it starts the clock when the request reaches Nest', async () => {
    const before = Date.now();
    const next = { handle: () => of(invocationStartedAt()) };
    const seen = (await lastValueFrom(new InvocationClockInterceptor().intercept(httpCtx({}), next))) as number;
    expect(seen).toBeGreaterThanOrEqual(before);
  });
});
