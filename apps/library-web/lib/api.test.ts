import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, apiFetch, login } from './api';

/**
 * These pin the two things that are silent when wrong: the tenant header
 * (omit it and every request 401s with no clue why) and the error message
 * extraction (get it wrong and a validation failure renders as a bare
 * "400 Bad Request" with the actual field problem discarded).
 */
describe('apiFetch', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function reply(status: number, body: unknown, ok = status < 400) {
    fetchMock.mockResolvedValue({
      ok,
      status,
      statusText: 'Test',
      text: async () => (body === undefined ? '' : JSON.stringify(body)),
    });
  }

  it('always sends X-Library-Host — the API resolves the tenant from it, not the URL', async () => {
    reply(200, { ok: true });
    await apiFetch('/anything', { host: 'raffles.library.trackyour.in' });
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('X-Library-Host')).toBe('raffles.library.trackyour.in');
  });

  it('sends the bearer token only when there is one', async () => {
    reply(200, {});
    await apiFetch('/x', { host: 'h' });
    expect((fetchMock.mock.calls[0][1].headers as Headers).get('authorization')).toBeNull();

    reply(200, {});
    await apiFetch('/x', { host: 'h', token: 'abc' });
    expect((fetchMock.mock.calls[1][1].headers as Headers).get('authorization')).toBe('Bearer abc');
  });

  it('forwards an idempotency key when given, so a retried write is not applied twice', async () => {
    reply(200, {});
    await apiFetch('/circulation/issue', { host: 'h', method: 'POST', idempotencyKey: 'k-1' });
    expect((fetchMock.mock.calls[0][1].headers as Headers).get('idempotency-key')).toBe('k-1');
  });

  it('surfaces the API message rather than the bare status text', async () => {
    reply(401, { message: 'Invalid credentials' }, false);
    await expect(apiFetch('/auth/login', { host: 'h' })).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
    });
  });

  it('joins a ValidationPipe message array instead of rendering [object Object]', async () => {
    reply(400, { message: ['title is required', 'isbn must be 10 or 13 characters'] }, false);
    await expect(apiFetch('/catalog/titles', { host: 'h' })).rejects.toMatchObject({
      message: 'title is required, isbn must be 10 or 13 characters',
    });
  });

  it('does not choke on an empty body — a 204 must not parse as JSON', async () => {
    reply(204, undefined);
    await expect(apiFetch('/x', { host: 'h' })).resolves.toBeUndefined();
  });

  it('login posts identifier and password and returns both tokens', async () => {
    reply(201, { accessToken: 'a', refreshToken: 'r' });
    await expect(login('h', 'me@x.test', 'pw')).resolves.toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({
      identifier: 'me@x.test',
      password: 'pw',
    });
  });

  it('throws ApiError, so a caller can branch on status (429 vs 401)', async () => {
    reply(429, { message: 'Too many' }, false);
    const err: unknown = await apiFetch('/auth/login', { host: 'h' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(429);
  });
});
