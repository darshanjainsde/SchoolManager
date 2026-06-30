/**
 * Spin up a dedicated `skoolos_test` database before the suite runs:
 *   1. Drop + create the database via the superuser.
 *   2. Apply all migrations against it.
 *   3. Reset the env so subsequent test requires read from the test DB.
 *
 * After this runs, individual specs reseed inside `beforeEach`.
 */
import { execSync } from 'node:child_process';
import { Client } from 'pg';

const SUPER_URL = 'postgresql://skoolos:skoolos@localhost:5432/postgres';
const TEST_DB = 'skoolos_test';

export default async function globalSetup(): Promise<void> {
  // 1) Drop + create the test database.
  const admin = new Client({ connectionString: SUPER_URL });
  await admin.connect();
  try {
    // Disconnect any users on the test DB first.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TEST_DB],
    );
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await admin.end();
  }

  // 2) Apply migrations using the prisma CLI directly from the db package.
  const dbUrl = `postgresql://skoolos:skoolos@localhost:5432/${TEST_DB}?schema=public`;
  const repoRoot = require('node:path').resolve(__dirname, '../../../../');
  try {
    const out = execSync('pnpm exec prisma migrate deploy', {
      cwd: require('node:path').join(repoRoot, 'packages/db'),
      env: { ...process.env, DATABASE_URL: dbUrl },
      encoding: 'utf8',
    });
    if (process.env.JEST_VERBOSE) console.log(out);
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    // eslint-disable-next-line no-console
    console.error('prisma migrate deploy failed:', err.stdout, err.stderr, err.message);
    throw e;
  }

  // 3) Wire env vars so tests use the test DB across all roles.
  process.env.DATABASE_URL = dbUrl;
  process.env.DISABLE_THROTTLER = 'true';
  process.env.DATABASE_URL_APP = dbUrl.replace(
    'postgresql://skoolos:skoolos',
    'postgresql://skoolos_app:skoolos_app_pw',
  );
  process.env.DATABASE_URL_PLATFORM = dbUrl.replace(
    'postgresql://skoolos:skoolos',
    'postgresql://skoolos_platform:skoolos_platform_pw',
  );
}
