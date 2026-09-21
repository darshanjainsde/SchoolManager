import { ForbiddenException } from '@nestjs/common';

jest.mock('@skoolos/config', () => ({
  loadEnv: () => ({
    NODE_ENV: 'test',
    PLATFORM_HOST: 'sckools.com',
    COOKIE_DOMAIN: undefined,
    JWT_REFRESH_TTL: 3600,
  }),
}));

import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';
import type { FeatureResolverService } from '../../features';
import type { TenantContextService } from '../../tenancy';

/**
 * POST /auth/refresh answers "who am I?" in the same response.
 *
 * Every console layout booted with refresh -> /auth/me -> the page's own
 * queries, serially, and rendered nothing until the first two came back. The
 * two calls are now one. Two things have to hold for that to be safe:
 *
 *   - the payload must be IDENTICAL to what GET /auth/me returns, or a console
 *     reading `features` off one and `role` off the other shows one set of menu
 *     items and enforces another;
 *   - `identity` is an internal hand-off from the service and must never reach
 *     the response body.
 *
 * Additive by design: nothing existing changed shape, which is what lets
 * apps/mobile keep its two-call boot until it is changed on purpose.
 */
const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const IDENTITY = { sub: 'user-1', schoolId: SCHOOL, role: 'SCHOOL_ADMIN' as const };

function build() {
  const auth = {
    refresh: jest.fn().mockResolvedValue({
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresIn: 900,
      identity: IDENTITY,
    }),
    displayNameFor: jest.fn().mockResolvedValue('Dr Aadhya Venkataraghavan'),
    staffRoleFor: jest.fn().mockResolvedValue(null),
  } as unknown as AuthService;

  const features = {
    getFeatures: jest.fn().mockResolvedValue(new Set(['GALLERY', 'FEES'])),
  } as unknown as FeatureResolverService;

  const tenantCtx = {
    requireTenant: () => ({ schoolId: SCHOOL, schoolSlug: 'raffles' }),
  } as unknown as TenantContextService;

  const controller = new AuthController(
    auth,
    {} as never,
    tenantCtx,
    features,
    {} as never,
    {} as never,
  );
  return { controller, auth, features };
}

const res = () => ({ cookie: jest.fn(), clearCookie: jest.fn() }) as never;
/** Origin present = a browser, so the body copy of the refresh token is stripped. */
const req = () => ({ headers: { origin: 'https://raffles.sckools.com' }, cookies: {} }) as never;
/** The token arrives in the body here; the cookie path is covered elsewhere. */
const body = (refreshToken?: string) => ({ refreshToken }) as never;

describe('POST /auth/refresh carries the me payload', () => {
  it('returns the same body GET /auth/me would have returned', async () => {
    const { controller } = build();
    const refreshed = (await controller.refresh(
      req(),
      body('old-refresh'),
      res(),
    )) as Record<string, unknown>;

    const direct = await controller.me(IDENTITY as never);

    expect(refreshed.me).toEqual(direct);
    expect(refreshed.me).toEqual({
      userId: 'user-1',
      schoolId: SCHOOL,
      role: 'SCHOOL_ADMIN',
      name: 'Dr Aadhya Venkataraghavan',
      staffRole: null,
      features: ['GALLERY', 'FEES'],
    });
  });

  it('still returns the access token, and never the internal identity', async () => {
    const { controller } = build();
    const out = (await controller.refresh(
      req(),
      body('old-refresh'),
      res(),
    )) as Record<string, unknown>;

    expect(out.accessToken).toBe('new-access');
    expect(out.expiresIn).toBe(900);
    expect(out).not.toHaveProperty('identity');
    // A browser (it sent Origin) gets the cookie, not a body copy.
    expect(out).not.toHaveProperty('refreshToken');
  });

  it('a request with no refresh token anywhere is still refused', async () => {
    const { controller } = build();
    await expect(
      controller.refresh(req(), body(undefined), res()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
