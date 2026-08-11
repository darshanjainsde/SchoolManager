import { IsbnLookupService } from './isbn-lookup.service';

/**
 * These fixtures are the actual response bodies observed live against
 * Open Library on 2026-08-12 (see the doc comment on isbn-lookup.service.ts
 * for the full shape notes) — trimmed to the fields the parser reads, not
 * hand-imagined from API docs (LIBRARY-TRAPS #15).
 */
const FANTASTIC_MR_FOX_RESPONSE = {
  'ISBN:9780140328721': {
    title: 'Fantastic Mr. Fox',
    authors: [{ url: 'http://openlibrary.org/authors/OL34184A/Roald_Dahl', name: 'Roald Dahl' }],
    number_of_pages: 96,
    identifiers: { isbn_10: ['0140328726'], isbn_13: ['9780140328721'], openlibrary: ['OL7353617M'] },
    publishers: [{ name: 'Puffin' }],
    publish_date: 'October 1, 1988',
    cover: {
      small: 'https://covers.openlibrary.org/b/id/15152634-S.jpg',
      medium: 'https://covers.openlibrary.org/b/id/15152634-M.jpg',
      large: 'https://covers.openlibrary.org/b/id/15152634-L.jpg',
    },
  },
};

function mockFetchOnce(body: unknown, init: { ok?: boolean } = {}): jest.Mock {
  const mock = jest.fn().mockResolvedValue({
    ok: init.ok ?? true,
    json: () => Promise.resolve(body),
  });
  (globalThis as { fetch: unknown }).fetch = mock;
  return mock;
}

describe('IsbnLookupService.lookup', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('parses a real Open Library record into the lookup result shape', async () => {
    mockFetchOnce(FANTASTIC_MR_FOX_RESPONSE);
    const service = new IsbnLookupService();

    const result = await service.lookup('9780140328721');

    expect(result).toEqual({
      found: true,
      title: 'Fantastic Mr. Fox',
      subtitle: undefined,
      authors: ['Roald Dahl'],
      publisher: 'Puffin',
      publishedYear: 1988,
      pageCount: 96,
      coverUrl: 'https://covers.openlibrary.org/b/id/15152634-M.jpg',
      isbn13: '9780140328721',
      isbn10: '0140328726',
    });
  });

  it('degrades to not-found when the bibkey is absent from the response (the real "unknown ISBN" shape — {} with HTTP 200, not a 404)', async () => {
    mockFetchOnce({});
    const service = new IsbnLookupService();

    const result = await service.lookup('0000000000');

    expect(result).toEqual({ found: false });
  });

  it('degrades to not-found on a non-2xx response instead of throwing', async () => {
    mockFetchOnce({}, { ok: false });
    const service = new IsbnLookupService();

    await expect(service.lookup('9780140328721')).resolves.toEqual({ found: false });
  });

  it('degrades to not-found when fetch rejects (network failure) instead of throwing', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const service = new IsbnLookupService();

    await expect(service.lookup('9780140328721')).resolves.toEqual({ found: false });
  });

  it('degrades to not-found on a timeout instead of hanging the request', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn(
      (_url: string, opts: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const service = new IsbnLookupService();

    await expect(service.lookup('9780140328721', 10)).resolves.toEqual({ found: false });
  });

  it('strips hyphens/whitespace before building the request', async () => {
    const mock = mockFetchOnce(FANTASTIC_MR_FOX_RESPONSE);
    const service = new IsbnLookupService();

    await service.lookup('978-0-14-032872-1');

    expect(mock).toHaveBeenCalledWith(expect.stringContaining('ISBN%3A9780140328721'), expect.anything());
  });

  it('returns not-found without calling fetch at all for an empty ISBN', async () => {
    const mock = mockFetchOnce({});
    const service = new IsbnLookupService();

    const result = await service.lookup('   ');

    expect(result).toEqual({ found: false });
    expect(mock).not.toHaveBeenCalled();
  });
});
