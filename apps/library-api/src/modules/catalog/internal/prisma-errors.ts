import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@library/db';

/**
 * Translates a Prisma write failure into the HTTP exception a catalogue
 * caller should see, instead of letting a raw PrismaClientKnownRequestError
 * (or a Postgres constraint message) leak out as an unhandled 500.
 *
 *   P2025 — record to update/delete not found            -> 404
 *   P2002 — unique constraint violated (isbn13, barcode,
 *           Author/Category sortName/name)                -> 409
 *   P2003 — foreign key violated (e.g. deleting a title
 *           that still has copies, or a copy/category
 *           pointing at a branch/parent that isn't there)  -> 409
 *
 * Anything else is rethrown unchanged — this is a translation layer, not a
 * catch-all, and an error shape this function doesn't recognise is more
 * useful as its original self than swallowed into a generic 409.
 */
export function mapPrismaError(err: unknown, label: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') throw new NotFoundException(`${label} not found`);
    if (err.code === 'P2002') throw new ConflictException(`${label}: a record with these unique fields already exists`);
    if (err.code === 'P2003') throw new ConflictException(`${label}: blocked by a related record`);
  }
  throw err;
}
