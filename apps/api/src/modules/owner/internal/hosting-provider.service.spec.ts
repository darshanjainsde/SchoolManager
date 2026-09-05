import { HostingProviderService } from './hosting-provider.service';

/**
 * A school hands us stmarys.edu.in; their registrar almost always has a `www`
 * record pointing at it too. Attaching only the apex leaves www.stmarys.edu.in
 * reaching us and answering 404 — a dead address on the school's letterhead
 * that nobody finds until a parent types it. This pins that both are claimed,
 * and that the www one is a redirect rather than a second live copy.
 */
describe('HostingProviderService.attach', () => {
  function svc(responder: (path: string, body: unknown) => { ok: boolean; status?: number }) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const s = new HostingProviderService();
    (s as unknown as { env: Record<string, string> }).env = {
      VERCEL_TOKEN: 't', VERCEL_PROJECT_ID: 'prj', VERCEL_TEAM_ID: 'team',
    };
    (s as unknown as { call: unknown }).call = async (path: string, init: { body?: unknown }) => {
      calls.push({ path, body: (init.body ?? {}) as Record<string, unknown> });
      const r = responder(path, init.body);
      return r.ok ? { ok: true, data: {} } : { ok: false, status: r.status ?? 500, code: 'x', message: 'nope' };
    };
    return { s, calls };
  }

  it('claims the apex and the www alias', async () => {
    const { s, calls } = svc(() => ({ ok: true }));
    await s.attach('stmarys.edu.in');
    const names = calls.map((c) => c.body.name);
    expect(names).toEqual(['stmarys.edu.in', 'www.stmarys.edu.in']);
  });

  it('registers www as a redirect to the apex, not a second site', async () => {
    const { s, calls } = svc(() => ({ ok: true }));
    await s.attach('stmarys.edu.in');
    const www = calls.find((c) => c.body.name === 'www.stmarys.edu.in')!;
    expect(www.body.redirect).toBe('stmarys.edu.in');
    expect(www.body.redirectStatusCode).toBe(308);
    const apex = calls.find((c) => c.body.name === 'stmarys.edu.in')!;
    expect(apex.body.redirect).toBeUndefined();
  });

  it('does not prefix www onto a hostname that already has it', async () => {
    const { s, calls } = svc(() => ({ ok: true }));
    await s.attach('www.stmarys.edu.in');
    expect(calls.map((c) => c.body.name)).toEqual(['www.stmarys.edu.in']);
  });

  // The alias is a courtesy. Failing the whole add because it could not be
  // claimed would block a school whose apex is perfectly fine.
  it('still succeeds when only the www alias fails', async () => {
    const { s } = svc((_p, body) => ({
      ok: !String((body as { name: string }).name).startsWith('www.'),
      status: 409,
    }));
    await expect(s.attach('stmarys.edu.in')).resolves.toMatchObject({ ok: true });
  });

  it('reports failure when the apex itself fails', async () => {
    const { s } = svc(() => ({ ok: false, status: 403 }));
    await expect(s.attach('stmarys.edu.in')).resolves.toMatchObject({ ok: false });
  });

  it('does nothing at all without credentials', async () => {
    const s = new HostingProviderService();
    (s as unknown as { env: Record<string, string> }).env = {};
    const r = await s.attach('stmarys.edu.in');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('by hand');
  });
});
