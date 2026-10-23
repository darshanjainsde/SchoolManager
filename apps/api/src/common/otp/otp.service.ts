import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import { ApiError } from '../errors/api-error';
import { OtpSenders, type OtpPurpose } from './otp-senders';
import { maskPhone } from './phone-identity';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_RESEND_AFTER_MS = 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_PER_HOUR = 3;
export const OTP_PER_DAY = 10;

export interface StartedChallenge {
  challengeId: string;
  phoneMasked: string;
  sentVia: string[];
  expiresIn: number;
}

export interface CheckedChallenge {
  id: string;
  phone: string;
  purpose: OtpPurpose;
  schoolId: string | null;
  userId: string | null;
}

export function hashOtp(challengeId: string, code: string): string {
  return createHash('sha256').update(`${challengeId}:${code}`).digest('hex');
}

/**
 * THE ONE-TIME-CODE ENGINE — one table, three purposes (login, password
 * reset, proving a number), every sender. Nothing here knows who the phone
 * belongs to: the caller resolved that and hands in the schoolId/userId to
 * bind the challenge to. A code is 6 digits, hashed with its own challenge
 * id, good for ten minutes, five tries, single use; a phone gets at most
 * one code a minute, three an hour, ten a day, per purpose.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  constructor(private readonly senders: OtpSenders) {}

  /** True when at least one sender can carry a code — the client hides the phone door otherwise. */
  get ready(): boolean {
    return this.senders.enabledNames().length > 0;
  }

  async start(purpose: OtpPurpose, phone: string, ctx: { schoolId: string | null; userId?: string | null; ip?: string | null }): Promise<StartedChallenge> {
    const db = getPlatformPrisma();
    const now = Date.now();
    await this.assertNotRateLimited(db, phone, purpose, now, 'phone');
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.otpChallenge.create({
      data: { id, phone, purpose, codeHash: hashOtp(id, code), expiresAt: new Date(now + OTP_TTL_MS), schoolId: ctx.schoolId, userId: ctx.userId ?? null, ip: ctx.ip ?? null },
    });
    const out = await this.senders.fanOut(phone, code, { schoolId: ctx.schoolId, purpose });
    if (out.sentVia.length === 0) {
      // Nothing carried it: burn the challenge so the code can never be used,
      // and say why in the words the person needs.
      await db.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } }).catch(() => undefined);
      const why = out.nothingEnabled
        ? 'One-time codes are not set up on the platform yet.'
        : out.failures.some((f) => f.code === 131026)
          ? 'That number is not on WhatsApp.'
          : out.failures.some((f) => f.code === 131030)
            // Meta's TEST number may only message the five numbers registered
            // against it. Until the real number is attached, say exactly that.
            ? 'This number is not on the WhatsApp test list yet. Add it in Meta (WhatsApp → API Setup → To) and try again in a minute.'
            : out.failures.some((f) => f.code === 132001)
              // A permanent block, not a blip: WhatsApp has not approved the
              // code template on this account, so retrying cannot help. Send
              // them to the door that does work instead of leaving them on a
              // screen that will fail every time.
              ? (purpose === 'PROMOTER' ? 'WhatsApp codes are not switched on yet. Use the email door instead.' : 'Signing in by code is not switched on yet. Please sign in with your password instead.')
              : 'The code could not be delivered just now. Try again in a minute.';
      this.logger.warn(`OTP ${purpose} to ${phone} undeliverable: ${out.failures.map((f) => `${f.name}: ${f.reason}`).join('; ') || 'no sender enabled'}`);
      throw new ApiError('OTP_UNDELIVERABLE', why, 502, 'phone');
    }
    await db.otpChallenge.update({ where: { id }, data: { sentVia: out.sentVia } });
    return { challengeId: id, phoneMasked: maskPhone(phone), sentVia: out.sentVia, expiresIn: OTP_TTL_MS / 1000 };
  }

  /**
   * The same resend/hour/day limits for every carrier. `field` names the input
   * the client should mark — "phone" for a number, "email" for an address.
   */
  private async assertNotRateLimited(db: ReturnType<typeof getPlatformPrisma>, address: string, purpose: OtpPurpose, now: number, field: 'phone' | 'email'): Promise<void> {
    const [latest, lastHour, lastDay] = await Promise.all([
      db.otpChallenge.findFirst({
        where: { phone: address, purpose, sentVia: { isEmpty: false } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      db.otpChallenge.count({ where: { phone: address, purpose, sentVia: { isEmpty: false }, createdAt: { gt: new Date(now - 3_600_000) } } }),
      db.otpChallenge.count({ where: { phone: address, purpose, sentVia: { isEmpty: false }, createdAt: { gt: new Date(now - 86_400_000) } } }),
    ]);
    const where = field === 'email' ? 'your inbox' : 'WhatsApp';
    if (latest && now - latest.createdAt.getTime() < OTP_RESEND_AFTER_MS) {
      throw new ApiError('OTP_RATE_LIMITED', `A code was sent less than a minute ago. Check ${where}, or wait a moment.`, 429, field);
    }
    if (lastHour >= OTP_PER_HOUR || lastDay >= OTP_PER_DAY) {
      throw new ApiError('OTP_RATE_LIMITED', field === 'email' ? 'Too many codes for this address. Try again later.' : purpose === 'PROMOTER' ? 'Too many codes for this number. Try again later, or use your email.' : 'Too many codes for this number. Try again later, or use your password.', 429, field);
    }
  }

  /**
   * A code carried by something other than the phone senders — today, email
   * for Refer & Earn. The challenge row, limits and the check are the same as
   * for a phone; only the carrier differs, and the caller supplies it. The
   * address is stored in the `phone` column (it is "the thing the code went
   * to"); a schema rename for one column would cost a migration for nothing.
   */
  async startEmail(purpose: OtpPurpose, email: string, ctx: { ip?: string | null }, carry: (code: string) => Promise<boolean>): Promise<StartedChallenge> {
    const db = getPlatformPrisma();
    const now = Date.now();
    const address = email.trim().toLowerCase();
    await this.assertNotRateLimited(db, address, purpose, now, 'email');
    const id = randomUUID();
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.otpChallenge.create({
      data: { id, phone: address, purpose, codeHash: hashOtp(id, code), expiresAt: new Date(now + OTP_TTL_MS), schoolId: null, userId: null, ip: ctx.ip ?? null },
    });
    let ok = false;
    try { ok = await carry(code); } catch (e) { this.logger.warn(`OTP ${purpose} email to ${address} threw: ${(e as Error).message}`); }
    if (!ok) {
      await db.otpChallenge.update({ where: { id }, data: { consumedAt: new Date() } }).catch(() => undefined);
      throw new ApiError('OTP_UNDELIVERABLE', 'The code could not be emailed just now. Try again in a minute, or use WhatsApp.', 502, 'email');
    }
    await db.otpChallenge.update({ where: { id }, data: { sentVia: ['email'] } });
    const [user, domain] = address.split('@');
    const masked = `${user.slice(0, 2)}${'•'.repeat(Math.max(1, user.length - 2))}@${domain}`;
    return { challengeId: id, phoneMasked: masked, sentVia: ['email'], expiresIn: OTP_TTL_MS / 1000 };
  }

  /**
   * Consume a code. Every refusal has its own error code so a client can say
   * the right thing: unknown challenge (a stale screen), expired or already
   * used, locked after five wrong tries, or simply wrong with tries left.
   */
  async check(challengeId: string, code: string, expectPurpose?: OtpPurpose, opts: { consume?: boolean } = {}): Promise<CheckedChallenge> {
    const db = getPlatformPrisma();
    const row = await db.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!row || (expectPurpose && row.purpose !== expectPurpose)) {
      throw new ApiError('OTP_CHALLENGE_UNKNOWN', 'Ask for a new code.', 400, 'code');
    }
    if (row.consumedAt || row.expiresAt.getTime() < Date.now()) {
      throw new ApiError('OTP_EXPIRED', 'That code has expired — ask for a new one.', 400, 'code');
    }
    if (row.attempts >= OTP_MAX_ATTEMPTS) {
      throw new ApiError('OTP_LOCKED', 'Too many wrong tries. Ask for a new code.', 429, 'code');
    }
    if (hashOtp(row.id, code.trim()) !== row.codeHash) {
      await db.otpChallenge.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
      const left = OTP_MAX_ATTEMPTS - row.attempts - 1;
      throw new ApiError('OTP_WRONG', left > 0 ? `That code is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code is not right. Ask for a new one.', 400, 'code');
    }
    // `consume: false` is a peek: the code is right, but the caller still has a
    // question to ask (a first-timer's name) before the challenge is spent.
    if (opts.consume !== false) {
      // Atomic: two parallel verifies with the right code must not both win.
      const spent = await db.otpChallenge.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
      if (spent.count === 0) throw new ApiError('OTP_EXPIRED', 'That code was already used — ask for a new one.', 400, 'code');
    }
    return { id: row.id, phone: row.phone, purpose: row.purpose as OtpPurpose, schoolId: row.schoolId, userId: row.userId };
  }
}
