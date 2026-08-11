import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { LibraryTx } from '@library/db';
import type { AddCopyDto, UpdateCopyDto } from './dto';
import { mapPrismaError } from './prisma-errors';

/**
 * Branch authorization for a route that names no `branchId` of its own —
 * `PATCH /catalog/copies/:id` and `GET /catalog/copies/by-barcode/:barcode`
 * act on an existing Copy row, and the branch that matters is a property of
 * THAT row, not of the request. `BranchScopeGuard` cannot enforce this: it
 * only ever sees params/query/body, never a database row. So the check
 * happens here, after the copy is loaded, using the same "empty array means
 * all branches" convention `BranchScopeGuard` uses.
 */
function assertBranchInScope(branchId: string, allowedBranches: string[]): void {
  if (allowedBranches.length === 0) return;
  if (!allowedBranches.includes(branchId)) throw new ForbiddenException('Branch out of scope');
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
      return await tx.copy.create({
        data: {
          orgId,
          titleId,
          branchId: dto.branchId,
          barcode: dto.barcode,
          accessionNumber: dto.accessionNumber,
          shelf: dto.shelf,
          condition: dto.condition,
          acquiredAt: dto.acquiredAt ? new Date(dto.acquiredAt) : undefined,
          acquisitionCost: dto.acquisitionCost,
          status: dto.status,
        },
      });
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

  async getByBarcode(tx: LibraryTx, orgId: string, barcode: string, allowedBranches: string[]) {
    const copy = await tx.copy.findUnique({
      where: { orgId_barcode: { orgId, barcode } },
      include: { title: true, branch: true },
    });
    if (!copy) throw new NotFoundException('Copy not found');
    assertBranchInScope(copy.branchId, allowedBranches);
    return copy;
  }
}
