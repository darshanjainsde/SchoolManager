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
 * factored out here once circulation needed the identical check against a
 * Issue's/Reservation's own branch (`issues.service.ts`, `reservations.service.ts`,
 * `fines.service.ts`) — three call sites is past the point a 5-line
 * duplication is the cheaper option.
 */
export function assertBranchInScope(branchId: string, allowedBranches: string[]): void {
  if (allowedBranches.length === 0) return;
  if (!allowedBranches.includes(branchId)) throw new ForbiddenException('Branch out of scope');
}
