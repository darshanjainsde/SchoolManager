import { Prisma } from '@skoolos/db';

export function isP2002(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export function isP2003(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003';
}

export function isP2025(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';
}

/**
 * The generated client is ahead of the database: a table (P2021) or a column
 * (P2022) the query names does not exist yet. Readers of a feature whose
 * migration is planned separately from its deploy treat this as "not there
 * yet" instead of failing the whole request.
 */
export function isSchemaMissing(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && (e.code === 'P2021' || e.code === 'P2022');
}

/** Postgres: undefined_table / undefined_column. */
const SCHEMA_MISSING_SQLSTATES = new Set(['42P01', '42703']);

/**
 * The database is behind the code: the NotificationDelivery table or the
 * `expandedAt` column is not there yet. Production deploys code BEFORE the
 * owner runs the migration, so this is an expected state, not a failure.
 * A delegate call reports it as P2021/P2022; a raw statement as P2010 with
 * the Postgres SQLSTATE in `meta.code`. Read by the outbox drain and by the
 * owner console's outbox panel.
 */
export function isDeliverySchemaMissing(e: unknown): boolean {
  if (isSchemaMissing(e)) return true;
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: unknown; meta?: { code?: unknown } | null; message?: unknown };
  if (typeof err.code === 'string' && SCHEMA_MISSING_SQLSTATES.has(err.code)) return true;
  if (typeof err.meta?.code === 'string' && SCHEMA_MISSING_SQLSTATES.has(err.meta.code)) return true;
  return typeof err.message === 'string' && /\b(42P01|42703)\b/.test(err.message);
}

/**
 * Returns the P2002 constraint target as a normalized string.
 * Prisma may set meta.target to a constraint name (string) or an array of
 * column names (string[]). We join arrays so callers can do a simple .includes().
 */
export function p2002Target(e: unknown): string {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError)) return '';
  const target = (e.meta as Record<string, unknown> | undefined)?.target;
  if (Array.isArray(target)) return target.join(',');
  return String(target ?? '');
}
