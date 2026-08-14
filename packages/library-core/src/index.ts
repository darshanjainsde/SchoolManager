/**
 * `@library/core` — the circulation implementation both services import.
 *
 * BOTH `apps/library-api` (which owns the circulation tables) and `apps/api`
 * (which owns the librarian's counter in the Sckools console) call the SAME
 * code to answer "can this be issued", "what does this child owe", "what
 * state is this issue in". Two implementations of those questions is exactly
 * the divergence the money design exists to prevent — so the answer lives
 * here once, and both apps import it. `apps/api` cannot import
 * `apps/library-api` at all (`.dependency-cruiser.cjs`'s
 * `no-library-service-imports`), which is why this package exists.
 *
 * Two layers, with DIFFERENT rules — do not blur them:
 *
 *   - `policy.ts` — pure. No Nest, no Prisma, no I/O of any kind. Every
 *     decision function lives here and is unit-tested with plain objects.
 *   - `circulation/` — the WRITE paths (`issue`, `returnBook`, `renew`).
 *     These own a `LibraryTx` and mutate rows, so purity was never available
 *     to them: they import `@library/db` by necessity, and they throw
 *     `@nestjs/common` HTTP exceptions because both consumers are Nest apps
 *     and the alternative — each app mapping a private error taxonomy back
 *     to status codes — is a second implementation of exactly the thing this
 *     package exists to have one of. `@nestjs/common` is a PEER dependency,
 *     not a dependency: a second copy would break `instanceof HttpException`
 *     in Nest's exception filter and turn every 403/404/409 into a 500.
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

/* --- the write paths (see the layer note above) --- */
export { issue, returnBook } from './circulation/issues';
export type { IssueBookInput, ReturnBookInput, IssueResult, ReturnResult } from './circulation/issues';
export { voidIssue } from './circulation/void';
export type { VoidIssueResult } from './circulation/void';
export { renew } from './circulation/renew';
export type { RenewBookInput, RenewResult } from './circulation/renew';
export { loadPolicy } from './circulation/policy-loader';
export { assertBranchInScope } from './branch-scope';
export { markPresentByTransaction } from './attendance';
