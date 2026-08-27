import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { loadEnv } from '@skoolos/config';
import type { SchoolJwtPayload } from '../../../common/auth/jwt-payload';
import type { Request } from 'express';
import { TenantContextService } from '../../tenancy';
import { AlumniAuthService, type AlumniIdentity } from './alumni-auth.service';

/**
 * Guards every alumnus-facing route.
 *
 * `@Inject()` is explicit on both dependencies, not decorative. LIBRARY-TRAPS #6:
 * `tsx` does not reliably emit `design:paramtypes`, so a bare-typed constructor
 * parameter can resolve to `undefined` — and in a guard, `undefined` means
 * failing OPEN. A guard that silently stops guarding is the worst defect shape
 * available, so the injection is spelled out.
 */
export const ALUMNI_TRUSTED_KEY = 'alumni:trustedForStudents';

/**
 * Marks a route as reachable only by an alumnus the school has cleared to work
 * with students. Being a verified alumnus gets you the directory; it does not
 * get you a room full of fourteen-year-olds.
 */
export const RequireTrustedAlumnus = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALUMNI_TRUSTED_KEY, true);

/** What the guard hangs on the request for `@CurrentAlumnus()` to read. */
export interface AlumniRequest extends Request {
  alumnus?: AlumniIdentity;
}

@Injectable()
export class AlumniSessionGuard implements CanActivate {
  private readonly env = loadEnv();

  constructor(
    @Inject(AlumniAuthService) private readonly auth: AlumniAuthService,
    @Inject(TenantContextService) private readonly tenant: TenantContextService,
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(JwtService) private readonly jwt: JwtService,
  ) {}

  /**
   * The third door: an ordinary school JWT whose role is ALUMNUS.
   *
   * Verified with the SAME secret and audience as `SchoolJwtGuard`, and the
   * schoolId in the token must match the host — a token minted for school A is
   * not a session at school B. Anything less than all three checks would make
   * this a way around the school guard rather than a second entrance to it.
   */
  private fromSchoolJwt(token: string, schoolId: string): Promise<AlumniIdentity | null> | null {
    let payload: SchoolJwtPayload;
    try {
      payload = this.jwt.verify<SchoolJwtPayload>(token, {
        secret: this.env.JWT_SCHOOL_ACCESS_SECRET,
        audience: 'school',
      });
    } catch {
      return null;
    }
    if (payload.aud !== 'school') return null;
    if (payload.schoolId !== schoolId) return null;
    if (payload.role !== 'ALUMNUS') return null;
    if (!payload.sub) return null;
    return this.auth.resolveSchoolUser(schoolId, payload.sub);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = this.tenant.requireTenant();
    if (ctx.kind !== 'tenant') throw new UnauthorizedException('No school for this host');

    const req = context.switchToHttp().getRequest<AlumniRequest>();
    const token = readToken(req);
    if (!token) throw new UnauthorizedException('Sign in with your link');

    // An AlumniAccessToken first — it is what the link and the alumni-page
    // login both mint, and it is the common case. Only if that fails is the
    // token tried as a school JWT, so the ordinary path costs no extra work.
    const alumnus =
      (await this.auth.resolveSession(ctx.schoolId, token)) ??
      (await this.fromSchoolJwt(token, ctx.schoolId));
    // Both paths re-read status and isDeceased on EVERY request, so the office
    // un-verifying somebody takes effect on their next call rather than
    // whenever their ninety-day session happens to lapse.
    if (!alumnus) throw new UnauthorizedException('That link is not valid any more');

    const needsTrust = this.reflector.getAllAndOverride<boolean>(ALUMNI_TRUSTED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (needsTrust && !alumnus.trustedForStudents) {
      throw new ForbiddenException(
        'The school has not cleared you to work with students. Ask the office.',
      );
    }

    req.alumnus = alumnus;
    return true;
  }
}

/**
 * Bearer header first, then the cookie the web app sets.
 *
 * Deliberately NOT a query parameter: a token in a URL lands in server logs,
 * in Referer headers on every outbound link, and in whatever the alumnus pastes
 * into a group chat when they share "the page". The one place a raw token
 * legitimately appears in a URL is the single-use claim link, which is redeemed
 * once and dead thereafter.
 */
function readToken(req: AlumniRequest): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  const cookies = (req as unknown as { cookies?: Record<string, string> }).cookies;
  return cookies?.sk_alumni ?? null;
}
