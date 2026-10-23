import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, createParamDecorator } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getPlatformPrisma } from '@skoolos/db';
import type { Promoter } from '@skoolos/db';
import { createHmac } from 'node:crypto';
import { loadEnv } from '@skoolos/config';
import type { Request } from 'express';
import type { PromoterJwtPayload } from '../../common/auth/jwt-payload';

/** Distinct from both real secrets, derived so no new env var is needed anywhere. */
export function promoterSecret(platformSecret: string): string {
  return createHmac('sha256', platformSecret).update('promoter').digest('hex');
}

export const PROMOTER_TOKEN_TTL_S = 30 * 24 * 3600;

export type PromoterRequest = Request & { promoter?: Promoter; user?: PromoterJwtPayload };

/**
 * A promoter session: a promoter-audience token whose `ver` still matches the
 * row. The row is loaded on every request (one indexed read) so a suspension
 * or removal takes effect at the next call, not at expiry. Suspended promoters
 * may still sign in and read — the portal tells them why — but every write
 * goes through `requireActive` in the service.
 */
@Injectable()
export class PromoterJwtGuard implements CanActivate {
  private readonly env = loadEnv();
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PromoterRequest>();
    const h = req.headers.authorization;
    const token = typeof h === 'string' && h.startsWith('Bearer ') ? h.slice(7).trim() : null;
    if (!token) throw new UnauthorizedException('Missing bearer token');
    let payload: PromoterJwtPayload;
    try {
      payload = this.jwt.verify<PromoterJwtPayload>(token, { secret: promoterSecret(this.env.JWT_PLATFORM_ACCESS_SECRET), audience: 'promoter' });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    if (payload.aud !== 'promoter') throw new UnauthorizedException('Wrong audience');
    const p = await getPlatformPrisma().promoter.findUnique({ where: { id: payload.sub } });
    if (!p || p.status === 'REMOVED' || p.tokenVersion !== payload.ver) throw new UnauthorizedException('Signed out. Sign in again.');
    req.promoter = p;
    req.user = payload;
    return true;
  }
}

/** The promoter row the guard loaded. */
export const CurrentPromoter = createParamDecorator((_: unknown, ctx: ExecutionContext): Promoter => {
  const p = ctx.switchToHttp().getRequest<PromoterRequest>().promoter;
  if (!p) throw new ForbiddenException('No promoter on this request');
  return p;
});
