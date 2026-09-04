import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { loadEnv } from '@skoolos/config';
import type { Request } from 'express';
import { TenantContextService } from '../../modules/tenancy';

/**
 * The gate in front of every `/owner/*` route.
 *
 * Two checks, and it is worth being precise about what each one is worth:
 *
 *   1. The tenant context must be `platform`. This is a ROUTING check, not a
 *      security boundary, and the comment that used to imply otherwise was
 *      wrong. Tenant identity is carried by `X-Skoolos-Host`, which the API
 *      has to trust because Vercel rewrites `X-Forwarded-Host` and the API is
 *      on its own hostname — so any client can set it and reach this context.
 *      Verified against staging: `/owner/stats` answers 403 with no header and
 *      401 "Missing bearer token" with `X-Skoolos-Host: owner.<host>`. What
 *      actually stops a school reading platform data is PlatformJwtGuard.
 *
 *   2. The caller's IP must be in PLATFORM_IP_ALLOWLIST, when that list is
 *      non-empty. This is the real perimeter, and it was configured but never
 *      read — `grep -rn PLATFORM_IP_ALLOWLIST` matched only its own
 *      definition in packages/config. It runs BEFORE authentication and so
 *      covers the owner login endpoints, which are `@Public()` and are
 *      otherwise reachable by anyone who can resolve the API.
 *
 * Empty allowlist keeps the previous behaviour exactly (open), so turning this
 * on is a deliberate act and no existing deployment locks itself out.
 */
@Injectable()
export class OwnerHostGuard implements CanActivate {
  private readonly logger = new Logger(OwnerHostGuard.name);
  private readonly env = loadEnv();

  constructor(private readonly tenant: TenantContextService) {}

  canActivate(execCtx: ExecutionContext): boolean {
    const ctx = this.tenant.get();
    if (!ctx || ctx.kind !== 'platform') throw new ForbiddenException('Owner host required');

    const allowlist = this.env.PLATFORM_IP_ALLOWLIST;
    if (allowlist.length === 0) return true;

    const req = execCtx.switchToHttp().getRequest<Request>();
    const ip = clientIp(req);
    if (!ip || !allowlist.includes(ip)) {
      // Logged because a legitimate operator locked out by a changed office IP
      // and an actual probe look identical from the client side.
      this.logger.warn(`Owner console refused for ${ip ?? 'unknown IP'} — not in PLATFORM_IP_ALLOWLIST`);
      throw new ForbiddenException('Owner console is not available from this network');
    }
    return true;
  }
}

/**
 * `trust proxy` is set to 1, so `req.ip` is already the left-most entry of
 * X-Forwarded-For — the client as the edge saw it. Reading the raw header
 * ourselves would take a value the client fully controls.
 */
function clientIp(req: Request): string | null {
  const ip = req.ip ?? req.socket?.remoteAddress ?? null;
  if (!ip) return null;
  // Normalise IPv4-mapped IPv6 (::ffff:203.0.113.4) so operators can write
  // plain dotted quads in the env var.
  return ip.replace(/^::ffff:/, '');
}
