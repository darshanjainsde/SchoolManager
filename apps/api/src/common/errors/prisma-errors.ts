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
