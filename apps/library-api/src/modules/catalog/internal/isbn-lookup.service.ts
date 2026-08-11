import { Injectable } from '@nestjs/common';

export interface IsbnLookupResult {
  found: boolean;
  title?: string;
  subtitle?: string;
  authors?: string[];
  publisher?: string;
  publishedYear?: number;
  pageCount?: number;
  coverUrl?: string;
  isbn13?: string;
  isbn10?: string;
}

const OPEN_LIBRARY_URL = 'https://openlibrary.org/api/books';
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Shape observed live against `GET https://openlibrary.org/api/books
 * ?bibkeys=ISBN:<isbn>&jscmd=data&format=json` on 2026-08-12 (LIBRARY-TRAPS
 * #15 — this is written from the actual response, not from memory of the
 * API docs):
 *
 *   - The endpoint always returns HTTP 200, even for an ISBN it has never
 *     heard of. There is no 404 case to branch on.
 *   - The body is `{ [bibkey]: BookRecord }`, keyed by the exact
 *     `ISBN:<isbn>` string sent in the request. An unknown ISBN — including
 *     outright malformed input like `ISBN:abcdefg` — comes back as `{}`:
 *     the key is simply absent. That absence, not a status code, is what
 *     "not found" means here.
 *   - `authors` is an array of `{ name, url }` (not a list of author-key
 *     references the way `/isbn/<isbn>.json` returns them), so a usable
 *     author name is available in a single request with no follow-up
 *     fetch.
 *   - `publishers` is an array of `{ name }`.
 *   - `publish_date` is a free-text string ("October 1, 1988", "1985" —
 *     not a structured date), so pulling a year out of it means scanning
 *     for a 4-digit run, not `Date.parse`.
 *   - `cover` (present on records that have one) is `{ small, medium,
 *     large }` URLs; `medium` is used here as a reasonable default size.
 *   - `identifiers.isbn_13`/`isbn_10` are arrays (a record can have both).
 *
 * Every field read below is optional-chained/guarded because none of this
 * is a documented, versioned contract — Open Library is a third-party API
 * with no SLA, and a partially-populated record (no cover, no pages, no
 * authors) is common, not exceptional.
 */
interface OpenLibraryBookRecord {
  title?: unknown;
  subtitle?: unknown;
  authors?: unknown;
  publishers?: unknown;
  publish_date?: unknown;
  number_of_pages?: unknown;
  cover?: { medium?: unknown };
  identifiers?: { isbn_13?: unknown; isbn_10?: unknown };
}

function extractYear(publishDate: unknown): number | undefined {
  if (typeof publishDate !== 'string') return undefined;
  const match = publishDate.match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : undefined;
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}

function parseRecord(record: OpenLibraryBookRecord): IsbnLookupResult {
  const authors = Array.isArray(record.authors)
    ? record.authors
        .map((a) => (a && typeof a === 'object' && typeof (a as { name?: unknown }).name === 'string' ? (a as { name: string }).name : undefined))
        .filter((n): n is string => Boolean(n))
    : undefined;

  const publisher =
    Array.isArray(record.publishers) &&
    record.publishers[0] &&
    typeof record.publishers[0] === 'object' &&
    typeof (record.publishers[0] as { name?: unknown }).name === 'string'
      ? (record.publishers[0] as { name: string }).name
      : undefined;

  return {
    found: true,
    title: typeof record.title === 'string' ? record.title : undefined,
    subtitle: typeof record.subtitle === 'string' ? record.subtitle : undefined,
    authors: authors?.length ? authors : undefined,
    publisher,
    publishedYear: extractYear(record.publish_date),
    pageCount: typeof record.number_of_pages === 'number' ? record.number_of_pages : undefined,
    coverUrl: typeof record.cover?.medium === 'string' ? record.cover.medium : undefined,
    isbn13: firstString(record.identifiers?.isbn_13),
    isbn10: firstString(record.identifiers?.isbn_10),
  };
}

const NOT_FOUND: IsbnLookupResult = { found: false };

@Injectable()
export class IsbnLookupService {
  /**
   * Never throws / never propagates an Open Library failure to the caller
   * — a timeout, a network error, a non-2xx response, or a response body
   * that doesn't match the expected shape all degrade to `{ found: false
   * }`, same as a genuine "no record for this ISBN". The task brief is
   * explicit about this: a lookup that fails the request is worse than one
   * that just reports nothing, because it would turn a third party's
   * availability into this service's availability.
   */
  async lookup(isbn: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<IsbnLookupResult> {
    const cleaned = isbn.replace(/[\s-]/g, '');
    if (!cleaned) return NOT_FOUND;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${OPEN_LIBRARY_URL}?bibkeys=${encodeURIComponent(`ISBN:${cleaned}`)}&jscmd=data&format=json`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return NOT_FOUND;

      const body: unknown = await res.json();
      if (!body || typeof body !== 'object') return NOT_FOUND;

      const record = (body as Record<string, unknown>)[`ISBN:${cleaned}`];
      if (!record || typeof record !== 'object') return NOT_FOUND;

      return parseRecord(record as OpenLibraryBookRecord);
    } catch {
      // Timeout (AbortError), network failure, or a JSON parse error on a
      // malformed body — all the same outcome from the caller's point of
      // view: this ISBN could not be resolved right now.
      return NOT_FOUND;
    } finally {
      clearTimeout(timer);
    }
  }
}
