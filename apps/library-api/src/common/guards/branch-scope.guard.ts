import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Org isolation is the SECURITY boundary and lives in Postgres (RLS).
 * Branch is an AUTHORIZATION boundary and lives here — so its failure mode is a
 * 403, not a cross-tenant read. An empty `branches` array means "all branches".
 *
 * This only catches a `branchId` the request carries directly, in a param, a
 * query string, or the body (e.g. `AddCopyDto.branchId`). Some routes act on
 * an existing resource whose branch is a property of a row already in the
 * database, not of the request (`PATCH /catalog/copies/:id`,
 * `GET /catalog/copies/by-accessionNumber/:accessionNumber`) — this guard cannot know that
 * without a database read, so those routes enforce branch scope themselves,
 * in the service, after loading the row (see CopiesService.update /
 * getByAccessionNumber).
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const branches: string[] = req.user?.branches ?? [];
    if (branches.length === 0) return true;
    const requested = req.params?.branchId ?? req.query?.branchId ?? req.body?.branchId;
    if (!requested) return true;
    if (!branches.includes(requested)) throw new ForbiddenException('Branch out of scope');
    return true;
  }
}
