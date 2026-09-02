/**
 * Dummy environment for unit tests.
 *
 * Several modules call `loadEnv()` at import time (service field initialisers,
 * controller fields), so a suite that merely *imports* one of them explodes
 * with "Invalid environment configuration" before a single test runs. That is
 * why five suites were red and, because CI's boundary check failed first, why
 * nobody noticed.
 *
 * These values are deliberately fake and never reach a network or a database —
 * the suites that use them mock Prisma. Anything requiring a real connection
 * belongs in the e2e config, not here.
 *
 * They are also set UNCONDITIONALLY, which they were not before. The previous
 * `process.env.X = process.env.X || '...'` let a developer's own shell win, so
 * anyone who had sourced the repo's .env — for the e2e suite, say, in the same
 * terminal — silently ran the unit tests against production-shaped secrets.
 * Two suites then failed with messages pointing at the code rather than the
 * environment:
 *
 *   AuthService.refresh   signs with one JWT secret, verifies with another,
 *                         and reports "Invalid refresh token"
 *   MailIdentityService   picks up a real SMTP sender and stops behaving like
 *                         the unverified one the test set up
 *
 * A unit suite that mocks its database and its network has no reason to
 * inherit anything, and every reason to be identical on every machine. This is
 * the third time in one build that a sourced .env was mistaken for a code
 * fault, so the fixture now simply wins.
 */
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';

process.env.S3_ENDPOINT = 'https://s3.test.invalid';
process.env.S3_ACCESS_KEY = 'test-access-key';
process.env.S3_SECRET_KEY = 'test-secret-key';
process.env.S3_BUCKET = 'test-bucket';

process.env.SMTP_HOST = 'smtp.test.invalid';
process.env.SMTP_FROM = 'test@test.invalid';
// Coerced to a number by the schema — an unset value parses as NaN, not a default.
process.env.SMTP_PORT = '587';

// 16-char minimum enforced by the schema.
process.env.JWT_SCHOOL_ACCESS_SECRET = 'test-school-access-secret';
process.env.JWT_SCHOOL_REFRESH_SECRET = 'test-school-refresh-secret';
process.env.JWT_PLATFORM_ACCESS_SECRET = 'test-platform-access-secret';
process.env.JWT_PLATFORM_REFRESH_SECRET = 'test-platform-refresh-secret';
