// @vitest-environment node
//
// The owner console must not be served on a school's own domain.
//
// A school that points archaiccandles.com at us is buying THEIR site on THEIR
// name. Our operator console answering at archaiccandles.com/platform is our
// surface on their brand: it advertises that the console exists and where, and
// it invites credential-stuffing from an origin nobody is watching. The API
// still refuses the data without a platform token — this is the layer that
// stops the shell being handed out in the first place.
//
// Verified broken before this gate existed: GET
// https://sample-public.test.sckools.com/platform answered 200 with the Next
// app's assets.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OWNER = 'owner.test.sckools.com';
const APEX = 'test.sckools.com';

async function load(ownerHost: string, isLocal: boolean) {
  vi.resetModules();
  vi.doMock('@/lib/hosts', () => ({ OWNER_HOST: ownerHost, PLATFORM_HOST: APEX, IS_LOCAL: isLocal }));
  return (await import('./../middleware')).middleware;
}

function req(host: string, pathname: string) {
  return {
    headers: new Headers({ host }),
    nextUrl: { pathname },
  } as unknown as Parameters<Awaited<ReturnType<typeof load>>>[0];
}

beforeEach(() => vi.resetModules());

describe('owner-only routes', () => {
  it('are served on the owner host', async () => {
    const mw = await load(OWNER, false);
    for (const path of ['/platform', '/platform/schools', '/owner']) {
      expect(mw(req(OWNER, path)).status).not.toBe(404);
    }
  });

  it('serves /owner AND /platform on our own apex — the one-password door', async () => {
    // sckools.com/owner is the documented gate (app/owner/page.tsx), and
    // unlocking navigates to /platform, so both must answer on the apex or the
    // door opens onto nothing. Gating on OWNER_HOST alone 404'd it; that
    // reached production on 4 Sept 2026 and was found by someone signing in.
    const mw = await load(OWNER, false);
    for (const path of ['/owner', '/platform', '/platform/schools']) {
      expect(mw(req(APEX, path)).status).not.toBe(404);
    }
  });

  it('are NOT served on a school subdomain', async () => {
    const mw = await load(OWNER, false);
    expect(mw(req('sample-public.test.sckools.com', '/platform')).status).toBe(404);
  });

  it("are NOT served on a school's own custom domain", async () => {
    const mw = await load(OWNER, false);
    for (const path of ['/platform', '/platform/schools/abc', '/owner']) {
      expect(mw(req('archaiccandles.com', path)).status).toBe(404);
    }
  });

  // Deliberately reversed on 4 Sept 2026. The original assertion 404'd the
  // apex, which also killed sckools.com/owner — the one-password entry point
  // the product depends on. The gate's real target is a SCHOOL's domain, and
  // those two cases below still hold. The API is what actually protects the
  // data: OwnerHostGuard + PlatformJwtGuard on every platform route.
  it('serves owner routes on our own apex, but never on anyone else’s host', async () => {
    const mw = await load(OWNER, false);
    expect(mw(req(APEX, '/platform')).status).not.toBe(404);
    for (const host of ['archaiccandles.com', 'sample-public.test.sckools.com', 'beacon.test.sckools.com']) {
      expect(mw(req(host, '/platform')).status).toBe(404);
      expect(mw(req(host, '/owner')).status).toBe(404);
    }
  });

  it('ignores the port, so owner.localhost:3000 still works in dev', async () => {
    const mw = await load('owner.localhost', true);
    expect(mw(req('owner.localhost:3000', '/platform')).status).not.toBe(404);
    expect(mw(req('beacon.localhost:3000', '/platform')).status).toBe(404);
  });

  // A missing NEXT_PUBLIC_PLATFORM_OWNER_HOST must not 404 the operator's own
  // console with no way back in — the platform JWT is the control that matters.
  it('fails open when the build carries localhost defaults but serves a real host', async () => {
    const mw = await load('owner.localhost', true);
    expect(mw(req('owner.sckools.com', '/platform')).status).not.toBe(404);
  });
});

describe('everything else', () => {
  it('is untouched on a school domain', async () => {
    const mw = await load(OWNER, false);
    for (const path of ['/app/fees', '/login', '/portal', '/']) {
      expect(mw(req('archaiccandles.com', path)).status).not.toBe(404);
    }
  });

  it('still gets the console CSP', async () => {
    const mw = await load(OWNER, false);
    const csp = mw(req('archaiccandles.com', '/app/fees')).headers.get('Content-Security-Policy');
    expect(csp).toContain("object-src 'none'");
  });
});
