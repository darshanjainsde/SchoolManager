import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { ApiError } from '../../common/errors/api-error';

/**
 * Protects internal cron-triggered endpoints (no user/tenant JWT exists for
 * a Vercel Cron invocation). Requires `process.env.CRON_SECRET` to be set
 * AND to match one of:
 *   - header `x-cron-secret` (the primary contract for this endpoint), or
 *   - header `Authorization: Bearer <secret>` — Vercel Cron Jobs
 *     automatically send this when a `CRON_SECRET` env var is configured on
 *     the project, so accepting it too means the built-in Vercel Cron
 *     trigger authenticates without any extra configuration.
 * If `CRON_SECRET` is unset, or neither header matches, the request is
 * rejected with 401 — an unset secret must fail closed, never open.
 */
@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const secret = process.env.CRON_SECRET;
    const req = ctx.switchToHttp().getRequest<Request>();

    const customHeader = req.headers['x-cron-secret'];
    const provided = Array.isArray(customHeader) ? customHeader[0] : customHeader;

    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    const matches = Boolean(secret) && (provided === secret || bearer === secret);
    if (!matches) {
      throw new ApiError('FORBIDDEN_FEATURE', 'Invalid or missing cron secret', 401);
    }
    return true;
  }
}
