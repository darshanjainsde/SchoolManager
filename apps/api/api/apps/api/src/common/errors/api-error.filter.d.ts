import { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
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
export declare class ApiErrorFilter implements ExceptionFilter {
    private readonly logger;
    catch(exception: unknown, host: ArgumentsHost): void;
    private normalize;
    private fromValidationError;
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
    private extractField;
    private fromHttpException;
    private codeForStatus;
}
//# sourceMappingURL=api-error.filter.d.ts.map