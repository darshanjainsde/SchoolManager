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
  ])('%s → %s', (e, status) => expect(mailFailure(e).status).toBe(status));
});

describe('MailService.sendLetter reports its outcome to a sink', () => {
  function mailWith(sendMail: jest.Mock, suppressed: string | null = null) {
    const mail = Object.create(MailService.prototype) as MailService;
    Object.assign(mail, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      identity: { forSchool: async () => ({ brand: platformBrand(), from: { name: 'Sckools', address: 'hello@sckools.com' }, transporter: { sendMail }, provider: 'resend', usingCustomSender: false, schoolId: null }) },
      suppressionFor: async () => suppressed,
      ledger: async () => undefined,
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
});
