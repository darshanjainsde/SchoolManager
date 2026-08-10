import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

/**
 * Org isolation is the SECURITY boundary and lives in Postgres (RLS).
 * Branch is an AUTHORIZATION boundary and lives here — so its failure mode is a
 * 403, not a cross-tenant read. An empty `branches` array means "all branches".
 */
@Injectable()
export class BranchScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const branches: string[] = req.user?.branches ?? [];
    if (branches.length === 0) return true;
    const requested = req.params?.branchId ?? req.query?.branchId;
    if (!requested) return true;
    if (!branches.includes(requested)) throw new ForbiddenException('Branch out of scope');
    return true;
  }
}
