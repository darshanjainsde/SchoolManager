import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { ApiError } from '../errors/api-error';

/**
 * Constant-time comparison of a caller-supplied credential against the
 * expected secret. `timingSafeEqual` throws on length mismatch, so lengths are
 * checked first — that leaks only the secret's length, not its bytes, which a
 * naive `===` would leak character by character.
 */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
@Injectable()
export class CronSecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const secret = process.env.CRON_SECRET;
    // Fail closed: no configured secret means nothing can ever authenticate.
    if (!secret) {
      throw new ApiError('UNAUTHORIZED', 'Invalid or missing cron secret', 401);
    }

    const req = ctx.switchToHttp().getRequest<Request>();

    const customHeader = req.headers['x-cron-secret'];
    const provided = Array.isArray(customHeader) ? customHeader[0] : customHeader;

    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : undefined;

    if (!secretMatches(provided, secret) && !secretMatches(bearer, secret)) {
      throw new ApiError('UNAUTHORIZED', 'Invalid or missing cron secret', 401);
    }
    return true;
  }
}
