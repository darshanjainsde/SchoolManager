import { apiFetch } from './api';

/**
 * Mirrors `TitleSearchHit` in the API's `search.service.ts`, read from that
 * file rather than recalled — a client type written from memory of a shape is
 * the most-repeated mistake in this project's ledger. `createdAt`/`updatedAt`
 * arrive as ISO strings over HTTP even though the server types them as Date.
 */
export interface TitleHit {
  id: string;
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
  language: string;
  callNumber: string | null;
  coverUrl: string | null;
  description: string | null;
  pageCount: number | null;
  createdAt: string;
  updatedAt: string;
  /** ts_rank; 0 for the empty-query listing, which orders by title instead. */
  rank: number;
}

export function searchTitles(
  host: string,
  token: string,
  q: string,
  opts: { limit?: number; signal?: AbortSignal } = {},
): Promise<TitleHit[]> {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return apiFetch<TitleHit[]>(`/catalog/titles${qs ? `?${qs}` : ''}`, {
    host,
    token,
    signal: opts.signal,
  });
}

/**
 * A stable colour per title, so a spine keeps its identity between renders and
 * between sessions. Derived from the id rather than the list index — index
 * would repaint every spine when a search filters the list, which is the
 * "colour follows the entity, never its rank" rule.
 */
export function spineHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
