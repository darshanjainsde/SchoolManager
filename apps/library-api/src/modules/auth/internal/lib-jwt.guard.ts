import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { loadLibraryEnv } from '../../../config/env';

export interface LibJwtPayload {
  sub: string;
  org: string;
  role: 'ORG_OWNER' | 'LIBRARIAN' | 'ASSISTANT' | 'MEMBER';
  branches: string[];
  aud: 'library';
}

/**
 * There is no global JWT guard — a controller without @UseGuards is
 * unauthenticated. The authz matrix suite is what makes that safe: any endpoint
 * missing from the matrix fails the build.
 */
@Injectable()
export class LibJwtGuard implements CanActivate {
  // @Inject(JwtService) explicitly, not a bare typed param: tsx does not
  // reliably emit design:paramtypes decorator metadata (confirmed at runtime
  // — see auth.controller.ts), so implicit type-based DI silently resolves
  // to undefined instead of throwing at boot.
  constructor(@Inject(JwtService) private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const header = (req.headers.authorization ?? '') as string;
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException();
    let payload: LibJwtPayload;
    try {
      payload = this.jwt.verify<LibJwtPayload>(header.slice(7), {
        secret: loadLibraryEnv().LIBRARY_JWT_SECRET,
        audience: 'library',
      });
    } catch { throw new UnauthorizedException(); }

    // The token's org must match the host-resolved org, or a valid token from
    // one tenant would work against another tenant's subdomain.
    if (req.org?.kind !== 'tenant' || req.org.orgId !== payload.org) throw new UnauthorizedException();
    req.user = payload;
    return true;
  }
}
