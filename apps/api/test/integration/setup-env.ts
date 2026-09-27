// Runs in every test worker BEFORE any test module is loaded. Sets the env
// vars Jest's globalSetup created — globalSetup runs in a separate process
// and its env doesn't propagate to workers.

// The fake secrets first, DB urls after (the lines below win, which is the
// point of the order). Until this line the e2e suite got its JWT secrets, SMTP
// host and S3 keys from whatever happened to be in the shell — so it passed on
// a machine that had sourced .env and failed on one that had not, and could
// not run in CI at all. The unit config has loaded this fixture for months;
// only the e2e config was left reading the ambient environment.
// eslint-disable-next-line @typescript-eslint/no-var-requires
require('../env.setup.js');

process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://skoolos:skoolos@localhost:5432/skoolos_test?schema=public';
// schema.prisma declares `directUrl = env("DIRECT_URL")` for the pooled
// production setup. There is no pooler in front of the local test database,
// so the direct URL is the same URL. Set here as well as in globalSetup
// because workers run in their own processes and inherit nothing from it.
process.env.DIRECT_URL = process.env.DATABASE_URL;
process.env.DATABASE_URL_APP =
  process.env.DATABASE_URL.replace(
    'postgresql://skoolos:skoolos',
    'postgresql://skoolos_app:skoolos_app_pw',
  );
process.env.DATABASE_URL_PLATFORM =
  process.env.DATABASE_URL.replace(
    'postgresql://skoolos:skoolos',
    'postgresql://skoolos_platform:skoolos_platform_pw',
  );
process.env.DISABLE_THROTTLER = 'true';
process.env.DISABLE_AUDIT = 'true';
process.env.NODE_ENV = 'test';
