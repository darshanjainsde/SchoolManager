import type { ExecutionContext } from '@nestjs/common';
import { CronSecretGuard } from './cron-secret.guard';
import { ApiError } from '../../common/errors/api-error';

function ctxWithHeaders(headers: Record<string, string | undefined>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

describe('CronSecretGuard', () => {
  const guard = new CronSecretGuard();
  const ORIGINAL_ENV = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_ENV;
  });

  it('allows the request when x-cron-secret matches CRON_SECRET', () => {
    process.env.CRON_SECRET = 'super-secret';
    const ctx = ctxWithHeaders({ 'x-cron-secret': 'super-secret' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('allows the request when Authorization: Bearer <CRON_SECRET> matches (Vercel Cron native auth)', () => {
    process.env.CRON_SECRET = 'super-secret';
    const ctx = ctxWithHeaders({ authorization: 'Bearer super-secret' });

    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('rejects with a 401 ApiError when the x-cron-secret header is wrong', () => {
    process.env.CRON_SECRET = 'super-secret';
    const ctx = ctxWithHeaders({ 'x-cron-secret': 'wrong' });

    expect(() => guard.canActivate(ctx)).toThrow(ApiError);
    try {
      guard.canActivate(ctx);
    } catch (e) {
      expect((e as ApiError).getStatus()).toBe(401);
    }
  });

  it('reports an auth failure as UNAUTHORIZED, not as a feature-gating code', () => {
    process.env.CRON_SECRET = 'super-secret';
    const ctx = ctxWithHeaders({ 'x-cron-secret': 'wrong' });

    try {
      guard.canActivate(ctx);
      throw new Error('expected the guard to reject');
    } catch (e) {
      expect((e as ApiError).getResponse()).toEqual({
        code: 'UNAUTHORIZED',
        message: expect.any(String),
      });
    }
  });

  it('rejects a same-length-but-different secret (constant-time comparison still compares)', () => {
    process.env.CRON_SECRET = 'super-secret';
    const ctx = ctxWithHeaders({ 'x-cron-secret': 'super-secreT' });

    expect(() => guard.canActivate(ctx)).toThrow(ApiError);
  });

  it('rejects a prefix of the real secret rather than throwing on the length mismatch', () => {
    process.env.CRON_SECRET = 'super-secret';
    const ctx = ctxWithHeaders({ 'x-cron-secret': 'super' });

    expect(() => guard.canActivate(ctx)).toThrow(ApiError);
  });

  it('fails closed when CRON_SECRET is set but empty', () => {
    process.env.CRON_SECRET = '';
    const ctx = ctxWithHeaders({ 'x-cron-secret': '' });

    expect(() => guard.canActivate(ctx)).toThrow(ApiError);
  });

  it('rejects with a 401 ApiError when the header is missing entirely', () => {
    process.env.CRON_SECRET = 'super-secret';
    const ctx = ctxWithHeaders({});

    expect(() => guard.canActivate(ctx)).toThrow(ApiError);
  });

  it('fails closed (rejects) when CRON_SECRET is not set in the environment, even if a header is sent', () => {
    delete process.env.CRON_SECRET;
    const ctx = ctxWithHeaders({ 'x-cron-secret': 'anything' });

    expect(() => guard.canActivate(ctx)).toThrow(ApiError);
  });
});
