import { apiFetch } from './api';
import type { Money } from './circulation';

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
  /**
   * What it costs to buy this book again today — the number a parent is asked
   * to pay for a lost copy. NOT the price the school paid, which is
   * `Copy.acquisitionCost` and belongs to the register's "Price paid" column.
   *
   * `Money` because a Postgres `numeric` reaches the client as a decimal STRING
   * (`Decimal.toJSON()` is `toString()`) — confirmed against the running API,
   * not assumed. Normalise through `rupees()` before doing arithmetic.
   *
   * OPTIONAL because the API omits the key entirely for a `MEMBER` caller (see
   * the API's `replacement-price-visibility.ts`): the console is a staff app so
   * it will always be present here, but the type tells the truth about the
   * endpoint rather than about one of its callers. `null` is a different thing
   * and a designed state — the book has no price on record.
   */
  replacementPrice?: Money | null;
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
 * Sets or clears a title's replacement price.
 *
 * `null` clears it, and that is deliberate rather than incidental: a librarian
 * who typed ₹2999 by mistake must be able to get back to "no price on record",
 * not merely to another guess. The API's `UpdateTitleDto` treats `undefined` as
 * "leave alone" and `null` as "set to NULL", so this function always sends the
 * key — omitting it would silently mean "no change".
 *
 * Returns the updated title as the API's `PATCH /catalog/titles/:id` shapes it,
 * which includes relations this screen does not use; only the price is read
 * back here.
 */
export function setReplacementPrice(
  host: string,
  token: string,
  titleId: string,
  replacementPrice: number | null,
): Promise<{ id: string; replacementPrice: Money | null }> {
  return apiFetch(`/catalog/titles/${titleId}`, {
    host,
    token,
    method: 'PATCH',
    body: JSON.stringify({ replacementPrice }),
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
