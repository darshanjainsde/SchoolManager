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
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:5432/test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

process.env.S3_ENDPOINT = process.env.S3_ENDPOINT || 'https://s3.test.invalid';
process.env.S3_ACCESS_KEY = process.env.S3_ACCESS_KEY || 'test-access-key';
process.env.S3_SECRET_KEY = process.env.S3_SECRET_KEY || 'test-secret-key';
process.env.S3_BUCKET = process.env.S3_BUCKET || 'test-bucket';

process.env.SMTP_HOST = process.env.SMTP_HOST || 'smtp.test.invalid';
process.env.SMTP_FROM = process.env.SMTP_FROM || 'test@test.invalid';
// Coerced to a number by the schema — an unset value parses as NaN, not a default.
process.env.SMTP_PORT = process.env.SMTP_PORT || '587';

// 16-char minimum enforced by the schema.
process.env.JWT_SCHOOL_ACCESS_SECRET = process.env.JWT_SCHOOL_ACCESS_SECRET || 'test-school-access-secret';
process.env.JWT_SCHOOL_REFRESH_SECRET = process.env.JWT_SCHOOL_REFRESH_SECRET || 'test-school-refresh-secret';
process.env.JWT_PLATFORM_ACCESS_SECRET = process.env.JWT_PLATFORM_ACCESS_SECRET || 'test-platform-access-secret';
process.env.JWT_PLATFORM_REFRESH_SECRET = process.env.JWT_PLATFORM_REFRESH_SECRET || 'test-platform-refresh-secret';
