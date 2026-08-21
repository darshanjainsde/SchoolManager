import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiError, type ApiErrorBody } from './api-error';

/**
 * The filter's output is a superset of `ApiErrorBody` — `ApiError`s and
 * `VALIDATION` responses use the strict `ErrorCode` union, but a bare
 * `HttpException` thrown from elsewhere in the app (a 403, 409, etc. that
 * never went through `ApiError`) still needs *some* code, so we widen to
 * `string` here rather than force every status onto the closed union.
 */
type FilterErrorBody = { code: string; message: string; field?: string };

/**
 * Normalizes every thrown error into the `{ code, message, field? }`
 * envelope so clients can switch on `code` instead of parsing `message`.
 *
 * Handles, in order:
 *  1. `ApiError` — already carries its own envelope + status, pass through.
 *  2. `BadRequestException` — rewritten to `code: 'VALIDATION'`. Only when
 *     the exception's response carries an ARRAY `message` (the shape the
 *     global `ValidationPipe`/class-validator produces) do we attempt a
 *     best-effort `field`, pulled from the first message (they're formatted
 *     as `"<property> <constraint description>"`, e.g. `"email must be an
 *     email"`, so the leading token is the property name). A hand-thrown
 *     `new BadRequestException('some message')` has a scalar `message` and
 *     never gets a guessed `field` — it stays `{ code, message }` only.
 *  3. Any other `HttpException` — mapped to a sensible code (`NOT_FOUND`
 *     for 404s, `FORBIDDEN` for 403s, etc.) while preserving `message` and
 *     status.
 *  4. Anything else (unknown error, 500) — logged server-side but reported
 *     to the client as a flat `INTERNAL` error with no stack/detail leak.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const { status, body } = this.normalize(exception);
    response.status(status).json(body);
  }

  private normalize(exception: unknown): { status: number; body: FilterErrorBody } {
    if (exception instanceof ApiError) {
      return { status: exception.getStatus(), body: exception.getResponse() as ApiErrorBody };
    }

    if (exception instanceof BadRequestException) {
      return { status: exception.getStatus(), body: this.fromValidationError(exception) };
    }

    if (exception instanceof HttpException) {
      return { status: exception.getStatus(), body: this.fromHttpException(exception) };
    }

    // Unknown/unhandled — never leak internals or a stack trace to the client.
    // Log via BOTH the Nest logger and console.error: on serverless only the
    // console stream is reliably retained, so a bare logger.error left these
    // 500s with no recoverable cause.
    const detail = exception instanceof Error ? (exception.stack ?? exception.message) : String(exception);
    this.logger.error(detail);
    // eslint-disable-next-line no-console
    console.error('[api] unhandled exception', detail);
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL', message: 'Something went wrong' },
    };
  }

  private fromValidationError(exception: BadRequestException): FilterErrorBody {
    const res = exception.getResponse();
    const rawMessage =
      typeof res === 'string' ? res : ((res as { message?: unknown }).message ?? exception.message);

    // Only the `ValidationPipe`/class-validator shape carries an ARRAY
    // `message` (the list of constraint-violation strings). A hand-thrown
    // `new BadRequestException('some business message')` always has a
    // scalar `message`, and must never have a `field` guessed onto it —
    // the leading token of a business message is not a property name.
    if (!Array.isArray(rawMessage)) {
      const message = String(rawMessage ?? 'Validation failed');
      return { code: 'VALIDATION', message };
    }

    const first = String(rawMessage[0] ?? 'Validation failed');
    const field = this.extractField(first);

    return field
      ? { code: 'VALIDATION', message: first, field }
      : { code: 'VALIDATION', message: first };
  }

  /**
   * class-validator's default messages are formatted as
   * `"<property> <constraint description>"` — e.g. `"email must be an
   * email"` or `"name should not be empty"`. The leading token is the
   * property name as long as it looks like an identifier; otherwise there's
   * no field to extract (best effort, not guaranteed).
   *
   * Only called from the array-`message` (class-validator) branch above —
   * never on a hand-thrown scalar-message `BadRequestException`.
   */
  private extractField(message: string): string | undefined {
    const firstWord = message.trim().split(/\s+/)[0];
    return firstWord && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(firstWord) ? firstWord : undefined;
  }

  private fromHttpException(exception: HttpException): FilterErrorBody {
    const status = exception.getStatus();
    const res = exception.getResponse();
    const message =
      typeof res === 'string'
        ? res
        : Array.isArray((res as { message?: unknown }).message)
          ? ((res as { message: unknown[] }).message[0] as string)
          : ((res as { message?: string }).message ?? exception.message);

    return { code: this.codeForStatus(status), message };
  }

  private codeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      default:
        return 'HTTP';
    }
  }
}
