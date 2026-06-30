import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { loadEnv } from '@skoolos/config';
import type { Request } from 'express';
import type { TenantContext } from '../../tenancy';

/**
 * Refuses any request not made against the platform host. Even authentication
 * (login/refresh) is gated, so school subdomains can't even attempt to
 * authenticate against the platform credentials.
 *
 * Also enforces an optional IP allowlist for production deployments.
 */
@Injectable()
export class PlatformHostGuard implements CanActivate {
  private readonly env = loadEnv();

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request & { tenant?: TenantContext }>();
    if (req.tenant?.kind !== 'platform') {
      throw new ForbiddenException('Platform endpoints are only available on the owner host');
    }
    const allow = this.env.PLATFORM_IP_ALLOWLIST;
    if (allow.length > 0) {
      const ip = (req.ip ?? req.socket?.remoteAddress ?? '').replace('::ffff:', '');
      if (!allow.includes(ip)) {
        throw new ForbiddenException('IP not permitted on platform host');
      }
    }
    return true;
  }
}
