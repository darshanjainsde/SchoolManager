import type { LibJwtPayload } from '../../auth';

/**
 * `Title.replacementPrice` is a STAFF working number, not a shop price.
 *
 * Both catalogue read routes — `GET /catalog/titles` and
 * `GET /catalog/titles/:id` — are open to `MEMBER`, i.e. to every student and
 * teacher with a library login. Left alone, that would publish "what you will
 * be charged if you lose this" against every book in the school.
 *
 * The product rule this protects is not squeamishness about the number. It is
 * that the ONLY party who tells a child what they owe is the library, after a
 * librarian has confirmed the loss (spec §4, P3). A child who can read ₹299 off
 * the catalogue the moment before tapping "I've lost this book" has been quoted
 * a price by us — and when the librarian then charges ₹340 for the edition
 * actually in print, the school is the one contradicting itself.
 *
 * `ASSISTANT` is staff and DOES see it. The role is already treated that way
 * throughout `catalog.controller.ts` (`GET /catalog/copies/by-accessionNumber`
 * and `GET /catalog/categories` are ORG_OWNER/LIBRARIAN/ASSISTANT, MEMBER
 * excluded), and an assistant who cannot see the price cannot help at the
 * counter, which is the whole job. A senior student holding an ASSISTANT
 * account is holding a staff account — that is a provisioning decision the
 * librarian makes, not a reason to weaken the role.
 */
const REPLACEMENT_PRICE_ROLES: ReadonlySet<LibJwtPayload['role']> = new Set([
  'ORG_OWNER',
  'LIBRARIAN',
  'ASSISTANT',
]);

export function canSeeReplacementPrice(role: LibJwtPayload['role']): boolean {
  return REPLACEMENT_PRICE_ROLES.has(role);
}

/**
 * Removes the key entirely rather than nulling it, so a MEMBER response is
 * indistinguishable from one for a title that genuinely has no price — a
 * `replacementPrice: null` would leak the fact that the field exists and
 * invite a client to render "not set" for a book that is, in fact, priced.
 *
 * Returns a new object; the input row is never mutated, because the raw-SQL
 * rows these come from are also what the caller may still be iterating.
 */
export function stripReplacementPrice<T extends { replacementPrice?: unknown }>(
  row: T,
): Omit<T, 'replacementPrice'> {
  // Copy-then-delete rather than destructuring the key into an unused binding:
  // the destructuring form reads better but trips no-unused-vars, and silencing
  // that with a disable comment costs more attention than it saves.
  const rest = { ...row };
  delete (rest as { replacementPrice?: unknown }).replacementPrice;
  return rest;
}

/**
 * The single chokepoint every catalogue read path goes through. Taking the
 * whole role (rather than a pre-computed boolean) keeps the decision in one
 * file: a future route that forgets to think about this calls the same
 * function and gets the same answer, instead of inventing its own predicate.
 */
export function forRole<T extends { replacementPrice?: unknown }>(
  role: LibJwtPayload['role'],
  rows: T[],
): Array<T | Omit<T, 'replacementPrice'>> {
  return canSeeReplacementPrice(role) ? rows : rows.map(stripReplacementPrice);
}
