// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMOTER_TOKEN_KEY, PromoterApiError, getPromoterToken, promoterApi, promoterFetch, setPromoterToken, stageTone, rupees } from './promoter-session';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('promoter session', () => {
  beforeEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('keeps the token in localStorage under the key the CSP guard knows, and clears it', () => {
    setPromoterToken('t1');
    expect(window.localStorage.getItem(PROMOTER_TOKEN_KEY)).toBe('t1');
    expect(getPromoterToken()).toBe('t1');
    setPromoterToken(null);
    expect(getPromoterToken()).toBeNull();
  });

  it('sends the bearer token and the host on a signed-in call, and nothing on the public doors', async () => {
    setPromoterToken('t1');
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(json(200, { ok: true })));
    vi.stubGlobal('fetch', fetchMock);
    await promoterApi.get('/promoter/me');
    const [, init] = fetchMock.mock.calls[0];
    const h = new Headers(init.headers);
    expect(h.get('Authorization')).toBe('Bearer t1');
    expect(h.get('X-Skoolos-Host')).toBe(window.location.host);
    await promoterApi.public.post('/promoter/auth/start', { channel: 'email', email: 'x@y.in' });
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBeNull();
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Content-Type')).toBe('application/json');
  });

  it('turns the API error envelope into a typed error the forms can place on a field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(json(400, { code: 'VALIDATION', message: 'Tick the consent line.', field: 'consent' }))));
    await expect(promoterApi.post('/promoter/referrals', {})).rejects.toMatchObject({ status: 400, code: 'VALIDATION', field: 'consent', message: 'Tick the consent line.' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { message: ['schoolName must be longer', 'other'] })));
    await expect(promoterApi.post('/promoter/referrals', {})).rejects.toMatchObject({ message: 'schoolName must be longer' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    const e = (await promoterApi.post('/promoter/auth/start', {}).catch((x: unknown) => x)) as PromoterApiError;
    expect(e).toBeInstanceOf(PromoterApiError);
    expect(e.message).toMatch(/Too many tries/);
  });

  it('a 401 on a signed-in call drops the token', async () => {
    setPromoterToken('stale');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { message: 'Signed out. Sign in again.' })));
    await expect(promoterFetch('/promoter/me')).rejects.toMatchObject({ status: 401 });
    expect(getPromoterToken()).toBeNull();
  });

  it('stage tones and rupees', () => {
    expect(stageTone('PAID')).toBe('good');
    expect(stageTone('REJECTED')).toBe('bad');
    expect(stageTone('LOGGED')).toBe('warn');
    expect(stageTone('DEMO_DONE')).toBe('info');
    expect(rupees(12_49_500_00)).toBe('₹12,49,500');
    expect(rupees(0)).toBe('₹0');
  });
});
