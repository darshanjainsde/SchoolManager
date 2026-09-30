import { createHash } from 'node:crypto';

const user = { findFirst: jest.fn(), update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 1 }) };
jest.mock('@skoolos/db', () => ({ ...jest.requireActual('@skoolos/db'), getPlatformPrisma: () => ({ user }) }));

import { PhoneVerifyService } from './phone-verify.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const hash = (code: string, userId: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex');
const codeOf = (data: Record<string, unknown>) => {
  // The service stores only a hash; the spec brute-forces the six digits to prove the hash is of a real code.
  for (let i = 0; i < 1_000_000; i++) { const c = String(i).padStart(6, '0'); if (hash(c, 'u1') === data.phoneOtpHash) return c; }
  return null;
};

describe('PhoneVerifyService', () => {
  const senders = { enabledNames: jest.fn().mockReturnValue(['whatsapp']), fanOut: jest.fn().mockResolvedValue({ sentVia: ['whatsapp'], failures: [], nothingEnabled: false }), whatsappSenderNumber: jest.fn().mockResolvedValue('+91 95999 15010') };
  const svc = () => new PhoneVerifyService(senders as never);
  beforeEach(() => { jest.clearAllMocks(); senders.enabledNames.mockReturnValue(['whatsapp']); senders.fanOut.mockResolvedValue({ sentVia: ['whatsapp'], failures: [], nothingEnabled: false }); });

  it('request: normalises the number, refuses one another login already verified, stores a pending number + a hashed code, and sends it on WhatsApp', async () => {
    user.findFirst.mockResolvedValueOnce({ phoneOtpExpiresAt: null }).mockResolvedValueOnce(null);
    const r = await svc().request(SCHOOL, 'u1', '98765 43210');
    expect(r).toMatchObject({ ok: true, pending: '+91 98••• •3210', expiresInSeconds: 600 });
    expect(user.findFirst.mock.calls[1][0].where).toEqual({ schoolId: SCHOOL, phone: '+919876543210', phoneVerifiedAt: { not: null }, NOT: { id: 'u1' } });
    const data = user.update.mock.calls[0][0].data;
    expect(data.phonePending).toBe('+919876543210');
    expect(data.phoneOtpHash).toMatch(/^[0-9a-f]{64}$/);
    expect(data.phoneOtpAttempts).toBe(0);
    const [phone, code, ctx] = senders.fanOut.mock.calls[0];
    expect(phone).toBe('+919876543210');
    expect(code).toMatch(/^\d{6}$/);
    expect(ctx).toEqual({ schoolId: SCHOOL, purpose: 'VERIFY_PHONE' });
  });

  it('request: a second code within a minute is refused; a bad number is refused before anything is stored', async () => {
    user.findFirst.mockResolvedValueOnce({ phoneOtpExpiresAt: new Date(Date.now() + 9.5 * 60_000) });
    await expect(svc().request(SCHOOL, 'u1', '9876543210')).rejects.toMatchObject({ status: 429 });
    await expect(svc().request(SCHOOL, 'u1', 'office')).rejects.toMatchObject({ status: 400 });
    expect(user.update).not.toHaveBeenCalled();
  });

  it("request: when WhatsApp cannot deliver, the caller is told why (not on WhatsApp / platform not set up)", async () => {
    user.findFirst.mockResolvedValueOnce({ phoneOtpExpiresAt: null }).mockResolvedValueOnce(null);
    senders.fanOut.mockResolvedValueOnce({ sentVia: [], failures: [{ name: 'whatsapp', code: 131026, reason: 'not on WhatsApp' }], nothingEnabled: false });
    await expect(svc().request(SCHOOL, 'u1', '9876543210')).rejects.toMatchObject({ status: 502, response: { message: 'That number is not on WhatsApp.' } });
  });

  /**
   * Meta refuses to create our AUTHENTICATION template on this account
   * (subcode 2388185 — the category is blocked, verified against the Graph
   * API), so a code can only travel as free text, and free text is only
   * allowed inside the 24-hour window a person opens by writing to the
   * business. When that window is shut the answer is not "try again" — it is
   * the one instruction that makes the next try work, and it has to name the
   * number, because "message the Sckools number" is not an instruction.
   */
  it('request: with no open window, the error is an instruction naming the number to write to', async () => {
    user.findFirst.mockResolvedValueOnce({ phoneOtpExpiresAt: null }).mockResolvedValueOnce(null);
    senders.fanOut.mockResolvedValueOnce({ sentVia: [], failures: [{ name: 'whatsapp', code: 131047, reason: 'no open WhatsApp window' }], nothingEnabled: false });
    await expect(svc().request(SCHOOL, 'u1', '9876543210')).rejects.toMatchObject({
      status: 502,
      response: { message: 'Send any WhatsApp message — “Hi” is enough — to +91 95999 15010 from +919876543210, then press Send code again within 24 hours.' },
    });
    // Nothing is held against the next try: the person is about to make one.
    expect(user.update.mock.calls[1][0].data).toMatchObject({ phonePending: null, phoneOtpHash: null, phoneOtpAttempts: 0 });
  });

  it('request: the instruction still reads when Meta will not tell us our own number', async () => {
    user.findFirst.mockResolvedValueOnce({ phoneOtpExpiresAt: null }).mockResolvedValueOnce(null);
    senders.whatsappSenderNumber.mockResolvedValueOnce(null);
    senders.fanOut.mockResolvedValueOnce({ sentVia: [], failures: [{ name: 'whatsapp', code: 131047, reason: 'no open WhatsApp window' }], nothingEnabled: false });
    await expect(svc().request(SCHOOL, 'u1', '9876543210')).rejects.toMatchObject({
      response: { message: expect.stringContaining('the Sckools number') },
    });
  });

  it('request: both doors shut sends them to their admin, and never invites a retry', async () => {
    user.findFirst.mockResolvedValueOnce({ phoneOtpExpiresAt: null }).mockResolvedValueOnce(null);
    senders.fanOut.mockResolvedValueOnce({ sentVia: [], failures: [{ name: 'whatsapp', code: 132001, reason: 'the code template is not approved on this WhatsApp account' }], nothingEnabled: false });
    await expect(svc().request(SCHOOL, 'u1', '9876543210')).rejects.toMatchObject({
      status: 502,
      response: { message: 'Confirming a number by WhatsApp is not switched on yet. Ask your admin to set the number on your staff record instead.' },
    });
    // The number is only looked up for the instruction that needs it.
    expect(senders.whatsappSenderNumber).not.toHaveBeenCalled();
  });

  it('verify: the right code within ten minutes moves pending → phone + verifiedAt and clears the code', async () => {
    user.findFirst.mockResolvedValueOnce({ phoneOtpExpiresAt: null }).mockResolvedValueOnce(null);
    await svc().request(SCHOOL, 'u1', '9876543210');
    const stored = user.update.mock.calls[0][0].data;
    const code = codeOf(stored)!;
    expect(code).toHaveLength(6);
    user.findFirst.mockResolvedValueOnce({ phonePending: '+919876543210', phoneOtpHash: stored.phoneOtpHash, phoneOtpExpiresAt: new Date(Date.now() + 60_000), phoneOtpAttempts: 0 })
      .mockResolvedValueOnce({ phone: '+919876543210', phoneVerifiedAt: new Date(), phonePending: null, phoneOtpExpiresAt: null });
    const s = await svc().verify(SCHOOL, 'u1', code);
    expect(user.update.mock.calls[1][0].data).toMatchObject({ phone: '+919876543210', phonePending: null, phoneOtpHash: null, phoneOtpAttempts: 0 });
    expect(user.update.mock.calls[1][0].data.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(s.verified).toBe(true);
  });

  it('verify: a wrong code counts an attempt; the sixth try, or an expired code, is refused without a lookup of the hash', async () => {
    user.findFirst.mockResolvedValueOnce({ phonePending: '+919876543210', phoneOtpHash: hash('000000', 'u1'), phoneOtpExpiresAt: new Date(Date.now() + 60_000), phoneOtpAttempts: 0 });
    await expect(svc().verify(SCHOOL, 'u1', '123456')).rejects.toMatchObject({ status: 400 });
    expect(user.update.mock.calls[0][0].data).toEqual({ phoneOtpAttempts: { increment: 1 } });
    user.findFirst.mockResolvedValueOnce({ phonePending: '+919876543210', phoneOtpHash: hash('000000', 'u1'), phoneOtpExpiresAt: new Date(Date.now() + 60_000), phoneOtpAttempts: 5 });
    await expect(svc().verify(SCHOOL, 'u1', '000000')).rejects.toMatchObject({ status: 429 });
    user.findFirst.mockResolvedValueOnce({ phonePending: '+919876543210', phoneOtpHash: hash('000000', 'u1'), phoneOtpExpiresAt: new Date(Date.now() - 1), phoneOtpAttempts: 0 });
    await expect(svc().verify(SCHOOL, 'u1', '000000')).rejects.toMatchObject({ status: 400 });
  });

  it('clear: removes the number and every trace of a pending code, scoped to the caller', async () => {
    user.findFirst.mockResolvedValueOnce({ phone: null, phoneVerifiedAt: null, phonePending: null, phoneOtpExpiresAt: null });
    await svc().clear(SCHOOL, 'u1');
    expect(user.updateMany.mock.calls[0][0]).toEqual({ where: { id: 'u1', schoolId: SCHOOL }, data: { phone: null, phoneVerifiedAt: null, phonePending: null, phoneOtpHash: null, phoneOtpExpiresAt: null, phoneOtpAttempts: 0 } });
  });
});
