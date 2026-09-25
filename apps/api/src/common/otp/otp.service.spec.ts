const otp = { findFirst: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn().mockResolvedValue({}), findUnique: jest.fn() };
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => ({ otpChallenge: otp }) }));

import { OtpService, hashOtp, OTP_MAX_ATTEMPTS } from './otp.service';
import { OtpSenders, type OtpSender } from './otp-senders';

const PHONE = '+919876543210';
const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function sender(name: 'whatsapp' | 'sms', enabled: boolean, ok = true, code: number | null = null): OtpSender {
  return { name, enabled: () => enabled, send: jest.fn().mockResolvedValue({ ok, code, reason: ok ? undefined : 'nope' }) };
}

describe('OtpSenders.fanOut — one code, every enabled sender', () => {
  it('sends through every enabled sender in parallel and reports which carried it', async () => {
    const wa = sender('whatsapp', true), sms = sender('sms', true);
    const s = new OtpSenders(wa as never, sms as never);
    const r = await s.fanOut(PHONE, '123456', { schoolId: SCHOOL, purpose: 'LOGIN' });
    expect(r.sentVia.sort()).toEqual(['sms', 'whatsapp']);
    expect(wa.send).toHaveBeenCalledWith(PHONE, '123456', { schoolId: SCHOOL, purpose: 'LOGIN' });
    expect(sms.send).toHaveBeenCalled();
  });
  it('a disabled sender is skipped, not counted as a failure; a failing one is named', async () => {
    const s = new OtpSenders(sender('whatsapp', true, false, 131026) as never, sender('sms', false) as never);
    const r = await s.fanOut(PHONE, '123456', { schoolId: SCHOOL, purpose: 'LOGIN' });
    expect(r).toEqual({ sentVia: [], failures: [{ name: 'whatsapp', code: 131026, reason: 'nope' }], nothingEnabled: false });
  });
  it('no sender enabled → nothingEnabled, so the caller can say "not set up" instead of "wrong number"', async () => {
    const s = new OtpSenders(sender('whatsapp', false) as never, sender('sms', false) as never);
    expect(await s.fanOut(PHONE, '1', { schoolId: SCHOOL, purpose: 'LOGIN' })).toEqual({ sentVia: [], failures: [], nothingEnabled: true });
  });
});

describe('OtpService', () => {
  const senders = { enabledNames: jest.fn().mockReturnValue(['whatsapp']), fanOut: jest.fn() };
  const svc = () => new OtpService(senders as never);
  beforeEach(() => {
    jest.clearAllMocks();
    otp.findFirst.mockResolvedValue(null);
    otp.count.mockResolvedValue(0);
    otp.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => data);
    senders.fanOut.mockResolvedValue({ sentVia: ['whatsapp'], failures: [], nothingEnabled: false });
  });

  it('start: stores a hashed 6-digit code bound to the school and user, fans it out, records the channels', async () => {
    const r = await svc().start('LOGIN', PHONE, { schoolId: SCHOOL, userId: 'u1', ip: '1.2.3.4' });
    const data = otp.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ phone: PHONE, purpose: 'LOGIN', schoolId: SCHOOL, userId: 'u1', ip: '1.2.3.4' });
    expect(data.codeHash).toMatch(/^[0-9a-f]{64}$/);
    const [phone, code, ctx] = senders.fanOut.mock.calls[0];
    expect(phone).toBe(PHONE); expect(code).toMatch(/^\d{6}$/); expect(ctx).toEqual({ schoolId: SCHOOL, purpose: 'LOGIN' });
    expect(hashOtp(data.id, code)).toBe(data.codeHash);
    expect(otp.update).toHaveBeenCalledWith({ where: { id: data.id }, data: { sentVia: ['whatsapp'] } });
    expect(r).toMatchObject({ challengeId: data.id, phoneMasked: '+91 98••• •3210', sentVia: ['whatsapp'], expiresIn: 600 });
  });

  it('start: one a minute, three an hour, ten a day — per phone and purpose', async () => {
    otp.findFirst.mockResolvedValueOnce({ createdAt: new Date(Date.now() - 20_000) });
    await expect(svc().start('LOGIN', PHONE, { schoolId: SCHOOL })).rejects.toMatchObject({ status: 429 });
    otp.count.mockResolvedValueOnce(3).mockResolvedValueOnce(3);
    await expect(svc().start('LOGIN', PHONE, { schoolId: SCHOOL })).rejects.toMatchObject({ status: 429 });
    otp.count.mockResolvedValueOnce(1).mockResolvedValueOnce(10);
    await expect(svc().start('LOGIN', PHONE, { schoolId: SCHOOL })).rejects.toMatchObject({ status: 429 });
    expect(otp.create).not.toHaveBeenCalled();
    expect(otp.count.mock.calls[0][0].where).toMatchObject({ phone: PHONE, purpose: 'LOGIN' });
  });

  it('start: undeliverable → the challenge is burnt and the reason is the person\'s (not on WhatsApp / not set up)', async () => {
    senders.fanOut.mockResolvedValueOnce({ sentVia: [], failures: [{ name: 'whatsapp', code: 131026, reason: 'not on WhatsApp' }], nothingEnabled: false });
    await expect(svc().start('LOGIN', PHONE, { schoolId: SCHOOL })).rejects.toMatchObject({ status: 502, response: { code: 'OTP_UNDELIVERABLE', message: 'That number is not on WhatsApp.' } });
    expect(otp.update.mock.calls[0][0].data.consumedAt).toBeInstanceOf(Date);
    senders.fanOut.mockResolvedValueOnce({ sentVia: [], failures: [], nothingEnabled: true });
    await expect(svc().start('LOGIN', PHONE, { schoolId: SCHOOL })).rejects.toMatchObject({ response: { message: 'One-time codes are not set up on the platform yet.' } });
    senders.fanOut.mockResolvedValueOnce({ sentVia: [], failures: [{ name: 'whatsapp', code: 131030, reason: 'not on the Meta test list' }], nothingEnabled: false });
    await expect(svc().start('LOGIN', PHONE, { schoolId: SCHOOL })).rejects.toMatchObject({ response: { message: expect.stringContaining('not on the WhatsApp test list') } });
  });

  describe('check', () => {
    const row = (over: Partial<{ attempts: number; consumedAt: Date | null; expiresAt: Date; purpose: string }> = {}) => ({
      id: 'c1', phone: PHONE, purpose: 'LOGIN', codeHash: hashOtp('c1', '482911'), expiresAt: new Date(Date.now() + 60_000), attempts: 0, consumedAt: null, schoolId: SCHOOL, userId: 'u1', ...over,
    });
    it('the right code consumes the challenge and returns who it was bound to', async () => {
      otp.findUnique.mockResolvedValueOnce(row());
      const r = await svc().check('c1', ' 482911 ', 'LOGIN');
      expect(r).toEqual({ id: 'c1', phone: PHONE, purpose: 'LOGIN', schoolId: SCHOOL, userId: 'u1' });
      expect(otp.update.mock.calls[0][0]).toMatchObject({ where: { id: 'c1' } });
      expect(otp.update.mock.calls[0][0].data.consumedAt).toBeInstanceOf(Date);
    });
    it('unknown id, wrong purpose, used, expired, locked, wrong — each its own answer', async () => {
      otp.findUnique.mockResolvedValueOnce(null);
      await expect(svc().check('zz', '482911')).rejects.toMatchObject({ response: { code: 'OTP_CHALLENGE_UNKNOWN' } });
      otp.findUnique.mockResolvedValueOnce(row({ purpose: 'RESET' }));
      await expect(svc().check('c1', '482911', 'LOGIN')).rejects.toMatchObject({ response: { code: 'OTP_CHALLENGE_UNKNOWN' } });
      otp.findUnique.mockResolvedValueOnce(row({ consumedAt: new Date() }));
      await expect(svc().check('c1', '482911')).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
      otp.findUnique.mockResolvedValueOnce(row({ expiresAt: new Date(Date.now() - 1) }));
      await expect(svc().check('c1', '482911')).rejects.toMatchObject({ response: { code: 'OTP_EXPIRED' } });
      otp.findUnique.mockResolvedValueOnce(row({ attempts: OTP_MAX_ATTEMPTS }));
      await expect(svc().check('c1', '482911')).rejects.toMatchObject({ status: 429, response: { code: 'OTP_LOCKED' } });
      otp.findUnique.mockResolvedValueOnce(row({ attempts: 3 }));
      await expect(svc().check('c1', '000000')).rejects.toMatchObject({ response: { code: 'OTP_WRONG', message: 'That code is not right. 1 try left.' } });
      expect(otp.update).toHaveBeenLastCalledWith({ where: { id: 'c1' }, data: { attempts: { increment: 1 } } });
    });
  });
});

/**
 * A CODE THAT WAS NEVER SENT MUST NOT COST A MINUTE.
 *
 * Reported from staging with a screenshot: pressing "Send code" showed
 *   "A code was sent less than a minute ago. Check WhatsApp, or wait a moment."
 * while the send had FAILED (132001 — the account has no authentication
 * template). There was no code and nothing to check, and the person was
 * locked out of retrying for a minute by a message that was not true.
 *
 * `sentVia` is written only after a sender actually carried the code, so the
 * limits count delivered codes.
 */
describe('the rate limit counts codes that were actually sent', () => {
  const senders = { enabledNames: jest.fn().mockReturnValue(['whatsapp']), fanOut: jest.fn() };
  const svc = () => new OtpService(senders as never);

  beforeEach(() => {
    jest.clearAllMocks();
    otp.findFirst.mockResolvedValue(null);
    otp.count.mockResolvedValue(0);
    otp.create.mockResolvedValue({});
    otp.update.mockResolvedValue({});
  });

  it('asks only about challenges a sender carried', async () => {
    senders.fanOut.mockResolvedValue({ sentVia: ['whatsapp'], failures: [], nothingEnabled: false });
    await svc().start('VERIFY_PHONE', PHONE, { schoolId: SCHOOL });
    for (const call of [...otp.findFirst.mock.calls, ...otp.count.mock.calls]) {
      expect(call[0].where.sentVia).toEqual({ isEmpty: false });
    }
  });

  it('lets a person try again at once when nothing carried the code', async () => {
    // The failed attempt writes a challenge row, but with no `sentVia` — so
    // the next call does not see it as "a code was sent a moment ago".
    senders.fanOut.mockResolvedValue({
      sentVia: [], nothingEnabled: false,
      failures: [{ name: 'whatsapp', code: 132001, reason: 'the code template is not approved on this WhatsApp account' }],
    });
    await expect(svc().start('VERIFY_PHONE', PHONE, { schoolId: SCHOOL })).rejects.toThrow(/not switched on yet|password/i);

    // Second attempt: the ledger has that un-sent row, and it is ignored.
    otp.findFirst.mockResolvedValue(null);
    senders.fanOut.mockResolvedValue({ sentVia: ['sms'], failures: [], nothingEnabled: false });
    await expect(svc().start('VERIFY_PHONE', PHONE, { schoolId: SCHOOL })).resolves.toMatchObject({ sentVia: ['sms'] });
  });

  it('still holds a real code to one a minute', async () => {
    // The limit must keep working for codes that DID go out.
    otp.findFirst.mockResolvedValue({ createdAt: new Date() });
    await expect(svc().start('LOGIN', PHONE, { schoolId: SCHOOL })).rejects.toThrow(/less than a minute ago/);
  });
});

