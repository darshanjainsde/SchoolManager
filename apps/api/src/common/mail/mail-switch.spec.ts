import { platformBrand } from './letterhead';
import { MailService, SENT_EVEN_WHEN_OFF } from './mail.service';
import { MailIdentityService, EMAIL_SWITCH_TTL_MS } from './mail-identity.service';
import type { MailOutcomeSink } from './mail-outcome';

const findUnique = jest.fn();
jest.mock('@skoolos/db', () => ({
  getPlatformPrisma: () => ({ emailSettings: { findUnique } }),
}));

const letter = { title: 't', intro: 'i' };

/**
 * The email master switch (Settings → Notifications → Email). A test school
 * full of made-up addresses turns it off; from then on nothing it sends on its
 * own reaches a mail server — so nothing can bounce back into the office inbox.
 */
describe('MailService.sendLetter — the school email switch', () => {
  function mailWith(opts: { on: boolean; dead?: string | null }) {
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'm1' });
    const ledger = jest.fn(async () => undefined);
    const emailOn = jest.fn(async () => opts.on);
    const whyUndeliverable = jest.fn(async () => opts.dead ?? null);
    const mail = Object.create(MailService.prototype) as MailService;
    Object.assign(mail, {
      logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
      identity: {
        emailOn,
        forSchool: async () => ({
          brand: platformBrand(),
          from: { name: 'Raffles', address: 'office@raffles.in' },
          transporter: { sendMail },
          provider: 'school-smtp',
          usingCustomSender: true,
          schoolId: 'school-1',
        }),
      },
      domains: { whyUndeliverable },
      suppressionFor: async () => null,
      ledger,
      recordSenderFailure: jest.fn(async () => undefined),
    });
    return { mail, sendMail, ledger, emailOn, whyUndeliverable };
  }

  it.each(['ABSENCE_NOTICE', 'ANNOUNCEMENT', 'INVITE', 'COVER_BATCH', 'LETTER', 'PASSED_OUT'])(
    'OFF: %s never reaches the mail server, is SKIPPED channel-off, and writes no ledger row',
    async (kind) => {
      const { mail, sendMail, ledger, whyUndeliverable } = mailWith({ on: false });
      const out: MailOutcomeSink = {};
      expect(await mail.sendLetter('parent@gmail.com', 'school-1', 's', letter, kind, out)).toBe(false);
      expect(out.outcome).toEqual({ status: 'SKIPPED', reason: 'channel-off' });
      expect(sendMail).not.toHaveBeenCalled();
      expect(ledger).not.toHaveBeenCalled();
      // The switch is checked FIRST: no DNS lookups for a school that is off.
      expect(whyUndeliverable).not.toHaveBeenCalled();
    },
  );

  it.each([...SENT_EVEN_WHEN_OFF])('OFF: %s — asked for by the reader themselves — still goes', async (kind) => {
    const { mail, sendMail, emailOn } = mailWith({ on: false });
    expect(await mail.sendLetter('admin@gmail.com', 'school-1', 's', letter, kind)).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(emailOn).not.toHaveBeenCalled();
  });

  it('only the password reset and the console test are exempt', () => {
    expect([...SENT_EVEN_WHEN_OFF].sort()).toEqual(['PASSWORD_RESET', 'TEST']);
  });

  it('ON: mail goes as before', async () => {
    const { mail, sendMail } = mailWith({ on: true });
    const out: MailOutcomeSink = {};
    expect(await mail.sendLetter('parent@gmail.com', 'school-1', 's', letter, 'ANNOUNCEMENT', out)).toBe(true);
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(out.outcome).toEqual({ status: 'SENT', providerId: null });
  });

  it('platform mail (no school) never asks a school switch', async () => {
    const { mail, sendMail, emailOn } = mailWith({ on: false });
    expect(await mail.sendLetter('owner@sckools.com', null, 's', letter, 'LEAD')).toBe(true);
    expect(emailOn).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('ON but the domain can never take mail: SUPPRESSED with the reason, ledgered, never sent', async () => {
    const { mail, sendMail, ledger } = mailWith({ on: true, dead: 'raffles.test is a test domain that never receives mail' });
    const out: MailOutcomeSink = {};
    expect(await mail.sendLetter('t1@raffles.test', 'school-1', 's', letter, 'ANNOUNCEMENT', out)).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
    expect(out.outcome).toEqual({ status: 'SUPPRESSED', reason: 'raffles.test is a test domain that never receives mail' });
    expect(ledger).toHaveBeenCalledWith(expect.objectContaining({ status: 'SUPPRESSED', to: 't1@raffles.test', provider: 'none' }));
  });

  it('a dead domain stops even a password reset (it could only bounce)', async () => {
    const { mail, sendMail } = mailWith({ on: true, dead: 'nothing receives mail at gmial.cmo' });
    expect(await mail.sendLetter('a@gmial.cmo', 'school-1', 's', letter, 'PASSWORD_RESET')).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe('MailIdentityService.emailOn — read fresh enough for stateless instances', () => {
  beforeEach(() => findUnique.mockReset());

  it('no settings row = on (every school starts on)', async () => {
    findUnique.mockResolvedValue(null);
    expect(await new MailIdentityService().emailOn('s1')).toBe(true);
  });

  it('reads the stored switch', async () => {
    findUnique.mockResolvedValue({ enabled: false });
    expect(await new MailIdentityService().emailOn('s1')).toBe(false);
  });

  it('a failed read keeps mail going (on), rather than silently stopping a real school', async () => {
    findUnique.mockRejectedValue(new Error('pooler timeout'));
    expect(await new MailIdentityService().emailOn('s1')).toBe(true);
  });

  it('a burst reads once; another instance sees a change within the switch TTL; invalidate is immediate', async () => {
    jest.useFakeTimers({ now: 1_000_000 });
    try {
      const id = new MailIdentityService();
      findUnique.mockResolvedValue({ enabled: true });
      for (let i = 0; i < 50; i += 1) await id.emailOn('s1');
      expect(findUnique).toHaveBeenCalledTimes(1);

      // The office turns it off on ANOTHER instance: this one catches up after the TTL.
      findUnique.mockResolvedValue({ enabled: false });
      expect(await id.emailOn('s1')).toBe(true);
      jest.setSystemTime(1_000_000 + EMAIL_SWITCH_TTL_MS + 1);
      expect(await id.emailOn('s1')).toBe(false);

      // On THIS instance the save invalidates at once.
      findUnique.mockResolvedValue({ enabled: true });
      id.invalidate('s1');
      expect(await id.emailOn('s1')).toBe(true);
      expect(EMAIL_SWITCH_TTL_MS).toBeLessThanOrEqual(10_000);
    } finally {
      jest.useRealTimers();
    }
  });
});
