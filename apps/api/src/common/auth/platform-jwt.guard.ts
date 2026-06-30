import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '@skoolos/config';
import type { Request } from 'express';
import type { TenantContext } from '../../modules/tenancy';
import type { PlatformJwtPayload } from './jwt-payload';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Verifies the request bears a platform-audience access token AND that it
 * arrives on the platform host. Both checks are required: a stolen platform
 * token cannot be used against a tenant subdomain, and a school user cannot
 * be granted platform access even on the right host without a platform token.
 */
@Injectable()
export class PlatformJwtGuard implements CanActivate {
  private readonly env = loadEnv();

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { tenant?: TenantContext; user?: PlatformJwtPayload }>();
    if (req.tenant?.kind !== 'platform') {
      // School users have no path to the platform host — even with a valid
      // platform token, requests on a tenant host are denied.
      throw new ForbiddenException('Platform endpoints are only available on the owner host');
    }

    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: PlatformJwtPayload;
    try {
      payload = this.jwt.verify<PlatformJwtPayload>(token, {
        secret: this.env.JWT_PLATFORM_ACCESS_SECRET,
        audience: 'platform',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.aud !== 'platform') throw new UnauthorizedException('Wrong audience');
    req.user = payload;
    return true;
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token;
}
