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

async function load(ownerHost: string, isLocal: boolean) {
  vi.resetModules();
  vi.doMock('@/lib/hosts', () => ({ OWNER_HOST: ownerHost, IS_LOCAL: isLocal }));
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

  it('are NOT served on the marketing apex either', async () => {
    const mw = await load(OWNER, false);
    expect(mw(req('test.sckools.com', '/platform')).status).toBe(404);
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
