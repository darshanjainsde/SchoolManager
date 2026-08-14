/** The pure policy engine now lives in `packages/library-core` (`@library/core`)
 *  so `apps/api`'s librarian counter can call the SAME functions instead of
 *  growing a second answer to "what does this child owe". Re-exported here
 *  unchanged so in-service callers keep importing circulation's public
 *  interface rather than reaching past it. */
export {
  evaluateIssue,
  evaluateRenew,
  computeFine,
  issueState,
  nextReservationToPromote,
  reservedShelfExpiry,
  reservationState,
  DUE_SOON_WINDOW_DAYS,
} from '@library/core';
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
} from '@library/core';
/** The circulation policy for a member type, resolved branch-first. Exported
 *  because `me` needs the same figures a borrower is shown at the desk, and a
 *  second implementation of "what does this member owe" is how the two screens
 *  start disagreeing. */
export { loadPolicy } from './internal/policy-loader';
export { CirculationModule } from './internal/circulation.module';
