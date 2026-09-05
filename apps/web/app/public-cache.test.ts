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
    url: `https://${host}${pathname}`,
  } as unknown as Parameters<Awaited<ReturnType<typeof load>>>[0];
}

/** Where middleware sent the request internally, or null if it passed through. */
const rewrittenTo = (r: { headers: Headers }) => r.headers.get('x-middleware-rewrite');

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


describe('host-routed school pages', () => {
  // The visitor's URL never changes; only the internal path does. This is what
  // lets the response be cached at all — see the middleware comment.
  it.each(['/', '/academics', '/admissions', '/gallery', '/contact', '/connect', '/p/transport'])(
    'rewrites a school host at %s to its own path',
    async (path) => {
      const mw = await load();
      const to = rewrittenTo(mw(req(SCHOOL, path)));
      expect(to).toContain(`/s/${encodeURIComponent(SCHOOL)}`);
      if (path !== '/') expect(to).toContain(path);
    },
  );

  // The apex serves marketing. A school view rewritten there would put one
  // school's pages under the platform's own name.
  it.each(['/academics', '/admissions', '/gallery', '/contact', '/connect', '/p/transport'])(
    'never rewrites %s on the platform apex',
    async (path) => {
      const mw = await load();
      expect(rewrittenTo(mw(req(PLATFORM, path)))).toBeNull();
    },
  );

  it('never rewrites a route that carries a session', async () => {
    const mw = await load();
    for (const p of ['/app', '/app/students', '/portal', '/teacher', '/login', '/platform']) {
      expect(rewrittenTo(mw(req(SCHOOL, p))), p).toBeNull();
    }
  });

  it('leaves the platform apex alone — it serves marketing, not a school', async () => {
    const mw = await load();
    expect(rewrittenTo(mw(req(PLATFORM, '/')))).toBeNull();
  });

  it('leaves the owner host alone', async () => {
    const mw = await load();
    expect(rewrittenTo(mw(req(OWNER, '/')))).toBeNull();
  });

  it('sends two different schools to two different paths', async () => {
    const mw = await load();
    const a = rewrittenTo(mw(req('alpha.test.sckools.com', '/')));
    const b = rewrittenTo(mw(req('beta.test.sckools.com', '/')));
    expect(a).not.toBe(b);
    expect(a).toContain('alpha.test.sckools.com');
    expect(b).toContain('beta.test.sckools.com');
  });
});

describe('the internal /s/ address', () => {
  // Typing another school's hostname into our own path must return nothing.
  // The rewrite above is the ONLY way this route is ever reached.
  it.each([SCHOOL, PLATFORM, OWNER, 'archaiccandles.com'])(
    'is 404 when asked for directly on %s',
    async (host) => {
      const mw = await load();
      for (const p of ['/s', '/s/', '/s/other.sckools.com', '/s/archaiccandles.com/academics']) {
        expect(mw(req(host, p)).status, `${host}${p}`).toBe(404);
      }
    },
  );

  it('is not cacheable either', async () => {
    const mw = await load();
    expect(cc(mw(req(SCHOOL, '/s/other.sckools.com')))).toBeNull();
  });
});
