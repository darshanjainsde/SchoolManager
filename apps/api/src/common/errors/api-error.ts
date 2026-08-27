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
  /** No alumni record with that id in this school — pair with 404. */
  | 'ALUMNI_NOT_FOUND'
  /** Declined or hidden records cannot be sent a claim link — pair with 409. */
  | 'ALUMNI_NOT_INVITABLE'
  /** One message for expired, already-used and never-existed alike. Telling a
   *  caller WHICH of the three they hit is an oracle for probing links. 401. */
  | 'ALUMNI_LINK_INVALID'
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
  /** The room still has saved seating plans; deleting it would take them too — pair with 409. */
  | 'ROOM_IN_USE'
  | 'VALIDATION'
  /** Caller is not authenticated (missing/invalid credential) — pair with 401. */
  | 'UNAUTHORIZED'
  /** Caller is authenticated but the school's plan does not include this — 403. */
  | 'FORBIDDEN_FEATURE'
  | 'NOT_FOUND'
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
