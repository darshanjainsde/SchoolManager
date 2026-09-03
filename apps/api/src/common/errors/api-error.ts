import { HttpException } from '@nestjs/common';

/**
 * Every code a `/manage/*` (or other) client may need to switch on.
 * Clients MUST branch on `code`, never on `message` text — messages are
 * free-form and may change without notice.
 */
export type ErrorCode =
  // ─── Homecoming (alumni wing) ──────────────────────────────────────────────
  /** Graduation was asked for with no class sections — pair with 400. */
  | 'NOTHING_TO_GRADUATE'
  /** A decline (claim, gift, session) with no reason. The office owes one, and
   *  requiring it is what makes suggesting an alternative the easier path. */
  | 'REASON_REQUIRED'
  | 'CLAIM_ALREADY_DECIDED'
  /** A self-registration with neither an email nor a phone — the school would
   *  have no way to tell the person the outcome. Pair with 400. */
  | 'CONTACT_REQUIRED'
  /** The school's pending-claim queue is at its ceiling. A cap on the damage a
   *  script can do, not on an honest caller. Pair with 429. */
  | 'CLAIM_QUEUE_FULL'
  /** No alumni record with that id in this school — pair with 404. */
  | 'ALUMNI_NOT_FOUND'
  /** Declined or hidden records cannot be sent a claim link — pair with 409. */
  | 'ALUMNI_NOT_INVITABLE'
  /** One message for expired, already-used and never-existed alike. Telling a
   *  caller WHICH of the three they hit is an oracle for probing links. 401. */
  | 'ALUMNI_LINK_INVALID'
  /** Wrong email/password, no such account, or the office has since un-verified
   *  them. One message for all three — separate ones are an oracle for who has
   *  an account at a given school. Pair with 401. */
  | 'ALUMNI_LOGIN_INVALID'
  /** Tried to change a password on an alumnus who has no account. Pair with 409. */
  | 'NO_ALUMNI_ACCOUNT'
  /** A claim was merged into a record from a different batch year — almost
   *  always a mis-click in a long list. Pair with 409. */
  | 'CLAIM_BATCH_MISMATCH'
  /** Trust-for-students was granted to an alumnus nobody has verified — 409. */
  | 'MUST_BE_VERIFIED_FIRST'
  | 'BAD_GIFT_SCOPE'
  | 'DONOR_REQUIRED'
  | 'GIFT_REQUIRED'
  | 'GIFT_ITEM_INACTIVE'
  /** The chosen group has no active students, so there is no headcount — 409. */
  | 'EMPTY_GROUP'
  | 'COUNTER_NOTE_REQUIRED'
  | 'GIFT_TRANSITION_ILLEGAL'
  /** Fewer goods arrived than the group has children. The gift covers everyone
   *  or it waits — the pledge stays open so somebody can close it. Pair with 409. */
  /** A funded gift with no price: the school can neither bank it, buy against
   *  it, nor chase it. Pair with 400. */
  | 'GIFT_PRICE_REQUIRED'
  /** Asked to arrange collection for a gift of money. Pair with 409. */
  | 'GIFT_NOT_COLLECTABLE'
  /** A tracking reference with nobody carrying it — an unlookuppable number.
   *  Pair with 400. */
  | 'COURIER_REQUIRED'
  /** Tried to thank somebody for a gift the school has not accepted. 409. */
  | 'GIFT_NOT_ACCEPTED'
  /** An attachment upload with no file, or the wrong sort of file. 400. */
  | 'FILE_REQUIRED'
  | 'BAD_FILE_TYPE'
  | 'GIFT_SHORT'
  /** Given + absent must equal the headcount; children who were away are still owed. */
  | 'GIFT_COUNT_MISMATCH'
  | 'BAD_DATE_RANGE'
  /** A session was requested by an alumnus the school has not cleared to work
   *  with students. Verified is not the same as trusted — pair with 403. */
  | 'NOT_TRUSTED_FOR_STUDENTS'
  | 'SLOT_NOT_AVAILABLE'
  | 'COUNTER_SLOT_REQUIRED'
  /** Nothing reaches SCHEDULED without a named member of staff in the room. */
  | 'SESSION_NEEDS_ACCOMPANYING_TEACHER'
  | 'SESSION_COUNTER_LIMIT_REACHED'
  | 'SESSION_WRONG_ACTOR'
  | 'SESSION_ILLEGAL_TRANSITION'
  /** This deployment has no EMAIL_SECRET_KEY, so a school's own mail password
   *  cannot be stored. Pair with 503 — it is an operator gap, not the admin's
   *  mistake, and mail keeps flowing through the platform sender meanwhile. */
  | 'EMAIL_SECRET_MISSING'
  | 'DUPLICATE_ADMISSION_NO'
  | 'CLASS_NOT_FOUND'
  | 'LOGIN_EXISTS'
  | 'EMAIL_REQUIRED'
  | 'INVITE_ALREADY_ACCEPTED'
  | 'CLASS_NOT_EMPTY'
  | 'TEACHER_CONFLICT'
  /** Caller has no linked Teacher record — e.g. a SCHOOL_ADMIN hitting a teacher-only leave route. */
  | 'NOT_A_TEACHER'
  /** Caller has no linked Staff record — e.g. a STAFF-role JWT with no matching Staff.userId row. */
  | 'NOT_STAFF'
  /** The LeaveApplication is no longer PENDING — already approved/rejected. */
  | 'LEAVE_NOT_PENDING'
  /** The LeaveApplication is REJECTED or already CANCELLED — nothing to cancel. */
  | 'LEAVE_NOT_CANCELLABLE'
  /** Caller is neither the owning teacher nor a SCHOOL_ADMIN — pair with 403. */
  | 'LEAVE_CANCEL_FORBIDDEN'
  /** A LeaveTypeDef with that name already exists for this school — pair with 409. */
  | 'LEAVE_TYPE_EXISTS'
  /** Leave policy needs an academic year and the school has none current — pair with 404. */
  | 'NO_ACADEMIC_YEAR'
  /** A TEACHER targeted a class section they do not teach — pair with 403. */
  | 'CLASS_NOT_OWNED'
  /** Caller has no linked Student record — e.g. a non-student login hitting /me/messages. Pair with 404. */
  | 'NOT_A_STUDENT'
  /** A STUDENT tried to message a teacher who does not teach them that subject (per the timetable) — pair with 403. */
  | 'NOT_YOUR_TEACHER'
  /** A TEACHER tried to open/reply to a message thread that is not theirs — pair with 404. */
  | 'NOT_YOUR_THREAD'
  /** A STUDENT with no class section tried to start a thread — pair with 409. */
  | 'NO_CLASS_SECTION'
  /** A TEACHER tried to edit/delete an Announcement authored by someone else — pair with 403. */
  | 'ANNOUNCEMENT_NOT_OWNED'
  /** A TEACHER tried to change an Announcement's class targets via PATCH — targets are immutable after posting; pair with 400. */
  | 'ANNOUNCEMENT_TARGETS_LOCKED'
  /** A past day's register is closed and has no APPROVED, unexpired RegisterChangeRequest — pair with 409. */
  | 'REGISTER_LOCKED'
  /** A RegisterChangeRequest already exists PENDING for this exact class+date — pair with 409. */
  | 'REGISTER_CHANGE_OPEN'
  /** A RegisterChangeRequest is no longer PENDING — already approved/rejected — pair with 409. */
  | 'REGISTER_CHANGE_DECIDED'
  /** Avatar upload (POST /me/photo): no multipart `file` part — pair with 400. */
  | 'FILE_REQUIRED'
  /** Avatar upload: not an image/* mimetype — pair with 415. */
  | 'UNSUPPORTED_TYPE'
  /** Avatar upload: over the 2MB cap — pair with 413. */
  | 'FILE_TOO_LARGE'
  /** Caller's login has no Student/Teacher/Staff person row to attach a photo to — pair with 404. */
  | 'NO_PROFILE'
  /** Teacher onboarding: this identity is an ACTIVE teacher at another school — release them there first. Pair with 409. */
  | 'ALREADY_AT_SCHOOL'
  /** Caller's STAFF login has no Staff row with role LIBRARIAN — pair with 403. */
  | 'NOT_LIBRARIAN'
  /** Borrower is at their loan limit; re-send with `override: true` to issue anyway — pair with 409. */
  | 'LIBRARY_LIMIT'
  /** Borrower already holds an open copy of this title; `override: true` issues anyway — pair with 409. */
  | 'LIBRARY_DUPLICATE_TITLE'
  /** No free copy of the title (all out or lost) — pair with 409. */
  | 'LIBRARY_UNAVAILABLE'
  /** The issue is not in the state the action needs (already returned / not returned / written off) — pair with 409. */
  | 'LIBRARY_NOT_OPEN'
  /** The fine is not DUE (already collected or waived) — pair with 409. */
  | 'LIBRARY_FINE_SETTLED'
  /** A room with that name already exists at this school — pair with 409. */
  | 'ROOM_NAME_TAKEN'
  // ─── The Press (report cards + certificates) ──────────────────────────────
  /** A TC asked for while the fee ledger shows a balance. Re-send with
   *  `duesOverride: true` to issue anyway — the register records the override.
   *  Pair with 409. */
  | 'DUES_OUTSTANDING'
  /** A report window with that name already exists for the year — 409. */
  | 'WINDOW_EXISTS'
  /** A serial the atomic allocator should make impossible collided anyway —
   *  a counter was reset by hand. Pair with 409; the retry gets a fresh one. */
  | 'SERIAL_TAKEN'
  /** Voiding an entry that is already struck through — pair with 409. */
  | 'ALREADY_VOIDED'
  // ─── Press Orders (print fulfilment) ──────────────────────────────────────
  /** The order is not in a state that allows this move (the transition map
   *  said no): confirming an unquoted order, quoting a confirmed one,
   *  dispatching before printing. Pair with 409. */
  | 'ORDER_TRANSITION_ILLEGAL'
  /** A report-card print order needs at least one ISSUED card in the batch —
   *  we print the register's frozen snapshots, never a live preview. 409. */
  | 'ISSUED_BATCH_REQUIRED'
  /** The room still has saved seating plans; deleting it would take them too — pair with 409. */
  | 'ROOM_IN_USE'
  | 'VALIDATION'
  /** Caller is not authenticated (missing/invalid credential) — pair with 401. */
  | 'UNAUTHORIZED'
  /** Caller is authenticated but the school's plan does not include this — 403. */
  | 'FORBIDDEN_FEATURE'
  | 'NOT_FOUND'
  /** No payment provider is registered under that key — pair with 400. */
  | 'UNKNOWN_PAYMENT_PROVIDER'
  /** Sckools has not finished onboarding with this gateway yet, so it cannot
   *  take money. The parent's Pay Now button renders disabled off the same
   *  fact; this code is the belt to that braces. Pair with 409. */
  | 'PAYMENT_PROVIDER_UNAVAILABLE'
  /** The school has not switched on any way for parents to pay — pair with 409. */
  | 'NO_PAYMENT_METHOD'
  /** That UTR / reference has already been claimed at this school — pair with 409. */
  | 'DUPLICATE_PAYMENT_REFERENCE'
  /** The payment is no longer awaiting review (already verified or rejected) — pair with 409. */
  | 'PAYMENT_NOT_PENDING'
  /** Bills already exist for this term, so the plan behind them is frozen — pair with 409. */
  | 'FEE_PLAN_FROZEN'
  /** A concession must be either a percentage or an amount, never both or neither. */
  | 'CONCESSION_BASIS'
  /** No fee structure has been set up for the year being billed — pair with 409. */
  | 'FEE_SETUP_INCOMPLETE'
  | 'INTERNAL';

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  field?: string;
}

/**
 * Throw this instead of a bare Nest `HttpException` for any error a client
 * needs to distinguish programmatically. The response body is always
 * `{ code, message, field? }` — `field` is omitted entirely (not `undefined`)
 * when not supplied, so callers see a clean envelope either way.
 */
export class ApiError extends HttpException {
  constructor(code: ErrorCode, message: string, status: number, field?: string) {
    super(field ? { code, message, field } : { code, message }, status);
  }
}
