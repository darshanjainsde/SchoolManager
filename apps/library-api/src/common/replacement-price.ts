/**
 * What a parent is asked to pay for a lost book, and — just as importantly —
 * WHERE that number came from.
 *
 * This is the one place the resolution order lives. It is pure: no `tx`, no
 * Prisma, no I/O, so the rule can be exercised exhaustively without a database
 * and P3's five-step loss flow can call it inside an already-tight interactive
 * transaction without adding a round trip.
 *
 * It lives in `common/` rather than in a module because both `catalog` (which
 * owns the price) and `circulation` (which will charge it) need it, and
 * `.dependency-cruiser.library.cjs`'s `no-cross-module-internal-import` rule
 * forbids one module reaching into another's `internal/`. `common/` is
 * explicitly shared infrastructure under that config's scope note.
 *
 * ORDER, and why each step is where it is:
 *
 *   1. `typed` — an amount the librarian entered on the loss screen for THIS
 *      loss. Always wins. It is the only input with a human looking at the
 *      actual book, and it is how a title whose editions genuinely differ in
 *      price gets the right number without every school maintaining a price per
 *      physical copy.
 *
 *   2. `titlePrice` — `Title.replacementPrice`, what it costs to buy this book
 *      again today. The intended source in steady state.
 *
 *   3. `copyAcquisitionCost` — what the school PAID for this copy, from the
 *      bill. A weak last resort and never presented bare: it is historic, so
 *      the ₹45 paid in 1998 is not what a replacement costs. The `source` this
 *      returns is what obliges the caller to say so out loud
 *      ("the library paid ₹45 when this copy was bought — check this")
 *      rather than letting a wrong number acquire false authority.
 *
 *   4. Nothing resolves — `UNPRICED`, amount `null`. This is a LEGITIMATE
 *      outcome, not an error, and callers must treat it as one. A school
 *      onboarding four thousand books has this everywhere. Recording the loss
 *      must still succeed: reporting a loss is what freezes the daily late
 *      charge (spec §2.4), so refusing the report because a catalogue field is
 *      empty would keep billing the child who owned up. Only the money is
 *      deferred.
 *
 * Zero is a real price and is NOT treated as absent — a book written off as out
 * of print is settled at ₹0 deliberately, and `|| 0`-style coalescing would
 * turn "the school decided this costs nothing" into "we have no idea".
 */
export type ReplacementPriceSource =
  /** A librarian typed it for this specific loss. */
  | 'TYPED'
  /** `Title.replacementPrice` — today's cost to buy the book again. */
  | 'TITLE_PRICE'
  /** `Copy.acquisitionCost` — historic, what the school paid. Show its age. */
  | 'PURCHASE_COST'
  /** No price anywhere. Record the loss; get the amount from a human later. */
  | 'UNPRICED';

export interface ReplacementPriceInputs {
  /** The per-loss override, if a librarian typed one. */
  typed?: number | null;
  /** `Title.replacementPrice`, already converted from Prisma's Decimal. */
  titlePrice?: number | null;
  /** `Copy.acquisitionCost`, already converted from Prisma's Decimal. */
  copyAcquisitionCost?: number | null;
}

export interface ResolvedReplacementPrice {
  /** `null` only when `source` is `UNPRICED`. */
  amount: number | null;
  source: ReplacementPriceSource;
}

/**
 * Callers convert `Prisma.Decimal` to `number` before calling (via
 * `.toNumber()`), matching what `policy-loader.ts` already does for every other
 * money column that reaches pure logic — so this file never has to know Prisma
 * exists.
 */
export function resolveReplacementPrice(
  inputs: ReplacementPriceInputs,
): ResolvedReplacementPrice {
  const { typed, titlePrice, copyAcquisitionCost } = inputs;

  if (isPrice(typed)) return { amount: typed, source: 'TYPED' };
  if (isPrice(titlePrice)) return { amount: titlePrice, source: 'TITLE_PRICE' };
  if (isPrice(copyAcquisitionCost)) {
    return { amount: copyAcquisitionCost, source: 'PURCHASE_COST' };
  }
  return { amount: null, source: 'UNPRICED' };
}

/**
 * A usable price is a finite, non-negative number. `null`/`undefined` mean "not
 * set" and fall through to the next source.
 *
 * Negative is rejected here as well as by the database's
 * `Title_replacementPrice_nonnegative` CHECK, because `typed` does not come
 * from that column — it arrives on a request body, and a resolver that would
 * happily return a negative charge if a validator were ever loosened is a
 * resolver that depends on something outside itself for correctness. NaN is
 * rejected for the same reason: `Number('abc')` upstream must not become a
 * charge of NaN rupees.
 */
function isPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
