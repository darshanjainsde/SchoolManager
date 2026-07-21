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
  | 'VALIDATION'
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
