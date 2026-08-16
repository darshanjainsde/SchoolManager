import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { withTenant } from '@skoolos/db';
import { ApiError } from '../../../common/errors/api-error';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';

/**
 * The librarian's counter is not a generic STAFF surface: any other STAFF
 * login (office, driver, security) must bounce off it. Runs AFTER
 * `SchoolJwtGuard` (which puts the payload on `req.user`) and `RolesGuard`
 * (which has already restricted to STAFF | SCHOOL_ADMIN):
 *
 *  - SCHOOL_ADMIN passes — the admin oversees the library like everything
 *    else (and edits the same settings from Admin → Settings).
 *  - STAFF passes only when their Staff row says `role: LIBRARIAN`.
 *
 * The Staff lookup is one indexed read per request — deliberately not
 * cached, so revoking the librarian role locks the portal on the next
 * request, not after a TTL.
 */
@Injectable()
export class LibrarianGuard implements CanActivate {
  constructor(private readonly tenant: TenantContextService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SchoolJwtPayload }>();
    const user = req.user;
    if (!user) return false;
    if (user.role === 'SCHOOL_ADMIN') return true;
    const { schoolId } = this.tenant.requireTenant();
    const staff = await withTenant(schoolId, (tx) =>
      tx.staff.findFirst({
        where: { userId: user.sub, role: 'LIBRARIAN', isActive: true },
        select: { id: true },
      }),
    );
    if (!staff) {
      throw new ApiError('NOT_LIBRARIAN', 'Only the librarian or a school admin can do this.', 403);
    }
    return true;
  }
}
