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
