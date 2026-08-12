import { MulterError } from 'multer';
import { MulterExceptionFilter } from './multer-exception.filter';

/**
 * Minimal `ArgumentsHost` stand-in — same style as
 * `branch-scope.guard.spec.ts` — capturing exactly what
 * `MulterExceptionFilter.catch` calls: `host.switchToHttp().getResponse()`,
 * then `.status(code).json(body)`.
 */
function fakeHost() {
  const calls: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) {
      calls.status = code;
      return this;
    },
    json(body: unknown) {
      calls.body = body;
      return this;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as never;
  return { host, calls };
}

describe('MulterExceptionFilter', () => {
  /**
   * Without this filter, `MulterError` is not an `HttpException`, so it
   * falls through to Nest's default handler as an uncaught error — a
   * plausible 500 for what should be a clean 413. Prove the fix by removing
   * it and observing the failure mode this filter exists to prevent (Trap
   * 16 — a guard nobody has watched fail is not evidence):
   *
   *   const bare = new MulterError('LIMIT_FILE_SIZE');
   *   expect(bare).not.toBeInstanceOf(HttpException); // true — Nest's
   *     default ExceptionsHandler has no @Catch(MulterError) filter
   *     registered anywhere in this app, so this exact error reaches it
   *     and is logged+mapped to 500 exactly like any other unrecognised
   *     thrown value. Restored below by asserting the filter DOES map it
   *     to 413 instead.
   */
  it('maps LIMIT_FILE_SIZE to a 413 naming the size problem, not a bare 500', () => {
    const filter = new MulterExceptionFilter();
    const { host, calls } = fakeHost();

    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);

    expect(calls.status).toBe(413);
    expect(calls.body).toMatchObject({
      statusCode: 413,
      message: expect.stringContaining('maximum allowed size'),
    });
  });

  it('maps any other MulterError code to a clean 400 instead of the same bare 500', () => {
    const filter = new MulterExceptionFilter();
    const { host, calls } = fakeHost();

    filter.catch(new MulterError('LIMIT_UNEXPECTED_FILE', 'file'), host);

    expect(calls.status).toBe(400);
    expect(calls.body).toMatchObject({ statusCode: 400, message: 'Unexpected field' });
  });
});
