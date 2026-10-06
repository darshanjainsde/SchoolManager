import { DEDUP_REDIS_TIMEOUT_MS, WhatsAppChannel } from './whatsapp.channel';
import type { NotificationMessage } from './notification.types';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CFG = { token: 't', phoneNumberId: '1357286177463978', wabaId: null, graphVersion: 'v21.0' };
const MSG: NotificationMessage = { kind: 'ABSENCE_NOTICE', payload: { schoolName: 'Raffles', studentName: 'Ravi', date: 'Thu 18 Sep' } };

function db(over: Partial<Record<string, unknown>> = {}) {
  return {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
    student: { findFirst: jest.fn().mockResolvedValue({ guardianPhone: '98765 43210' }) },
    teacher: { findFirst: jest.fn().mockResolvedValue(null) },
    staff: { findFirst: jest.fn().mockResolvedValue(null) },
    whatsAppSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true, phoneNumberId: null }) },
    whatsAppDelivery: { create: jest.fn().mockResolvedValue({}) },
    ...over,
  };
}
const okFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });

describe('WhatsAppChannel', () => {
  it('is idle when the platform has no credentials — and says nothing per send', async () => {
    const d = db();
    const ch = new WhatsAppChannel(d as never, () => null, okFetch(), () => null);
    expect(await ch.send('p@x', MSG, SCHOOL)).toBe(false);
    expect(d.whatsAppSettings.findUnique).not.toHaveBeenCalled();
    expect(ch.configured).toBe(false);
  });

  it('sends nothing for a school that has not switched WhatsApp on, even when the platform can', async () => {
    const d = db({ whatsAppSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: false, phoneNumberId: null }) } });
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('p@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    // The switch is read with the school in the where — never a global row.
    expect(d.whatsAppSettings.findUnique.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL });
  });

  it('turns the login email into the guardian phone, sends the template, and writes a SENT ledger row under that school', async () => {
    const d = db();
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('p@x', MSG, SCHOOL)).toBe(true);
    expect(d.user.findFirst.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL, email: 'p@x' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1357286177463978/messages');
    const body = JSON.parse(init.body);
    expect(body.to).toBe('919876543210');
    expect(body.template.name).toBe('sckools_absence_notice');
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(['Raffles', 'Ravi', 'Thu 18 Sep']);
    expect(d.whatsAppDelivery.create.mock.calls[0][0].data).toMatchObject({ schoolId: SCHOOL, phone: '+919876543210', kind: 'ABSENCE_NOTICE', status: 'SENT', waMessageId: 'wamid.1' });
  });

  it("a school's own number wins over the platform's", async () => {
    const d = db({ whatsAppSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true, phoneNumberId: '999' }) } });
    const f = okFetch();
    await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('p@x', MSG, SCHOOL);
    expect(f.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/999/messages');
  });

  it('a teacher login reaches the teacher, not a guardian', async () => {
    const d = db({ student: { findFirst: jest.fn().mockResolvedValue(null) }, teacher: { findFirst: jest.fn().mockResolvedValue({ phone: '+91 91234 56789', whatsappOptIn: true }) } });
    const f = okFetch();
    await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('t@x', MSG, SCHOOL);
    expect(JSON.parse(f.mock.calls[0][1].body).to).toBe('919123456789');
  });

  it('a teacher who said no is not messaged', async () => {
    // The record carries `whatsappOptIn` and the teacher onboarding sheet asks
    // for it in as many words. Nothing read it on the way out, so a teacher
    // who declined was messaged anyway — the wrong side of WhatsApp's own
    // policy, which permits contact only where the recipient has confirmed
    // they want it, and the fastest way to collect the blocks that pause a
    // template for three hours, then six, then disable it for good.
    const d = db({ student: { findFirst: jest.fn().mockResolvedValue(null) }, teacher: { findFirst: jest.fn().mockResolvedValue({ phone: '+91 91234 56789', whatsappOptIn: false }) } });
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('t@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('refusing is about the PERSON, not the phone column', async () => {
    // A teacher who declined but has a verified login number would otherwise
    // still be reachable, because the verified number is tried first.
    const d = db({
      user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1', phone: '+91 90000 11111', phoneVerifiedAt: new Date() }) },
      student: { findFirst: jest.fn().mockResolvedValue(null) },
      teacher: { findFirst: jest.fn().mockResolvedValue({ phone: null, whatsappOptIn: false }) },
    });
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('t@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('no usable phone → nothing sent, nothing recorded', async () => {
    const d = db({ student: { findFirst: jest.fn().mockResolvedValue({ guardianPhone: 'office' }) } });
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('p@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(d.whatsAppDelivery.create).not.toHaveBeenCalled();
  });

  it("Meta's refusal becomes a FAILED row with the reason, and resolves false instead of throwing", async () => {
    const d = db();
    const f = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Template name does not exist', code: 132001 } }) });
    expect(await new WhatsAppChannel(d as never, () => CFG, f, () => null).send('p@x', MSG, SCHOOL)).toBe(false);
    expect(d.whatsAppDelivery.create.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', error: 'Template name does not exist (code 132001)' });
  });

  it('a missing settings table (migration not yet run) reads as off — never a thrown error that would fail the outbox row', async () => {
    const d = db({ whatsAppSettings: { findUnique: jest.fn().mockRejectedValue(new Error('relation "WhatsAppSettings" does not exist')) } });
    const f = okFetch();
    await expect(new WhatsAppChannel(d as never, () => CFG, f, () => null).send('p@x', MSG, SCHOOL)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('caches the switch per school for a minute and forgets it on save', async () => {
    const d = db();
    const ch = new WhatsAppChannel(d as never, () => CFG, okFetch(), () => null);
    await ch.send('p@x', MSG, SCHOOL);
    await ch.send('p@x', MSG, SCHOOL);
    expect(d.whatsAppSettings.findUnique).toHaveBeenCalledTimes(1);
    ch.forget(SCHOOL);
    await ch.send('p@x', MSG, SCHOOL);
    expect(d.whatsAppSettings.findUnique).toHaveBeenCalledTimes(2);
  });

  describe('one copy per phone', () => {
    // A school-wide notice: identical words for every login on the phone.
    const NOTICE: NotificationMessage = { kind: 'ABSENCE_NOTICE', payload: { schoolName: 'Raffles', studentName: 'Ravi', date: 'Thu 18 Sep' } };
    const channel = (opts: { redis: () => never | null; d?: ReturnType<typeof db>; f?: jest.Mock }) =>
      new WhatsAppChannel((opts.d ?? db()) as never, () => CFG, opts.f ?? okFetch(), opts.redis as never);

    it('two servers sending the same notice to one phone send it once (Redis)', async () => {
      const store = new Set<string>();
      const redis = { status: 'ready', set: jest.fn(async (k: string) => (store.has(k) ? null : (store.add(k), 'OK'))) };
      const f = okFetch();
      const a = channel({ redis: () => redis as never, f });
      const b = channel({ redis: () => redis as never, f });
      await a.send('p@x', NOTICE, SCHOOL);
      await b.send('p@x', NOTICE, SCHOOL);
      expect(f).toHaveBeenCalledTimes(1);
      expect(redis.set).toHaveBeenCalledWith(expect.stringMatching(/^wa:dedup:[0-9a-f]{32}$/), '1', 'EX', 60, 'NX');
      // The phone number is personal data: never in the key.
      expect(redis.set.mock.calls[0][0]).not.toContain('9876543210');
    });

    it('Redis down: falls back to memory, never throws, never sends twice from one server', async () => {
      const redis = { status: 'ready', set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
      const f = okFetch();
      const c = channel({ redis: () => redis as never, f });
      await expect(c.send('p@x', NOTICE, SCHOOL)).resolves.toBe(true);
      await expect(c.send('p@x', NOTICE, SCHOOL)).resolves.toBe(true);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it('Redis that cannot connect: memory fallback, no throw', async () => {
      const redis = { status: 'end', connect: jest.fn().mockRejectedValue(new Error('down')), set: jest.fn() };
      const f = okFetch();
      const c = channel({ redis: () => redis as never, f });
      await c.send('p@x', NOTICE, SCHOOL);
      await c.send('p@x', NOTICE, SCHOOL);
      expect(f).toHaveBeenCalledTimes(1);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('per-child notices to one phone are not duplicates of each other', async () => {
      const names: Record<string, string> = { 'c1@x': 'Ravi', 'c2@x': 'Anaya' };
      const d = db({
        user: { findFirst: jest.fn(async (a: { where: { email: string } }) => ({ id: a.where.email })) },
        student: { findFirst: jest.fn(async (a: { where: { userId: string } }) => ({ guardianPhone: '98765 43210', firstName: names[a.where.userId], lastName: 'Sharma', classSection: null })) },
      });
      const f = okFetch();
      const c = channel({ redis: () => null, d, f });
      // RESULTS_PUBLISHED names the child (from the login) in its parameters.
      const results = { kind: 'RESULTS_PUBLISHED', payload: { schoolName: 'Raffles', subjectName: 'Maths', examTitle: 'Unit 1' } } as unknown as NotificationMessage;
      await c.send('c1@x', results, SCHOOL);
      await c.send('c2@x', results, SCHOOL);
      expect(f).toHaveBeenCalledTimes(2);
    });

    const fakeRedis = () => {
      const store = new Set<string>();
      return {
        store,
        status: 'ready',
        set: jest.fn(async (k: string) => (store.has(k) ? null : (store.add(k), 'OK'))),
        del: jest.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
      };
    };
    const siblings = () =>
      db({
        user: { findFirst: jest.fn(async (a: { where: { email: string } }) => ({ id: a.where.email })) },
        student: { findFirst: jest.fn(async (a: { where: { userId: string } }) => ({ guardianPhone: '98765 43210', firstName: a.where.userId, lastName: 'Sharma', classSection: null })) },
      });
    const absenceFor = (studentName: string): NotificationMessage => ({ kind: 'ABSENCE_NOTICE', payload: { schoolName: 'Raffles', studentName, date: 'Thu 18 Sep' } });

    it('two children on one guardian phone get two absence notices (memory path)', async () => {
      const f = okFetch();
      const c = channel({ redis: () => null, d: siblings(), f });
      await c.send('Ravi', absenceFor('Ravi'), SCHOOL);
      await c.send('Anaya', absenceFor('Anaya'), SCHOOL);
      expect(f).toHaveBeenCalledTimes(2);
    });

    it('two children on one guardian phone get two absence notices (Redis path, two distinct keys)', async () => {
      const redis = fakeRedis();
      const f = okFetch();
      const c = channel({ redis: () => redis as never, d: siblings(), f });
      await c.send('Ravi', absenceFor('Ravi'), SCHOOL);
      await c.send('Anaya', absenceFor('Anaya'), SCHOOL);
      expect(f).toHaveBeenCalledTimes(2);
      expect(redis.store.size).toBe(2);
      for (const k of redis.store) expect(k).toMatch(/^wa:dedup:[0-9a-f]{32}$/);
    });

    describe('a stalled Redis', () => {
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => jest.useRealTimers());

      it('is abandoned after DEDUP_REDIS_TIMEOUT_MS: the send goes out once and memory dedupes the next', async () => {
        const redis = { status: 'ready', set: jest.fn(() => new Promise(() => undefined)) };
        const f = okFetch();
        const c = channel({ redis: () => redis as never, f });
        const first = c.send('p@x', NOTICE, SCHOOL);
        await jest.advanceTimersByTimeAsync(DEDUP_REDIS_TIMEOUT_MS);
        await expect(first).resolves.toBe(true);
        expect(f).toHaveBeenCalledTimes(1);
        const second = c.send('p@x', NOTICE, SCHOOL);
        await jest.advanceTimersByTimeAsync(DEDUP_REDIS_TIMEOUT_MS);
        await expect(second).resolves.toBe(true);
        expect(f).toHaveBeenCalledTimes(1);
      });
    });

    describe('a failed delivery gives the claim back', () => {
      const failing = () => jest.fn().mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: 'boom', code: 1 } }) }).mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.2' }] }) });

      it('Redis path: an identical send right after a failure is attempted', async () => {
        const redis = fakeRedis();
        const f = failing();
        const c = channel({ redis: () => redis as never, f });
        await expect(c.send('p@x', NOTICE, SCHOOL)).resolves.toBe(false);
        expect(redis.del).toHaveBeenCalledTimes(1);
        await expect(c.send('p@x', NOTICE, SCHOOL)).resolves.toBe(true);
        expect(f).toHaveBeenCalledTimes(2);
      });

      it('memory path: an identical send right after a failure is attempted', async () => {
        const f = failing();
        const c = channel({ redis: () => null, f });
        await expect(c.send('p@x', NOTICE, SCHOOL)).resolves.toBe(false);
        await expect(c.send('p@x', NOTICE, SCHOOL)).resolves.toBe(true);
        expect(f).toHaveBeenCalledTimes(2);
      });

      it('a Redis that fails on release does not throw', async () => {
        const redis = { ...fakeRedis(), del: jest.fn().mockRejectedValue(new Error('down')) };
        const c = channel({ redis: () => redis as never, f: failing() });
        await expect(c.send('p@x', NOTICE, SCHOOL)).resolves.toBe(false);
      });
    });

    it('warns once when Redis is configured but unreachable', async () => {
      const redis = { status: 'end', connect: jest.fn().mockRejectedValue(new Error('down')), set: jest.fn() };
      const c = channel({ redis: () => redis as never });
      const warn = jest.spyOn((c as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn').mockImplementation(() => undefined);
      await c.send('p@x', NOTICE, SCHOOL);
      await c.send('p@x', { ...NOTICE, payload: { ...NOTICE.payload, date: 'Fri 19 Sep' } } as NotificationMessage, SCHOOL);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('unreachable');
    });
  });
});
