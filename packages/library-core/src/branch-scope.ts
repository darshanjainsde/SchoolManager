import { ForbiddenException } from '@nestjs/common';

/**
 * Branch authorization for a route that names no `branchId` of its own — the
 * branch that matters is a property of an existing row (a Copy, a Issue, a
 * Reservation, ...) already loaded from the database, not of the request.
 * `BranchScopeGuard` cannot enforce this on its own: it only ever sees
 * params/query/body, never a database row. So this check runs in the
 * service, AFTER the row is loaded, using the same "empty array means all
 * branches" convention `BranchScopeGuard` uses.
 *
 * Originally local to `catalog/internal/copies.service.ts` (see
 * `PATCH /catalog/copies/:id` / `GET /catalog/copies/by-accessionNumber/:accessionNumber`);
 * factored out into `apps/library-api/src/common/guards/` once circulation
 * needed the identical check against a Issue's/Reservation's own branch.
 *
 * Moved HERE when `issue`/`returnBook`/`renew` moved into `@library/core`:
 * those three call it, and `@library/core` cannot import from
 * `apps/library-api`. `common/guards/assert-branch-in-scope.ts` re-exports
 * this so the catalog/periods/fines call sites are unchanged, and there is
 * still exactly one implementation of "is this row's branch in my scope".
 */
export function assertBranchInScope(branchId: string, allowedBranches: string[]): void {
  if (allowedBranches.length === 0) return;
  if (!allowedBranches.includes(branchId)) throw new ForbiddenException('Branch out of scope');
}
