// @vitest-environment node
//
// The CDN may hold a page only if that page is the same for everybody.
//
// Every public URL answered `x-vercel-cache: MISS` because dynamic routes are
// served `private, no-store` — so the fix is a Cache-Control header on the
// pages whose output depends on the host and nothing else. The failure mode if
// that list is ever wrong is not a slow page, it is one visitor being served
// another's session HTML from the edge, so the boundary gets a test rather
// than a comment.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER = 'owner.test.sckools.com';
const PLATFORM = 'test.sckools.com';
const SCHOOL = 'raffles.test.sckools.com';

async function load() {
  vi.resetModules();
  vi.doMock('@/lib/hosts', () => ({
    OWNER_HOST: OWNER,
    PLATFORM_HOST: PLATFORM,
    IS_LOCAL: false,
    isPlatformHost: (h?: string) =>
      !!h && [PLATFORM, OWNER].includes(h.split(':')[0].toLowerCase()),
  }));
  return (await import('./../middleware')).middleware;
}

function req(host: string, pathname: string, method = 'GET') {
  return {
    method,
    headers: new Headers({ host }),
    nextUrl: { pathname },
  } as unknown as Parameters<Awaited<ReturnType<typeof load>>>[0];
}

const cc = (r: { headers: Headers }) => r.headers.get('Cache-Control');

beforeEach(() => vi.resetModules());

describe('pages the edge may hold', () => {
  it('caches a school public site', async () => {
    const mw = await load();
    for (const p of ['/', '/academics', '/admissions', '/gallery', '/contact', '/connect']) {
      expect(cc(mw(req(SCHOOL, p))), p).toMatch(/^public, s-maxage=\d+/);
    }
  });

  it('caches school blog and custom pages under their prefixes', async () => {
    const mw = await load();
    for (const p of ['/blog', '/blog/sports-day', '/p/about-us', '/overview/academics']) {
      expect(cc(mw(req(SCHOOL, p))), p).toMatch(/^public, s-maxage=\d+/);
    }
  });

  it('caches the marketing pages on the platform apex', async () => {
    const mw = await load();
    for (const p of ['/pricing', '/privacy', '/terms', '/school-website-builder']) {
      expect(cc(mw(req(PLATFORM, p))), p).toMatch(/^public, s-maxage=\d+/);
    }
  });
});

describe('pages the edge must never hold', () => {
  // Each of these can carry a signed-in person's HTML. A shared cache entry
  // here hands one visitor another's page.
  it.each([
    '/login', '/account/password', '/accept-invite', '/reset-password', '/forgot-password',
    '/app', '/app/students', '/app/fees',
    '/portal', '/portal/fees', '/teacher', '/teacher/results',
    '/staff', '/library/books', '/alumni', '/platform', '/platform/schools', '/owner',
  ])('never caches %s', async (path) => {
    const mw = await load();
    expect(cc(mw(req(SCHOOL, path)))).toBeNull();
  });

  it('never caches a non-GET request', async () => {
    const mw = await load();
    for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      expect(cc(mw(req(SCHOOL, '/', m))), m).toBeNull();
    }
  });

  // The apex serves marketing, not a school. Caching a tenant path there would
  // put a school's page under the platform's own hostname.
  it('does not cache tenant-only paths on the platform apex', async () => {
    const mw = await load();
    for (const p of ['/academics', '/admissions', '/gallery', '/contact']) {
      expect(cc(mw(req(PLATFORM, p))), p).toBeNull();
    }
  });

  it('does not cache anything on the owner host', async () => {
    const mw = await load();
    for (const p of ['/', '/pricing', '/platform']) {
      expect(cc(mw(req(OWNER, p))), p).toBeNull();
    }
  });
});
