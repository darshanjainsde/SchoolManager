import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { getPlatformPrisma } from '@skoolos/db';
import { loadEnv } from '@skoolos/config';
import { ApiError } from '../../../common/errors/api-error';
import { OtpService } from '../../../common/otp/otp.service';
import { maskPhone, toE164 } from '../../../common/otp/phone-identity';
import { AuthService, type IssuedFor } from './auth.service';
import { PasswordResetService } from './password-reset.service';
import { PhoneProfilesService, type PhoneProfile } from './phone-profiles.service';

const TICKET_AUD = 'otp-choose';
const TICKET_TTL_S = 300;

interface ChooseTicket { phone: string; userIds: string[]; aud: string }

export type OtpVerifyOutcome =
  | { choose: false; issued: IssuedFor; profile: PhoneProfile }
  | { choose: true; ticket: string; profiles: PhoneProfile[] };

/**
 * LOGIN WITH A PHONE (design §4). Orchestrates the OTP engine and the phone
 * resolver into the four public moves — request, verify, choose, and the
 * password reset by code — plus the two signed-in moves, profiles and switch.
 * Token issuing stays in AuthService; nothing about sessions changes.
 */
@Injectable()
export class OtpAuthService {
  private readonly env = loadEnv();
  constructor(
    private readonly otp: OtpService,
    private readonly profiles: PhoneProfilesService,
    private readonly auth: AuthService,
    private readonly reset: PasswordResetService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Whether the login page should offer the phone door at all.
   *
   * TWO things have to be true, and they are different questions. The owner's
   * switch is a DECISION — "we offer this" — and the sender check is a FACT —
   * "a code can physically be carried". Readiness used to be the fact alone,
   * which is why a door nobody could open was on the login page: a sender was
   * configured, and Meta refused the template every time.
   *
   * Cached for a minute. This is read on every visit to /login, by people who
   * are not signed in, and the answer changes about once a year.
   */
  async isReady(): Promise<boolean> {
    if (!this.otp.ready) return false;
    const now = Date.now();
    if (now - this.switchAt > 60_000) {
      try {
        const row = await getPlatformPrisma().marketingConfig.findUnique({
          where: { id: 'default' },
          select: { loginOtpEnabled: true },
        });
        // No row yet means nobody has ever opened the owner console. Off is
        // the honest default: the door has never worked.
        this.switchOn = row?.loginOtpEnabled ?? false;
      } catch {
        // A migration not yet run, or a database blip, must not put an
        // unopenable door back on the login page.
        this.switchOn = false;
      }
      this.switchAt = now;
    }
    return this.switchOn;
  }

  /** Test seam and cache, so the switch is read once a minute, not per visit. */
  private switchOn = false;
  private switchAt = 0;
  /**
   * Drop the cached switch. The owner's save does NOT call this — it would
   * couple the owner module to auth for one boolean — so a change takes up to
   * the minute above to reach the login page, and the owner console says so.
   * Used by the tests to flip the switch without waiting.
   */
  forgetSwitch(): void {
    this.switchAt = 0;
  }

  /**
   * Same answer whether the number is known or not — an unknown number gets
   * no message and a challenge nothing can be verified against, but the
   * response never says which (design §6 "unknown number").
   */
  async request(rawPhone: string, schoolId: string | null, ip: string | null) {
    // Hiding the door is not closing it. Anything can POST here, so the
    // switch is enforced where the work happens, not only where the button is
    // drawn — otherwise turning it off would be decoration.
    if (!(await this.isReady())) {
      throw new ApiError(
        'OTP_DISABLED',
        'Signing in by code is not switched on. Please sign in with your password instead.',
        400,
        'phone',
      );
    }
    const phone = toE164(rawPhone);
    if (!phone) throw new ApiError('BAD_PHONE', 'That does not look like a mobile number.', 400, 'phone');
    const profiles = await this.profiles.resolve(phone, { schoolId, forLogin: true });
    if (profiles.length === 0) {
      return { challengeId: randomUUID(), phoneMasked: maskPhone(phone), sentVia: this.otp.ready ? ['whatsapp'] : [], expiresIn: 600 };
    }
    const started = await this.otp.start('LOGIN', phone, { schoolId: profiles[0].schoolId, ip });
    return { challengeId: started.challengeId, phoneMasked: started.phoneMasked, sentVia: started.sentVia, expiresIn: started.expiresIn };
  }

  async verify(challengeId: string, code: string, schoolId: string | null): Promise<OtpVerifyOutcome> {
    const row = await this.otp.check(challengeId, code, 'LOGIN');
    // Resolved AGAIN now, not from the request: a number re-assigned at the
    // office in the last ten minutes must not open the old profile.
    const profiles = await this.profiles.resolve(row.phone, { schoolId, forLogin: true });
    if (profiles.length === 0) throw new UnauthorizedException('This number is not registered with a school.');
    if (profiles.length === 1) return { choose: false, issued: await this.auth.issueFor(profiles[0].userId), profile: profiles[0] };
    const ticket = this.jwt.sign({ phone: row.phone, userIds: profiles.map((p) => p.userId) } satisfies Omit<ChooseTicket, 'aud'>, {
      secret: this.env.JWT_SCHOOL_ACCESS_SECRET, audience: TICKET_AUD, expiresIn: TICKET_TTL_S,
    });
    return { choose: true, ticket, profiles };
  }

  async choose(ticket: string, userId: string): Promise<{ issued: IssuedFor; profile: PhoneProfile }> {
    let t: ChooseTicket;
    try {
      t = this.jwt.verify<ChooseTicket>(ticket, { secret: this.env.JWT_SCHOOL_ACCESS_SECRET, audience: TICKET_AUD });
    } catch {
      throw new ApiError('OTP_EXPIRED', 'That sign-in took too long — ask for a new code.', 401, 'ticket');
    }
    if (!t.userIds.includes(userId)) throw new UnauthorizedException('That profile is not on this phone.');
    // The phone is re-resolved so a profile removed since the ticket was cut cannot be opened.
    const profile = (await this.profiles.resolve(t.phone, { forLogin: true })).find((p) => p.userId === userId);
    if (!profile) throw new UnauthorizedException('That profile is no longer on this phone.');
    return { issued: await this.auth.issueFor(userId), profile };
  }

  /** The switch list for a signed-in login: everything behind its numbers, minus admin consoles. */
  async profilesFor(userId: string): Promise<PhoneProfile[]> {
    return this.profiles.switchable(userId);
  }

  async switch(currentUserId: string, targetUserId: string): Promise<{ issued: IssuedFor; profile: PhoneProfile }> {
    const target = (await this.profiles.switchable(currentUserId)).find((p) => p.userId === targetUserId);
    if (!target) throw new ApiError('PROFILE_NOT_SWITCHABLE', 'That profile does not share a phone number with this one.', 403, 'userId');
    return { issued: await this.auth.issueFor(targetUserId), profile: target };
  }

  /**
   * Forgot password, by code: when the login has a phone we can reach, start
   * a RESET challenge bound to that user. Returns null when there is no
   * phone — the email link (sent by the caller) is the only path then.
   */
  async startReset(schoolId: string, email: string, ip: string | null) {
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({ where: { schoolId, email: email.toLowerCase(), isActive: true }, select: { id: true, phone: true, phoneVerifiedAt: true } });
    if (!user) return null;
    let phone = user.phone && user.phoneVerifiedAt ? user.phone : null;
    if (!phone) {
      const [t, m] = await Promise.all([
        db.teacher.findFirst({ where: { userId: user.id, schoolId }, select: { phoneE164: true } }),
        db.staff.findFirst({ where: { userId: user.id, schoolId }, select: { phoneE164: true } }),
      ]);
      phone = t?.phoneE164 ?? m?.phoneE164 ?? null;
    }
    if (!phone) return null;
    try {
      const started = await this.otp.start('RESET', phone, { schoolId, userId: user.id, ip });
      return { challengeId: started.challengeId, phoneMasked: started.phoneMasked, sentVia: started.sentVia, expiresIn: started.expiresIn };
    } catch (e) {
      // A rate limit or an unreachable number must not break the email path.
      if (e instanceof ApiError) return null;
      throw e;
    }
  }

  async resetWithOtp(schoolId: string, email: string, challengeId: string, code: string, newPassword: string): Promise<void> {
    const row = await this.otp.check(challengeId, code, 'RESET');
    const db = getPlatformPrisma();
    const user = await db.user.findFirst({ where: { schoolId, email: email.toLowerCase(), isActive: true }, select: { id: true } });
    if (!user || row.userId !== user.id || row.schoolId !== schoolId) {
      throw new ApiError('OTP_CHALLENGE_UNKNOWN', 'That code was not sent for this login.', 400, 'code');
    }
    await this.reset.setPassword(user.id, newPassword);
  }
}
