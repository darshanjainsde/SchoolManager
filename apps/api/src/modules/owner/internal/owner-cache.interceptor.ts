import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { OwnerOverviewService } from './owner-overview.service';

/**
 * Drops the cached dashboard payload after any write through the owner console.
 *
 * The overview is one Redis key with a 120s TTL, because it aggregates every
 * school's students, images and enquiries and must not run per view. Nothing
 * cleared it, so for two minutes after a write the console showed the world as
 * it was BEFORE: a school you just created was missing from the dashboard, a
 * publish left the LIVE count unmoved, an attached domain left the column
 * blank. The operator's reasonable conclusion is that the action failed — so
 * they do it again, which is how you end up with two schools of the same name.
 *
 * WHY AN INTERCEPTOR, and not `invalidate()` at each call site: the call-site
 * version needs nine of them today, and needs the next person who adds an
 * owner mutation to remember a tenth. That is a convention, and conventions
 * are what this codebase already refuses elsewhere (see tenancy-bypass.spec).
 * Here the rule is structural — "a write through this controller invalidates
 * the dashboard" holds for endpoints nobody has written yet.
 *
 * Cost: one Redis DEL on non-GET owner requests, which are rare and already
 * doing database writes. Over-invalidating (a blog moderation drops the cache
 * too) costs one recompute; under-invalidating costs the operator's trust in
 * the page. The trade is not close.
 */
@Injectable()
export class OwnerCacheInterceptor implements NestInterceptor {
  private static readonly READ_ONLY = new Set(['GET', 'HEAD', 'OPTIONS']);

  constructor(private readonly overview: OwnerOverviewService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (OwnerCacheInterceptor.READ_ONLY.has(req.method)) return next.handle();

    // After the handler resolves, never before: a write that throws must not
    // pay the cost, and a cache dropped ahead of a failed write would be
    // refilled from the same state anyway.
    return next.handle().pipe(
      tap({
        next: () => {
          // Fire-and-forget. `invalidate` swallows its own errors, and the TTL
          // is the backstop — a Redis blip must never fail the operator's write
          // after it has already committed.
          void this.overview.invalidate();
        },
      }),
    );
  }
}
