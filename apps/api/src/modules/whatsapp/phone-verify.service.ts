import { createHash, randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { getPlatformPrisma } from '@skoolos/db';
import { ApiError } from '../../common/errors/api-error';
import { OtpSenders } from '../../common/otp/otp-senders';
import { maskPhone, toE164 } from '../../common/otp/phone-identity';

/**
 * "This WhatsApp number is mine" — a six-digit code sent to the number ON
 * WhatsApp, typed back within ten minutes. Until it is typed, the number is
 * `phonePending` and nothing is ever sent to it; after, it is `User.phone`
 * with `phoneVerifiedAt`, and it wins over the office-typed phone for that
 * person. This is what lets an admin — who has no Teacher or Staff record —
 * receive the school's requests.
 *
 * Runs on the platform client: `User` is the identity table auth already
 * owns there; every query carries the caller's own schoolId and userId.
 *
 * Limits: one code per minute, five wrong tries per code, one verified
 * number per person per school (two admins sharing a phone would make "who
 * tapped Approve" ambiguous).
 */
const CODE_TTL_MS = 10 * 60_000;
const RESEND_AFTER_MS = 60_000;
const MAX_ATTEMPTS = 5;

const hashCode = (code: string, userId: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');

@Injectable()
export class PhoneVerifyService {
  constructor(private readonly senders: OtpSenders) {}

  async status(schoolId: string, userId: string) {
    const u = await getPlatformPrisma().user.findFirst({ where: { id: userId, schoolId }, select: { phone: true, phoneVerifiedAt: true, phonePending: true, phoneOtpExpiresAt: true } });
    const pendingUntil = u?.phoneOtpExpiresAt && u.phoneOtpExpiresAt > new Date() ? u.phoneOtpExpiresAt : null;
    return {
      phone: u?.phone ? maskPhone(u.phone) : null,
      verified: !!(u?.phone && u.phoneVerifiedAt),
      verifiedAt: u?.phoneVerifiedAt?.toISOString() ?? null,
      pending: pendingUntil && u?.phonePending ? maskPhone(u.phonePending) : null,
      pendingUntil: pendingUntil?.toISOString() ?? null,
      platformReady: this.senders.enabledNames().length > 0,
    };
  }

  async request(schoolId: string, userId: string, raw: string) {
    const phone = toE164(raw);
    if (!phone) throw new ApiError('BAD_PHONE', 'That does not look like a mobile number.', 400, 'phone');
    const db = getPlatformPrisma();
    const u = await db.user.findFirst({ where: { id: userId, schoolId }, select: { phoneOtpExpiresAt: true } });
    if (!u) throw new ApiError('NOT_FOUND', 'No such login.', 404);
    if (u.phoneOtpExpiresAt && u.phoneOtpExpiresAt.getTime() - CODE_TTL_MS + RESEND_AFTER_MS > Date.now()) {
      throw new ApiError('PHONE_CODE_COOLDOWN', 'A code was sent less than a minute ago. Check WhatsApp, or wait a moment.', 429);
    }
    const taken = await db.user.findFirst({ where: { schoolId, phone, phoneVerifiedAt: { not: null }, NOT: { id: userId } }, select: { id: true } });
    if (taken) throw new ApiError('PHONE_TAKEN', 'Another login at this school already uses that number.', 409, 'phone');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await db.user.update({
      where: { id: userId },
      data: { phonePending: phone, phoneOtpHash: hashCode(code, userId), phoneOtpExpiresAt: new Date(Date.now() + CODE_TTL_MS), phoneOtpAttempts: 0 },
    });
    // Every enabled sender carries it (WhatsApp today, SMS when DLT clears).
    const sent = await this.senders.fanOut(phone, code, { schoolId, purpose: 'VERIFY_PHONE' });
    if (sent.sentVia.length === 0) {
      // NOTHING WAS SENT, so nothing may be held against the next try.
      //
      // This used to keep the pending state "so a retry after the cooldown
      // works" — which meant a failed send locked the person out for a minute
      // and the lock-out said "A code was sent less than a minute ago. Check
      // WhatsApp." There was no code and nothing to check. Clearing it lets
      // them try again at once, and the cooldown still applies to codes that
      // actually went.
      await db.user.update({
        where: { id: userId },
        data: { phonePending: null, phoneOtpHash: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 },
      }).catch(() => undefined);

      // No open window is not a failure — it is the one instruction that
      // makes the fallback work, so it is answered first and by name. Meta
      // has never approved our AUTHENTICATION template (the category is
      // blocked on this account), so a code can only travel as free text,
      // and free text is only allowed inside the 24 hours that open when the
      // person writes to the business. Naming the number is the whole
      // message: "message the school's number" is not an instruction.
      const needsWindow = sent.failures.some((f) => f.reason === 'no open WhatsApp window');
      const sender = needsWindow ? await this.senders.whatsappSenderNumber() : null;
      const why = sent.nothingEnabled
        ? 'One-time codes are not set up on the platform yet.'
        : sent.failures.some((f) => f.code === 131026)
          ? 'That number is not on WhatsApp.'
          : sent.failures.some((f) => f.code === 131030)
            ? 'This number is not on the WhatsApp test list yet. Add it in Meta (WhatsApp → API Setup → To) and try again in a minute.'
            : needsWindow
              ? `Send any WhatsApp message — “Hi” is enough — to ${sender ?? 'the Sckools number'} from ${phone}, then press Send code again within 24 hours.`
              : sent.failures.some((f) => f.code === 132001)
                // Both doors shut: the template is not approved AND the free-text
                // window could not be used. Retrying cannot help.
                ? 'Confirming a number by WhatsApp is not switched on yet. Ask your admin to set the number on your staff record instead.'
                : 'The code could not be delivered just now.';
      throw new ApiError('WHATSAPP_UNREACHABLE', why, 502, 'phone');
    }
    return { ok: true, pending: maskPhone(phone), expiresInSeconds: CODE_TTL_MS / 1000 };
  }

  async verify(schoolId: string, userId: string, code: string) {
    const db = getPlatformPrisma();
    const u = await db.user.findFirst({ where: { id: userId, schoolId }, select: { phonePending: true, phoneOtpHash: true, phoneOtpExpiresAt: true, phoneOtpAttempts: true } });
    if (!u?.phonePending || !u.phoneOtpHash || !u.phoneOtpExpiresAt || u.phoneOtpExpiresAt < new Date()) {
      throw new ApiError('PHONE_CODE_EXPIRED', 'That code has expired — ask for a new one.', 400, 'code');
    }
    if (u.phoneOtpAttempts >= MAX_ATTEMPTS) throw new ApiError('PHONE_CODE_EXPIRED', 'Too many wrong tries — ask for a new code.', 429, 'code');
    if (hashCode(code.trim(), userId) !== u.phoneOtpHash) {
      await db.user.update({ where: { id: userId }, data: { phoneOtpAttempts: { increment: 1 } } });
      throw new ApiError('PHONE_CODE_WRONG', 'That is not the code we sent.', 400, 'code');
    }
    await db.user.update({
      where: { id: userId },
      data: { phone: u.phonePending, phoneVerifiedAt: new Date(), phonePending: null, phoneOtpHash: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 },
    });
    return this.status(schoolId, userId);
  }

  async clear(schoolId: string, userId: string) {
    await getPlatformPrisma().user.updateMany({ where: { id: userId, schoolId }, data: { phone: null, phoneVerifiedAt: null, phonePending: null, phoneOtpHash: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 } });
    return this.status(schoolId, userId);
  }
}
