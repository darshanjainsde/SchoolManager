process.env.NODE_ENV = 'test';
process.env.LIBRARY_DATABASE_URL_APP ||= 'postgresql://u:p@localhost:5432/db?schema=library';
process.env.LIBRARY_DATABASE_URL_PLATFORM ||= 'postgresql://u:p@localhost:5432/db?schema=library';
process.env.LIBRARY_REDIS_URL ||= 'redis://localhost:6379';
process.env.LIBRARY_JWT_SECRET ||= 'test-jwt-secret-at-least-32-characters-long';
process.env.LIBRARY_REFRESH_SECRET ||= 'test-refresh-secret-at-least-32-chars-ok';
process.env.LIBRARY_PLATFORM_HOST ||= 'library.trackyour.in';
