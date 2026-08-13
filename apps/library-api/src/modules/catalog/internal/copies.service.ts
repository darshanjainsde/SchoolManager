import { Injectable, NotFoundException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import { assertBranchInScope } from '../../../common/guards/assert-branch-in-scope';
import { REPLACEMENT_PRICE_MAX, type AddCopyDto, type UpdateCopyDto } from './dto';
import { mapPrismaError } from './prisma-errors';

/**
 * Seeds `Title.replacementPrice` from the price paid for a copy being added —
 * but ONLY while the title has no price of its own, and never overwriting one a
 * librarian has since set. On the day a book is bought, what the school paid IS
 * what it costs to replace; the design is that the two are allowed to diverge
 * afterwards, so this seed is strictly one-way.
 *
 * Written as a single conditional UPDATE, deliberately NOT as read-then-write.
 * A transaction gives atomicity, not mutual exclusion (LIBRARY-TRAPS #3): under
 * READ COMMITTED, two clerks adding copies of the same title concurrently would
 * both read NULL, both decide to write, and the later commit would silently
 * clobber the earlier one. `updateMany` compiles to `UPDATE "Title" SET ...
 * WHERE id = $1 AND "replacementPrice" IS NULL`, and Postgres re-evaluates that
 * WHERE against the updated row after the first transaction commits — so the
 * second one matches zero rows and does nothing. No advisory lock needed: the
 * row lock plus the predicate is the whole guarantee.
 *
 * Runs on the caller's `tx`, i.e. inside the same interactive transaction as
 * the copy creation, so a rolled-back copy can never leave a seeded price
 * behind. It adds one statement to a path that does four, comfortably inside
 * Prisma's default 5s interactive-transaction budget, so no explicit timeout is
 * needed here.
 *
 * A no-op when the copy carries no `acquisitionCost` — a copy added with no
 * price tells us nothing about what a replacement costs, and seeding 0 would be
 * far worse than leaving it unset: 0 reads as "this book is free to replace".
 */
async function seedReplacementPrice(
  tx: LibraryTx,
  titleId: string,
  acquisitionCost: number | undefined,
): Promise<void> {
  if (acquisitionCost === undefined || acquisitionCost === null) return;

  // Bounded here as well as in `AddCopyDto`, because this function is a
  // service-level entry point: an e2e, a future admin script or a bulk tool
  // calls `CopiesService.add` directly, with no ValidationPipe between it and
  // the database. A price the API would reject must not reach a parent's bill
  // through a path that skipped the pipe — and a negative would otherwise trip
  // `Title_replacementPrice_nonnegative`, which Prisma reports without a `.code`
  // and `mapPrismaError` therefore turns into a 500 that also rolls back the
  // copy. Out-of-range is skipped rather than thrown: the copy itself is still
  // a legitimate thing to record, and the price is the part we decline to guess.
  if (!Number.isFinite(acquisitionCost)) return;
  if (acquisitionCost < 0 || acquisitionCost > REPLACEMENT_PRICE_MAX) return;

  await tx.title.updateMany({
    where: { id: titleId, replacementPrice: null },
    data: { replacementPrice: acquisitionCost },
  });
}

@Injectable()
export class CopiesService {
  async add(tx: LibraryTx, orgId: string, titleId: string, dto: AddCopyDto) {
    // Checked explicitly rather than relying on the FK error alone: a
    // missing title should read as "title not found" (404), not the more
    // generic "blocked by a related record" (409) `mapPrismaError` gives a
    // bare P2003 elsewhere.
    const title = await tx.title.findUnique({ where: { id: titleId }, select: { id: true } });
    if (!title) throw new NotFoundException('Title not found');

    // Same reasoning, same pattern, for dto.branchId: it is a client-supplied
    // foreign key. Postgres FK constraints are satisfied by a row RLS would
    // never let this caller see (referential-integrity checks bypass RLS by
    // design), so without this lookup a LIBRARIAN could hand another org's
    // branch UUID and get a Copy row that structurally references it. Doing
    // the lookup on `tx` — inside the same withOrg transaction as the write
    // below — means it is RLS-scoped to this org and race-free (a lookup on a
    // separate connection would be a TOCTOU).
    const branch = await tx.branch.findUnique({ where: { id: dto.branchId }, select: { id: true } });
    if (!branch) throw new NotFoundException('Branch not found');

    try {
      const copy = await tx.copy.create({
        data: {
          orgId,
          titleId,
          branchId: dto.branchId,
          accessionNumber: dto.accessionNumber,
          shelf: dto.shelf,
          condition: dto.condition,
          acquiredAt: dto.acquiredAt ? new Date(dto.acquiredAt) : undefined,
          acquisitionCost: dto.acquisitionCost,
          status: dto.status,
        },
      });

      await seedReplacementPrice(tx, titleId, dto.acquisitionCost);
      return copy;
    } catch (err) {
      mapPrismaError(err, 'copy');
    }
  }

  async update(tx: LibraryTx, id: string, dto: UpdateCopyDto, allowedBranches: string[]) {
    // Loaded first (rather than going straight to `tx.copy.update`) so the
    // branch check below has something to check against — the branch this
    // request is scoped to is a property of the existing row, not of the
    // PATCH body, which carries no branchId at all.
    const existing = await tx.copy.findUnique({ where: { id }, select: { id: true, branchId: true } });
    if (!existing) throw new NotFoundException('Copy not found');
    assertBranchInScope(existing.branchId, allowedBranches);

    try {
      return await tx.copy.update({
        where: { id },
        data: {
          accessionNumber: dto.accessionNumber,
          shelf: dto.shelf,
          condition: dto.condition,
          acquisitionCost: dto.acquisitionCost,
          status: dto.status,
        },
      });
    } catch (err) {
      mapPrismaError(err, 'copy');
    }
  }

  async getByAccessionNumber(tx: LibraryTx, orgId: string, accessionNumber: string, allowedBranches: string[]) {
    const copy = await tx.copy.findUnique({
      where: { orgId_accessionNumber: { orgId, accessionNumber } },
      include: { title: true, branch: true },
    });
    if (!copy) throw new NotFoundException('Copy not found');
    assertBranchInScope(copy.branchId, allowedBranches);
    return copy;
  }
}
