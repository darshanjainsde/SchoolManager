/**
 * `@library/core` — the pure, dependency-free half of the library service.
 *
 * Nothing in this package may import Nest, Prisma, `@library/db`, or any
 * Sckools code. That is what lets BOTH `apps/library-api` (which owns the
 * circulation tables) and `apps/api` (which owns the librarian's counter in
 * the Sckools console) call the SAME functions to answer "can this be issued",
 * "what does this child owe", "what state is this issue in". Two
 * implementations of those questions is exactly the divergence the money
 * design exists to prevent — so the answer lives here once, and both apps
 * import it.
 *
 * Isolation still runs the other way: `.dependency-cruiser.library.cjs`'s
 * `no-sckools-imports` rule lists `packages/library-core` in its `from:`, so
 * this package cannot become a laundering route for a Sckools import into the
 * library.
 */
export {
  evaluateIssue,
  evaluateRenew,
  computeFine,
  issueState,
  nextReservationToPromote,
  reservedShelfExpiry,
  reservationState,
  DUE_SOON_WINDOW_DAYS,
} from './policy';
export type {
  Policy,
  Member,
  Copy,
  Issue,
  Reservation,
  ReservationStatusValue,
  IssueDenial,
  RenewDenial,
  IssueState,
} from './policy';
