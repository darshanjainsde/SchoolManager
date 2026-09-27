const db = { user: { findFirst: jest.fn() }, teacher: { findFirst: jest.fn() }, staff: { findFirst: jest.fn() } };
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => db }));
jest.mock('@skoolos/config', () => ({ loadEnv: () => ({ JWT_SCHOOL_ACCESS_SECRET: 'test-secret-long-enough-xx' }) }));

import { JwtService } from '@nestjs/jwt';
import { OtpAuthService } from './otp-auth.service';

const PHONE = '+919876543210';
const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ravi = { userId: 'u-ravi', schoolId: SCHOOL, schoolName: 'Raffles', host: 'raffles.sckools.com', role: 'STUDENT', kind: 'FAMILY', label: 'Ravi Sharma', sub: 'Class 5-B' };
const meera = { ...ravi, userId: 'u-meera', label: 'Meera Sharma', sub: 'Class 8-A' };
const issued = (userId: string) => ({ tokens: { accessToken: 'a-' + userId, refreshToken: 'r-' + userId, expiresIn: 900 }, schoolId: SCHOOL, schoolSlug: 'raffles' });

describe('OtpAuthService', () => {
  const otp = { ready: true, start: jest.fn(), check: jest.fn() };
  const profiles = { resolve: jest.fn(), switchable: jest.fn() };
  const auth = { issueFor: jest.fn(async (id: string) => issued(id)) };
  const reset = { setPassword: jest.fn() };
  const jwt = new JwtService({});
  const svc = () => new OtpAuthService(otp as never, profiles as never, auth as never, reset as never, jwt);
  beforeEach(() => {
    jest.clearAllMocks();
    otp.start.mockResolvedValue({ challengeId: 'c1', phoneMasked: '+91 98••• •3210', sentVia: ['whatsapp'], expiresIn: 600 });
    otp.check.mockResolvedValue({ id: 'c1', phone: PHONE, purpose: 'LOGIN', schoolId: SCHOOL, userId: null });
  });

  it('request: a known number starts a LOGIN code under the first profile\'s school', async () => {
    profiles.resolve.mockResolvedValue([ravi]);
    const r = await svc().request('98765 43210', null, '1.2.3.4');
    expect(profiles.resolve).toHaveBeenCalledWith(PHONE, { schoolId: null, forLogin: true });
    expect(otp.start).toHaveBeenCalledWith('LOGIN', PHONE, { schoolId: SCHOOL, ip: '1.2.3.4' });
    expect(r).toEqual({ challengeId: 'c1', phoneMasked: '+91 98••• •3210', sentVia: ['whatsapp'], expiresIn: 600 });
  });

  it('request: an unknown number gets the same shape and no message; a bad number is refused', async () => {
    profiles.resolve.mockResolvedValue([]);
    const r = await svc().request('9876543210', SCHOOL, null);
    expect(otp.start).not.toHaveBeenCalled();
    expect(r).toMatchObject({ phoneMasked: '+91 98••• •3210', sentVia: ['whatsapp'], expiresIn: 600 });
    expect(r.challengeId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(svc().request('office', null, null)).rejects.toMatchObject({ status: 400 });
  });

  it('verify: one profile → a session for it; the phone is resolved AGAIN at verify time', async () => {
    profiles.resolve.mockResolvedValue([ravi]);
    const r = await svc().verify('c1', '482911', SCHOOL);
    expect(otp.check).toHaveBeenCalledWith('c1', '482911', 'LOGIN');
    expect(profiles.resolve).toHaveBeenCalledWith(PHONE, { schoolId: SCHOOL, forLogin: true });
    expect(r).toEqual({ choose: false, issued: issued('u-ravi'), profile: ravi });
  });

  it('verify: two profiles → a 5-minute ticket naming exactly those logins; choose opens one of them', async () => {
    profiles.resolve.mockResolvedValue([ravi, meera]);
    const r = await svc().verify('c1', '482911', null);
    if (!r.choose) throw new Error('expected a chooser');
    expect(r.profiles).toEqual([ravi, meera]);
    const t = jwt.decode(r.ticket) as { phone: string; userIds: string[]; aud: string; exp: number; iat: number };
    expect(t).toMatchObject({ phone: PHONE, userIds: ['u-ravi', 'u-meera'], aud: 'otp-choose' });
    expect(t.exp - t.iat).toBe(300);
    const chosen = await svc().choose(r.ticket, 'u-meera');
    expect(chosen).toEqual({ issued: issued('u-meera'), profile: meera });
    await expect(svc().choose(r.ticket, 'u-someone-else')).rejects.toMatchObject({ status: 401 });
    await expect(svc().choose('not-a-ticket', 'u-ravi')).rejects.toMatchObject({ status: 401 });
  });

  it('verify: a number with no profile left (re-assigned since the code was sent) is refused', async () => {
    profiles.resolve.mockResolvedValue([]);
    await expect(svc().verify('c1', '482911', null)).rejects.toMatchObject({ status: 401 });
    expect(auth.issueFor).not.toHaveBeenCalled();
  });

  it('switch: only into a profile that shares this login\'s phone identity', async () => {
    profiles.switchable.mockResolvedValue([meera]);
    expect(await svc().switch('u-ravi', 'u-meera')).toEqual({ issued: issued('u-meera'), profile: meera });
    await expect(svc().switch('u-ravi', 'u-admin')).rejects.toMatchObject({ status: 403, response: { code: 'PROFILE_NOT_SWITCHABLE' } });
  });

  describe('password reset by code', () => {
    it('startReset: a login with a verified phone (or the office phone on its record) gets a RESET code bound to it; none → null', async () => {
      db.user.findFirst.mockResolvedValue({ id: 'u-priya', phone: null, phoneVerifiedAt: null });
      db.teacher.findFirst.mockResolvedValue({ phoneE164: PHONE }); db.staff.findFirst.mockResolvedValue(null);
      const r = await svc().startReset(SCHOOL, 'Priya@Raffles.test', null);
      expect(db.user.findFirst.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, email: 'priya@raffles.test', isActive: true });
      expect(otp.start).toHaveBeenCalledWith('RESET', PHONE, { schoolId: SCHOOL, userId: 'u-priya', ip: null });
      expect(r).toMatchObject({ challengeId: 'c1' });
      db.teacher.findFirst.mockResolvedValue(null);
      expect(await svc().startReset(SCHOOL, 'priya@raffles.test', null)).toBeNull();
      db.user.findFirst.mockResolvedValue(null);
      expect(await svc().startReset(SCHOOL, 'nobody@raffles.test', null)).toBeNull();
    });
    it('resetWithOtp: the code must be a RESET code cut for THIS login at THIS school', async () => {
      otp.check.mockResolvedValue({ id: 'c9', phone: PHONE, purpose: 'RESET', schoolId: SCHOOL, userId: 'u-priya' });
      db.user.findFirst.mockResolvedValue({ id: 'u-priya' });
      await svc().resetWithOtp(SCHOOL, 'priya@raffles.test', 'c9', '482911', 'new-password-1');
      expect(otp.check).toHaveBeenCalledWith('c9', '482911', 'RESET');
      expect(reset.setPassword).toHaveBeenCalledWith('u-priya', 'new-password-1');
      db.user.findFirst.mockResolvedValue({ id: 'u-other' });
      await expect(svc().resetWithOtp(SCHOOL, 'other@raffles.test', 'c9', '482911', 'x'.repeat(8))).rejects.toMatchObject({ response: { code: 'OTP_CHALLENGE_UNKNOWN' } });
    });
  });
});
