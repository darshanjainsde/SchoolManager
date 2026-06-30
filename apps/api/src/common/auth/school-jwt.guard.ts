import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '@skoolos/config';
import type { Request } from 'express';
import type { TenantContext } from '../../modules/tenancy';
import type { SchoolJwtPayload } from './jwt-payload';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Verifies the request bears a school-audience access token AND that the
 * token's schoolId matches the schoolId the tenant-resolution middleware
 * derived from the host. A token issued for school A cannot be replayed
 * against school B's subdomain.
 */
@Injectable()
export class SchoolJwtGuard implements CanActivate {
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

    const req = ctx.switchToHttp().getRequest<Request & { tenant?: TenantContext; user?: SchoolJwtPayload }>();
    const tenant = req.tenant;
    if (!tenant || tenant.kind !== 'tenant') {
      throw new UnauthorizedException('Tenant context required');
    }

    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing bearer token');

    let payload: SchoolJwtPayload;
    try {
      payload = this.jwt.verify<SchoolJwtPayload>(token, {
        secret: this.env.JWT_SCHOOL_ACCESS_SECRET,
        audience: 'school',
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (payload.aud !== 'school' || payload.schoolId !== tenant.schoolId) {
      // Token from another school replayed at this subdomain.
      throw new UnauthorizedException('Token does not match this tenant');
    }

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
