import { HttpException } from '@nestjs/common';

/**
 * Every code a `/manage/*` (or other) client may need to switch on.
 * Clients MUST branch on `code`, never on `message` text — messages are
 * free-form and may change without notice.
 */
export type ErrorCode =
  | 'DUPLICATE_ADMISSION_NO'
  | 'CLASS_NOT_FOUND'
  | 'LOGIN_EXISTS'
  | 'EMAIL_REQUIRED'
  | 'INVITE_ALREADY_ACCEPTED'
  | 'CLASS_NOT_EMPTY'
  | 'TEACHER_CONFLICT'
  /** Caller has no linked Teacher record — e.g. a SCHOOL_ADMIN hitting a teacher-only leave route. */
  | 'NOT_A_TEACHER'
  /** The LeaveApplication is no longer PENDING — already approved/rejected. */
  | 'LEAVE_NOT_PENDING'
  /** The LeaveApplication is REJECTED or already CANCELLED — nothing to cancel. */
  | 'LEAVE_NOT_CANCELLABLE'
  /** Caller is neither the owning teacher nor a SCHOOL_ADMIN — pair with 403. */
  | 'LEAVE_CANCEL_FORBIDDEN'
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
