import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../errors/api-error';
import type { SchoolJwtPayload } from './jwt-payload';
import { TenantContextService } from '../../modules/tenancy';
import { STAFF_ROLES } from './staff-role.decorator';
import type { StaffRole } from '@skoolos/db';

/**
 * Narrows a STAFF login to particular kinds of staff.
 *
 * Generalises LibrarianGuard. An audit on 4 Sept 2026 signed in as a seeded
 * OFFICE login and reached the payment-gateway credentials, the bank account
 * fees are routed to, payment reversal and certificate issuance — which was
 * the intent for the office, but `@Roles('SCHOOL_ADMIN','STAFF')` cannot say
 * "the office". It admits every staff kind, so the school's driver, helper and
 * security logins reached the same routes. fees-authz.e2e-spec.ts had already
 * written the intended rule in its own header: "Every /manage/fees/* route:
 * office only."
 *
 * Runs after SchoolJwtGuard (which sets req.user) and RolesGuard (which has
 * already narrowed to STAFF | SCHOOL_ADMIN):
 *
 *  - SCHOOL_ADMIN passes — the admin oversees every desk.
 *  - STAFF passes only when their Staff row names one of the listed roles.
 *  - No @StaffRoles on the handler or class means no narrowing, so adding the
 *    guard somewhere without the decorator changes nothing.
 *
 * One indexed read per request, deliberately uncached: moving someone off the
 * front desk locks them out on their next request, not after a TTL.
 */
@Injectable()
export class StaffScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenant: TenantContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const allowed = this.reflector.getAllAndOverride<StaffRole[] | undefined>(STAFF_ROLES, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!allowed || allowed.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: SchoolJwtPayload }>();
    const user = req.user;
    if (!user) return false;
    if (user.role === 'SCHOOL_ADMIN') return true;
    if (user.role !== 'STAFF') return true; // RolesGuard already decided this one

    const { schoolId } = this.tenant.requireTenant();
    const staff = await withTenant(schoolId, (tx) =>
      tx.staff.findFirst({
        where: { schoolId, userId: user.sub, role: { in: allowed }, isActive: true },
        select: { id: true },
      }),
    );
    if (!staff) {
      throw new ApiError(
        'STAFF_ROLE_NOT_PERMITTED',
        'Your staff role does not cover this. Ask a school admin.',
        403,
      );
    }
    return true;
  }
}
