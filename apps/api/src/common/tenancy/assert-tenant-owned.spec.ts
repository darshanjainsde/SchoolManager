import { assertTenantOwned, type TenantScopedFinder } from './assert-tenant-owned';
import { ApiError } from '../errors/api-error';

/**
 * A stand-in for a Prisma model delegate reached through `withTenant`. It
 * returns a row only for the ids that "belong to this school" — which is
 * precisely what row-level security does to a real delegate: another school's
 * row is not an error, it is simply not there.
 */
function finder(ownedIds: string[]): TenantScopedFinder & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async findFirst({ where }) {
      calls.push(where.id);
      return ownedIds.includes(where.id) ? { id: where.id } : null;
    },
  };
}

describe('assertTenantOwned', () => {
  it('passes an id the tenant can see', async () => {
    await expect(
      assertTenantOwned([{ field: 'subjectId', id: 'sub-1', model: finder(['sub-1']) }]),
    ).resolves.toBeUndefined();
  });

  /**
   * The whole point. Under RLS another school's subject reads back as null,
   * and the foreign key alone would NOT have caught it — Postgres checks
   * referential integrity outside row-level security.
   */
  it('rejects an id belonging to another school', async () => {
    await expect(
      assertTenantOwned([{ field: 'subjectId', id: 'other-school-subject', model: finder([]) }]),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('reports the offending field so the UI can point at it', async () => {
    const err = await assertTenantOwned([
      { field: 'subjectId', id: 'nope', model: finder([]) },
    ]).catch((e: ApiError) => e.getResponse() as Record<string, unknown>);

    expect(err).toMatchObject({ code: 'VALIDATION', field: 'subjectId' });
    expect(err).toHaveProperty('message', 'subjectId not found in this school');
  });

  it('names every bad reference, not just the first', async () => {
    const err = await assertTenantOwned([
      { field: 'subjectId', id: 'a', model: finder([]) },
      { field: 'classSectionId', id: 'b', model: finder([]) },
    ]).catch((e: ApiError) => e.getResponse() as Record<string, unknown>);

    expect(err).toHaveProperty('message', 'subjectId, classSectionId not found in this school');
  });

  /**
   * The message must not distinguish "no such id anywhere" from "belongs to
   * another school" — that difference is what turns a validation error into an
   * enumeration oracle.
   */
  it('does not reveal whether a rejected id exists elsewhere', async () => {
    const absent = await assertTenantOwned([
      { field: 'subjectId', id: 'does-not-exist', model: finder([]) },
    ]).catch((e: ApiError) => e.getResponse() as Record<string, unknown>);

    const foreign = await assertTenantOwned([
      { field: 'subjectId', id: 'other-school', model: finder([]) },
    ]).catch((e: ApiError) => e.getResponse() as Record<string, unknown>);

    expect(absent).toEqual(foreign);
  });

  it('skips null and undefined ids so optional references need no special casing', async () => {
    const subject = finder([]);

    await expect(
      assertTenantOwned([
        { field: 'subjectId', id: null, model: subject },
        { field: 'otherId', id: undefined, model: subject },
      ]),
    ).resolves.toBeUndefined();

    expect(subject.calls).toEqual([]);
  });

  it('checks each reference against its own model', async () => {
    const subject = finder(['sub-1']);
    const section = finder(['sec-1']);

    await assertTenantOwned([
      { field: 'subjectId', id: 'sub-1', model: subject },
      { field: 'classSectionId', id: 'sec-1', model: section },
    ]);

    expect(subject.calls).toEqual(['sub-1']);
    expect(section.calls).toEqual(['sec-1']);
  });
});
