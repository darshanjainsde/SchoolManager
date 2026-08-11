import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { LibJwtPayload } from '../../modules/auth';

/**
 * Pulls the JWT payload `LibJwtGuard` attached to `req.user`. Every route
 * that uses this decorator must sit behind `LibJwtGuard` (same requirement
 * `RolesGuard`/`BranchScopeGuard` already have reading `req.user` directly)
 * — this decorator does not itself enforce that ordering, it only reads
 * whatever is there.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): LibJwtPayload | undefined => {
    const req = ctx.switchToHttp().getRequest();
    return req.user;
  },
);
