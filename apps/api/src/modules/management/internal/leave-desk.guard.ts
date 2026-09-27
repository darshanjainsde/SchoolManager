import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';

/**
 * WHO DECIDES LEAVE — the same door the library and sports desks use.
 *
 * Runs AFTER `RolesGuard` has already allowed SCHOOL_ADMIN | STAFF, and
 * narrows the STAFF half to the one job that owns this work:
 *
 *  - SCHOOL_ADMIN passes. Deciding leave has always been theirs.
 *  - STAFF passes only with `Staff.role = ACCOUNTS`, active.
 *
 * DELIBERATELY NOT `canSeeSalary`. That flag guards SALARY FIGURES, and a
 * leave register holds none — it holds dates and reasons. An accounts officer
 * who has not been shown the pay book can still approve a driver's two days,
 * which is most of what the job is. The moment leave turns into money it goes
 * through `SalaryGuard` instead, on the payroll controller, which does ask.
 *
 * One indexed read per request, never cached: taking the job away locks the
 * next request rather than a TTL later.
 */
@Injectable()
export class LeaveDeskGuard implements CanActivate {
  constructor(private readonly tenant: TenantContextService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SchoolJwtPayload }>();
    const user = req.user;
    if (!user) return false;
    if (user.role === 'SCHOOL_ADMIN') return true;

    const { schoolId } = this.tenant.requireTenant();
    const staff = await withTenant(schoolId, (tx) =>
      tx.staff.findFirst({
        where: { schoolId, userId: user.sub, role: 'ACCOUNTS', isActive: true },
        select: { id: true },
      }),
    );
    if (!staff) {
      throw new ApiError('NOT_LEAVE_DESK', 'Only a school admin or an accounts officer can decide leave.', 403);
    }
    return true;
  }
}
