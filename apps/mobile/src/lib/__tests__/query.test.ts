import { clearCache, fetchCached, invalidate, readCache } from '../query';
import { api } from '../api';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
});

describe('the cache', () => {
  it('remembers an answer and hands it back synchronously', async () => {
    (api.request as jest.Mock).mockResolvedValue({ ok: 1 });
    expect(readCache('/me/x')).toBeUndefined();
    await fetchCached('/me/x');
    expect(readCache('/me/x')).toEqual({ ok: 1 });
  });

  it('shares ONE in-flight request between concurrent callers', async () => {
    let resolve!: (v: unknown) => void;
    (api.request as jest.Mock).mockReturnValue(new Promise((r) => (resolve = r)));
    const a = fetchCached('/me/y');
    const b = fetchCached('/me/y');
    expect(api.request).toHaveBeenCalledTimes(1);
    resolve({ n: 2 });
    expect(await a).toEqual({ n: 2 });
    expect(await b).toEqual({ n: 2 });
  });

  it('a failed fetch leaves the old answer in place', async () => {
    (api.request as jest.Mock).mockResolvedValueOnce({ v: 'old' });
    await fetchCached('/me/z');
    (api.request as jest.Mock).mockRejectedValueOnce(new Error('down'));
    await expect(fetchCached('/me/z')).rejects.toThrow('down');
    expect(readCache('/me/z')).toEqual({ v: 'old' });
  });

  it('invalidate drops by prefix; clearCache drops everything', async () => {
    (api.request as jest.Mock).mockResolvedValue({});
    await fetchCached('/me/fees');
    await fetchCached('/me/fees/how-to-pay');
    await fetchCached('/me/home');
    invalidate('/me/fees');
    expect(readCache('/me/fees')).toBeUndefined();
    expect(readCache('/me/fees/how-to-pay')).toBeUndefined();
    expect(readCache('/me/home')).toBeDefined();
    clearCache();
    expect(readCache('/me/home')).toBeUndefined();
  });
});
