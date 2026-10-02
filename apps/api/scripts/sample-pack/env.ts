/**
 * Pins every database variable to ONE scratch database before anything that
 * reads them is imported. @skoolos/db picks DATABASE_URL_APP / _PLATFORM first,
 * so a half-set environment would quietly write to whatever the shell had —
 * this file is imported first, for that reason, and refuses anything that is
 * not a local scratch database.
 */
export const DB_NAME = process.env.PACK_DB ?? 'skoolos_pack';
export const ADMIN_URL = 'postgresql://skoolos:skoolos@localhost:5432/postgres';
export const DB_URL = `postgresql://skoolos:skoolos@localhost:5432/${DB_NAME}?schema=public`;

if (!/^skoolos_pack[a-z0-9_]*$/.test(DB_NAME)) {
  throw new Error(`refusing to build a sample school in "${DB_NAME}" — the scratch database must be named skoolos_pack*`);
}

process.env.DATABASE_URL = DB_URL;
process.env.DIRECT_URL = DB_URL;
process.env.DATABASE_URL_APP = DB_URL;
process.env.DATABASE_URL_PLATFORM = DB_URL;
