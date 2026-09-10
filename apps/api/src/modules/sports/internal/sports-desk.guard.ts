import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { withTenant } from '@skoolos/db';
import { SPORTS_PERMS, SPORTS_PERM_LABELS, effectiveSportsPerms, type SportsPerm } from '@skoolos/types';
import { ApiError } from '../../../common/errors/api-error';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import { TenantContextService } from '../../tenancy';
import { SPORTS_PERM_KEY } from './sports-perm.decorator';

/**
 * The sports desk door — the library's `LibrarianGuard` with one more job.
 * Runs AFTER `SchoolJwtGuard` and `RolesGuard` (STAFF | SCHOOL_ADMIN):
 *
 *  - SCHOOL_ADMIN passes with every permission — the admin runs the desk
 *    from /app/sports exactly as the sports teacher does from /sports.
 *  - STAFF passes only with `Staff.role = SPORTS`, active; their effective
 *    permissions come from `Staff.sportsPerms` (empty → the defaults).
 *  - A route tagged `@SportsPerm('PUBLISH')` also needs that permission.
 *
 * One indexed read per request, never cached: taking a right away locks the
 * next request, not a TTL later. The resolved list rides on `req.sportsPerms`
 * so the shell can show only the buttons the teacher may press.
 */
@Injectable()
export class SportsDeskGuard implements CanActivate {
  constructor(private readonly tenant: TenantContextService, private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: SchoolJwtPayload; sportsPerms?: SportsPerm[] }>();
    const user = req.user;
    if (!user) return false;
    const need = this.reflector.getAllAndOverride<SportsPerm | undefined>(SPORTS_PERM_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (user.role === 'SCHOOL_ADMIN') {
      req.sportsPerms = [...SPORTS_PERMS];
      return true;
    }
    const { schoolId } = this.tenant.requireTenant();
    const staff = await withTenant(schoolId, (tx) =>
      tx.staff.findFirst({
        where: { schoolId, userId: user.sub, role: 'SPORTS', isActive: true },
        select: { id: true, sportsPerms: true },
      }),
    );
    if (!staff) throw new ApiError('NOT_SPORTS_DESK', 'Only the sports teacher or a school admin can do this.', 403);
    const perms = effectiveSportsPerms(staff.sportsPerms);
    req.sportsPerms = perms;
    if (need && !perms.includes(need)) {
      throw new ApiError('SPORTS_PERM', `Your sports desk does not include "${SPORTS_PERM_LABELS[need]}". Ask the office to add it.`, 403);
    }
    return true;
  }
}
