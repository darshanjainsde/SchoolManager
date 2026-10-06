import { platformBrand } from './letterhead';
import { MailService } from './mail.service';
import { mailFailure, type MailOutcomeSink } from './mail-outcome';
import { ResendApiError } from './resend-transport';

const smtpError = (responseCode: number) => Object.assign(new Error(`SMTP ${responseCode}`), { responseCode });

describe('mailFailure — is it worth trying again?', () => {
  it.each([
    [smtpError(421), 'RETRY'], // mailbox busy, try later
    [smtpError(451), 'RETRY'],
    [smtpError(550), 'FAILED'], // no such mailbox
    [smtpError(554), 'FAILED'],
    [new ResendApiError('validation', 422, 'validation_error'), 'FAILED'],
    [new ResendApiError('slow down', 429, 'rate_limit_exceeded'), 'RETRY'],
    [new ResendApiError('upstream', 503, null), 'RETRY'],
    [new Error('ECONNRESET'), 'RETRY'], // never reached a server
    // Our side, not the recipient's: a config outage must not mass-FAIL a class.
    [smtpError(530), 'RETRY'], // authentication required
    [smtpError(535), 'RETRY'], // authentication failed
    [new ResendApiError('invalid key', 401, 'missing_api_key'), 'RETRY'],
    [new ResendApiError('domain not verified', 403, 'invalid_from_address'), 'RETRY'],
    // No usable recipient at all: the same letter fails every time.
    [Object.assign(new Error('No recipients defined'), { code: 'EENVELOPE' }), 'FAILED'],
    // A server that refused the recipient says for itself whether to retry.
    [Object.assign(new Error('mailbox busy'), { code: 'EENVELOPE', responseCode: 450 }), 'RETRY'],
  ])('%s → %s', (e, status) => expect(mailFailure(e).status).toBe(status));
});

describe('MailService.sendLetter reports its outcome to a sink', () => {
  function mailWith(sendMail: jest.Mock, suppressed: string | null = null, custom = false) {
    const mail = Object.create(MailService.prototype) as MailService;
    Object.assign(mail, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      identity: {
        forSchool: async () => ({
          brand: platformBrand(),
          from: { name: 'Sckools', address: 'hello@sckools.com' },
          transporter: { sendMail },
          provider: custom ? 'school-smtp' : 'resend',
          usingCustomSender: custom,
          schoolId: custom ? 'school-1' : null,
        }),
      },
      suppressionFor: async () => suppressed,
      ledger: async () => undefined,
      recordSenderFailure: jest.fn(async () => undefined),
    });
    return mail;
  }
  const letter = { title: 't', intro: 'i' };

  it('SENT, with the provider id', async () => {
    const out: MailOutcomeSink = {};
    await mailWith(jest.fn().mockResolvedValue({ messageId: 're_1' })).sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(out.outcome).toEqual({ status: 'SENT', providerId: 're_1' });
  });

  it('SUPPRESSED, without touching the transport', async () => {
    const send = jest.fn();
    const out: MailOutcomeSink = {};
    await mailWith(send, 'BOUNCE: hard').sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(out.outcome).toEqual({ status: 'SUPPRESSED', reason: 'BOUNCE: hard' });
    expect(send).not.toHaveBeenCalled();
  });

  it('a 4xx from SMTP is a retry; the boolean is still false for old callers', async () => {
    const out: MailOutcomeSink = {};
    const ok = await mailWith(jest.fn().mockRejectedValue(smtpError(421))).sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(ok).toBe(false);
    expect(out.outcome?.status).toBe('RETRY');
  });

  it("the school's own sender refusing for good is still a RETRY — the retry goes from the platform mailbox; the boolean stays false", async () => {
    const out: MailOutcomeSink = {};
    const mail = mailWith(jest.fn().mockRejectedValue(smtpError(550)), null, true);
    const ok = await mail.sendLetter('a@x', 'school-1', 's', letter, 'LETTER', out);
    expect(ok).toBe(false);
    expect(out.outcome).toEqual({ status: 'RETRY', error: 'SMTP 550' });
    expect((mail as unknown as { recordSenderFailure: jest.Mock }).recordSenderFailure).toHaveBeenCalledWith('school-1', 'SMTP 550');
  });

  it('the platform sender refusing for good stays FAILED', async () => {
    const out: MailOutcomeSink = {};
    await mailWith(jest.fn().mockRejectedValue(smtpError(550))).sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(out.outcome?.status).toBe('FAILED');
  });

  it('a transport that accepted the letter without an id is SENT with providerId null, never a retry', async () => {
    const out: MailOutcomeSink = {};
    const ok = await mailWith(jest.fn().mockResolvedValue({})).sendLetter('a@x', null, 's', letter, 'LETTER', out);
    expect(ok).toBe(true);
    expect(out.outcome).toEqual({ status: 'SENT', providerId: null });
  });
});

