import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns ok on /health', () => {
    // Health controller constructor reads env; provide minimal values.
    process.env.DATABASE_URL ||= 'postgresql://x:x@localhost:5432/x';
    process.env.REDIS_URL ||= 'redis://localhost:6379';
    process.env.S3_ENDPOINT ||= 'http://localhost:9000';
    process.env.S3_ACCESS_KEY ||= 'x';
    process.env.S3_SECRET_KEY ||= 'x';
    process.env.S3_BUCKET ||= 'x';
    process.env.SMTP_HOST ||= 'localhost';
    process.env.SMTP_PORT ||= '1025';
    process.env.SMTP_FROM ||= 'x';
    process.env.JWT_ACCESS_SECRET ||= 'changeme!';
    process.env.JWT_REFRESH_SECRET ||= 'changeme!';

    const c = new HealthController();
    expect(c.health()).toEqual({ status: 'ok' });
  });
});
