import { ApiError } from '../errors/api-error';

/**
 * Prove that a client-supplied foreign-key id belongs to the caller's own
 * school, BEFORE storing it.
 *
 * WHY THE DATABASE CANNOT DO THIS FOR YOU. Postgres checks referential
 * integrity outside row-level security, by design. A foreign key is satisfied
 * by a row the caller can neither see nor read, so writing
 *
 *     tx.diaryEntry.create({ data: { schoolId, subjectId: dto.subjectId } })
 *
 * inside `withTenant` is NOT protected by RLS on the `subjectId` side. The
 * policy's WITH CHECK validates the new row's OWN `schoolId` column — it says
 * nothing about what the row points AT. So a caller who supplies another
 * school's subject id gets a row that passes every database constraint and
 * quietly holds a cross-tenant reference. This repo's mistake ledger already
 * records it happening once (`client-supplied-fk-not-org-checked`).
 *
 * The only place this can be closed is application code, and the check is
 * always the same shape: read the id back through the tenant-bound client. If
 * RLS hides it, it is not ours.
 *
 * HOW TO USE IT. Pass the tenant transaction's delegate for each referenced
 * model, inside `withTenant`:
 *
 *     await assertTenantOwned([
 *       { field: 'subjectId', id: dto.subjectId, model: tx.subject },
 *       { field: 'classSectionId', id: dto.classSectionId, model: tx.classSection },
 *     ]);
 *
 * `null`/`undefined` ids are skipped, so optional references need no special
 * casing at the call site. The lookups run concurrently.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not check that the caller is
 * ALLOWED to use the reference — that a teacher owns the class, that an admin
 * may write this subject. That is authorisation and stays with the callers
 * that already do it (`requireClassAccess`, `assertClassOwned`). This answers
 * only the narrower question the database refuses to: does this id belong to
 * this tenant at all?
 */

/**
 * The slice of a Prisma model delegate this needs. Declared structurally
 * rather than importing Prisma's generated delegate types, so a call site can
 * pass `tx.subject` without the helper having to name every model.
 */
export interface TenantScopedFinder {
  findFirst(args: {
    where: { id: string };
    select: { id: true };
  }): Promise<{ id: string } | null>;
}

export interface TenantOwnedRef {
  /** The DTO field name, used as the error's `field` so the UI can point at it. */
  field: string;
  id: string | null | undefined;
  model: TenantScopedFinder;
}

export async function assertTenantOwned(refs: TenantOwnedRef[]): Promise<void> {
  const present = refs.filter((r): r is TenantOwnedRef & { id: string } => !!r.id);

  const found = await Promise.all(
    present.map((r) => r.model.findFirst({ where: { id: r.id }, select: { id: true } })),
  );

  const missing = present.filter((_, i) => found[i] === null);
  if (missing.length === 0) return;

  // 400 rather than 404: from the caller's side this is a malformed request
  // referencing something that does not exist for them. It deliberately does
  // not distinguish "no such id anywhere" from "belongs to another school" —
  // that difference is exactly what an attacker would use to enumerate.
  const fields = missing.map((r) => r.field);
  throw new ApiError(
    'VALIDATION',
    `${fields.join(', ')} not found in this school`,
    400,
    fields[0],
  );
}
