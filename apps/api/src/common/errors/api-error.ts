import { HttpException } from '@nestjs/common';

/**
 * Every code a `/manage/*` (or other) client may need to switch on.
 * Clients MUST branch on `code`, never on `message` text — messages are
 * free-form and may change without notice.
 */
export type ErrorCode =
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
