import { CanActivate, ExecutionContext } from '@nestjs/common';
/**
 * Protects internal cron-triggered endpoints (no user/tenant JWT exists for
 * a Vercel Cron invocation). Requires `process.env.CRON_SECRET` to be set
 * AND to match one of:
 *   - header `x-cron-secret` (the primary contract for this endpoint), or
 *   - header `Authorization: Bearer <secret>` — Vercel Cron Jobs
 *     automatically send this when a `CRON_SECRET` env var is configured on
 *     the project, so accepting it too means the built-in Vercel Cron
 *     trigger authenticates without any extra configuration.
 * If `CRON_SECRET` is unset or empty, or neither header matches, the request
 * is rejected with 401 — an unset secret must fail closed, never open.
 */
export declare class CronSecretGuard implements CanActivate {
    canActivate(ctx: ExecutionContext): boolean;
}
//# sourceMappingURL=cron-secret.guard.d.ts.map