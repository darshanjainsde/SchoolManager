import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, PayloadTooLargeException } from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';

/**
 * `FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_FILE_BYTES } })`
 * on `POST /catalog/import/titles` throws a raw `multer` `MulterError` from
 * inside the interceptor pipeline — BEFORE the handler body runs, so the
 * handler's own try/catch never sees it. A `MulterError` is not a NestJS
 * `HttpException`, so without this filter it falls through to Nest's default
 * exception handler as an uncaught error: a plausible 500 for what is really
 * a client mistake (uploading a file over the size cap), not a server fault.
 *
 * Only `LIMIT_FILE_SIZE` maps to the caller-facing 413 — the one limit this
 * controller actually configures (see `MAX_IMPORT_FILE_BYTES`). Any other
 * `MulterError` code (e.g. `LIMIT_UNEXPECTED_FILE` from a wrong multipart
 * field name) still becomes a clean 4xx via `HttpException`'s own status
 * rather than a raw 500, but is intentionally not asserted on by name here —
 * this route does not configure a field-count or field-name limit, so those
 * codes are not reachable from it today.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost): void {
    // `BadRequestException` (not a bare `HttpException(message, 400)`) so the
    // non-size codes still come back with the standard `{statusCode,
    // message, error}` body every other exception in this API produces —
    // `new HttpException('msg', 400).getResponse()` returns the raw string
    // 'msg', not an object, which would make this one route's error shape
    // silently different from every other 4xx in the API.
    const httpException: HttpException =
      exception.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException('Uploaded file exceeds the maximum allowed size')
        : new BadRequestException(exception.message);

    const response = host.switchToHttp().getResponse<Response>();
    response.status(httpException.getStatus()).json(httpException.getResponse());
  }
}
