-- Local mirror of the staging bootstrap SQL.
--
-- This exists so the RLS tests run against a NON-SUPERUSER, which is the whole
-- point: a superuser silently bypasses row-level security, so connecting as
-- `postgres` would make every isolation test pass whether the policies work or
-- not. `library_app` is the role the app actually uses, and it has no BYPASSRLS.
--
-- Passwords here are local-only throwaways. Staging and production use
-- generated secrets held in GitHub environment secrets and Vercel env.

-- NOTE: `prisma migrate reset` DROPS AND RECREATES the library schema, and the
-- default privileges below go with it. Re-run this file after any reset, or the
-- next table created by `postgres` is invisible to library_app/library_platform
-- in information_schema — which silently blinds the RLS coverage audit rather
-- than failing it.
CREATE SCHEMA IF NOT EXISTS library;
CREATE SCHEMA IF NOT EXISTS testboard;

CREATE ROLE library_app      LOGIN PASSWORD 'library_app';
CREATE ROLE library_platform LOGIN PASSWORD 'library_platform' BYPASSRLS;
CREATE ROLE testboard_app    LOGIN PASSWORD 'testboard_app';

GRANT USAGE ON SCHEMA library   TO library_app, library_platform;
GRANT USAGE ON SCHEMA testboard TO testboard_app;

-- Migrations run as `postgres`, so the default privileges must be attached to
-- that role for tables created later to be reachable by the app roles.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA library
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO library_app, library_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA library
  GRANT USAGE, SELECT ON SEQUENCES TO library_app, library_platform;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA testboard
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO testboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA testboard
  GRANT USAGE, SELECT ON SEQUENCES TO testboard_app;
