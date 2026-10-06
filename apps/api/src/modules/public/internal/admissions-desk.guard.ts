import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { withTenant, type TenantTx } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';

/**
 * Is this login on the admissions desk of this school?
 *
 * An active Staff row whose job is ADMISSIONS, or an active SCHOOL_ADMIN user.
 * One rule, three readers: the guard below, the owner check on PATCH (a lead
 * may only be given to somebody who can open the desk), and — in Tier B — the
 * WhatsApp resolver deciding whether a tap may act.
 *
 * Read on every call, never cached: taking the job away locks the next request.
 */
export async function isAdmissionsDesk(
  db: Pick<TenantTx, 'staff' | 'user'>,
  schoolId: string,
  userId: string,
): Promise<boolean> {
  const officer = await db.staff.findFirst({
    where: { schoolId, userId, role: 'ADMISSIONS', isActive: true },
    select: { id: true },
  });
  if (officer) return true;
  const admin = await db.user.findFirst({
    where: { id: userId, schoolId, role: 'SCHOOL_ADMIN', isActive: true },
    select: { id: true },
  });
  return !!admin;
}

/**
 * WHO WORKS ADMISSIONS — the same door the leave, library and sports desks use.
 *
 * Runs AFTER `RolesGuard` has allowed SCHOOL_ADMIN | STAFF and narrows the STAFF
 * half to the one job that owns this work. A school admin passes without a read.
 */
@Injectable()
export class AdmissionsDeskGuard implements CanActivate {
  constructor(private readonly tenant: TenantContextService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SchoolJwtPayload }>();
    const user = req.user;
    if (!user) return false;
    if (user.role === 'SCHOOL_ADMIN') return true;

    const { schoolId } = this.tenant.requireTenant();
    const ok = await withTenant(schoolId, (tx) => isAdmissionsDesk(tx, schoolId, user.sub));
    if (!ok) {
      throw new ApiError('NOT_ADMISSIONS_DESK', 'Only a school admin or an admissions officer can open the admissions desk.', 403);
    }
    return true;
  }
}
