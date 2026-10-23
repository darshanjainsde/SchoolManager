import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { Prisma, getPlatformPrisma } from '@skoolos/db';
import type { Promoter } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../../common/errors/api-error';
import { OtpService } from '../../common/otp/otp.service';
import { runInBackground } from '../../common/notifications/run-in-background';
import type { PromoterJwtPayload } from '../../common/auth/jwt-payload';
import { PROMOTER_TOKEN_TTL_S, promoterSecret } from './promoter-jwt.guard';
import { ReferralsService, e164 } from './referrals.service';

export interface PromoterSession { accessToken: string; expiresIn: number; promoter: Promoter; isNew: boolean }

/**
 * Sign in and sign up are one door: ask for a code on an email or a WhatsApp
 * number, type it back. The first time an address is seen, a name makes the
 * account; after that the same code signs the person in. No password exists.
 */
@Injectable()
export class PromoterAuthService {
  private readonly env = loadEnv();
  constructor(private readonly jwt: JwtService, private readonly otp: OtpService, private readonly referrals: ReferralsService) {}

  async start(dto: { channel: 'email' | 'whatsapp'; email?: string; phone?: string }, ip: string | null) {
    if (dto.channel === 'email') {
      const email = dto.email!.trim().toLowerCase();
      const existing = await getPlatformPrisma().promoter.findUnique({ where: { email }, select: { status: true, name: true } });
      if (existing?.status === 'REMOVED') throw new ApiError('PROMOTER_SUSPENDED', 'This account has been closed. Write to admin@sckools.com.', 403, 'email');
      const started = await this.otp.startEmail('PROMOTER', email, { ip }, (code) => this.referrals.mail.code(email, code));
      return { ...started, to: email, channel: 'email' as const, exists: !!existing };
    }
    const phone = e164(dto.phone!);
    if (!phone) throw new ApiError('VALIDATION', 'Enter a ten-digit mobile number, with the country code if outside India.', 400, 'phone');
    const existing = await getPlatformPrisma().promoter.findUnique({ where: { phoneE164: phone }, select: { status: true } });
    if (existing?.status === 'REMOVED') throw new ApiError('PROMOTER_SUSPENDED', 'This account has been closed. Write to admin@sckools.com.', 403, 'phone');
    const started = await this.otp.start('PROMOTER', phone, { schoolId: null, ip });
    return { ...started, to: started.phoneMasked, channel: 'whatsapp' as const, exists: !!existing };
  }

  async verify(dto: { challengeId: string; code: string; name?: string; city?: string }): Promise<PromoterSession> {
    // Peek first: a first-timer who sent no name must be able to send the same
    // code again with one, so the challenge is only spent once we can finish.
    const ch = await this.otp.check(dto.challengeId, dto.code, 'PROMOTER', { consume: false });
    const db = getPlatformPrisma();
    const isEmail = ch.phone.includes('@');
    let p = await db.promoter.findUnique({ where: isEmail ? { email: ch.phone } : { phoneE164: ch.phone } });
    let isNew = false;
    const name = dto.name?.trim();
    if (!p && !name) throw new ApiError('PROMOTER_NAME_REQUIRED', 'Tell us your name to open the account.', 400, 'name');
    await this.otp.check(dto.challengeId, dto.code, 'PROMOTER');
    if (!p) {
      p = await db.promoter.create({
        data: { code: await this.referrals.uniqueCode(name!), name: name!, email: isEmail ? ch.phone : null, phoneE164: isEmail ? null : ch.phone, city: dto.city?.trim() || null },
      }).catch(async (e: unknown) => {
        // The same first-timer verified twice at once: the unique email/number lets one create through; the other signs in.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return (await db.promoter.findUnique({ where: isEmail ? { email: ch.phone } : { phoneE164: ch.phone } }))!;
        throw e;
      });
      isNew = true;
      if (p.email) runInBackground(() => this.referrals.mail.welcome(p!.email!, p!.name), () => undefined);
    } else if (p.status === 'REMOVED') {
      throw new ApiError('PROMOTER_SUSPENDED', 'This account has been closed. Write to admin@sckools.com.', 403);
    } else {
      p = await db.promoter.update({ where: { id: p.id }, data: { lastSeenAt: new Date(), ...(name && !p.name ? { name } : {}) } });
    }
    const payload: Omit<PromoterJwtPayload, 'iat' | 'exp'> = { sub: p.id, aud: 'promoter', ver: p.tokenVersion, jti: randomUUID() };
    const accessToken = this.jwt.sign(payload, { secret: promoterSecret(this.env.JWT_PLATFORM_ACCESS_SECRET), expiresIn: PROMOTER_TOKEN_TTL_S });
    return { accessToken, expiresIn: PROMOTER_TOKEN_TTL_S, promoter: p, isNew };
  }

  /** Sign out everywhere: every token minted so far stops at its next request. */
  async signOutAll(p: Promoter): Promise<void> {
    await getPlatformPrisma().promoter.update({ where: { id: p.id }, data: { tokenVersion: { increment: 1 } } });
  }
}
