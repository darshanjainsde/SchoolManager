import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@library/db';
import { mapPrismaError } from './prisma-errors';

function knownError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: '5.22.0' });
}

describe('mapPrismaError', () => {
  it('maps P2025 (record not found) to NotFoundException', () => {
    expect(() => mapPrismaError(knownError('P2025'), 'title')).toThrow(NotFoundException);
  });

  it('maps P2002 (unique constraint) to ConflictException', () => {
    expect(() => mapPrismaError(knownError('P2002'), 'title')).toThrow(ConflictException);
  });

  it('maps P2003 (foreign key constraint) to ConflictException', () => {
    expect(() => mapPrismaError(knownError('P2003'), 'copy')).toThrow(ConflictException);
  });

  it('includes the caller-supplied label in the message', () => {
    expect(() => mapPrismaError(knownError('P2025'), 'category')).toThrow(/category/);
  });

  it('rethrows an unrecognised Prisma error code unchanged', () => {
    const err = knownError('P9999');
    expect(() => mapPrismaError(err, 'title')).toThrow(err);
  });

  it('rethrows a completely different error type unchanged, never swallowing it', () => {
    const err = new Error('not a prisma error at all');
    expect(() => mapPrismaError(err, 'title')).toThrow(err);
  });
});
