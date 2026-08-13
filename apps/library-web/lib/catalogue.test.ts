import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setReplacementPrice } from './catalogue';

/**
 * The one behaviour here that is silent when wrong: clearing a price.
 *
 * The API's `UpdateTitleDto` reads `undefined` as "leave this field alone" and
 * `null` as "set it to NULL". A client that dropped the key when the librarian
 * emptied the box would therefore appear to clear the price, report success,
 * and change nothing — the librarian would find ₹2999 still on the book the
 * next time a copy of it went missing.
 */
describe('setReplacementPrice', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({ id: 't1', replacementPrice: null }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function sentBody() {
    return JSON.parse(fetchMock.mock.calls[0][1].body as string);
  }

  it('PATCHes the title, not some other verb or path', async () => {
    await setReplacementPrice('h', 'tok', 't1', 299);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/catalog\/titles\/t1$/);
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });

  it('sends the amount when setting a price', async () => {
    await setReplacementPrice('h', 'tok', 't1', 299.5);
    expect(sentBody()).toEqual({ replacementPrice: 299.5 });
  });

  it('sends an explicit null to clear — never an omitted key', async () => {
    await setReplacementPrice('h', 'tok', 't1', null);
    const body = sentBody();
    expect(body).toEqual({ replacementPrice: null });
    expect('replacementPrice' in body).toBe(true);
  });

  it('sends zero as zero, not as a cleared value', async () => {
    // ₹0 is a real, deliberate price (a book written off as out of print).
    // A truthiness check anywhere on this path would turn it into "unset".
    await setReplacementPrice('h', 'tok', 't1', 0);
    expect(sentBody()).toEqual({ replacementPrice: 0 });
  });
});
