import { WhatsAppChannel } from './whatsapp.channel';
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
    const ch = new WhatsAppChannel(d as never, () => null, okFetch());
    expect(await ch.send('p@x', MSG, SCHOOL)).toBe(false);
    expect(d.whatsAppSettings.findUnique).not.toHaveBeenCalled();
    expect(ch.configured).toBe(false);
  });

  it('sends nothing for a school that has not switched WhatsApp on, even when the platform can', async () => {
    const d = db({ whatsAppSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: false, phoneNumberId: null }) } });
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f).send('p@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    // The switch is read with the school in the where — never a global row.
    expect(d.whatsAppSettings.findUnique.mock.calls[0][0].where).toEqual({ schoolId: SCHOOL });
  });

  it('turns the login email into the guardian phone, sends the template, and writes a SENT ledger row under that school', async () => {
    const d = db();
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f).send('p@x', MSG, SCHOOL)).toBe(true);
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
    await new WhatsAppChannel(d as never, () => CFG, f).send('p@x', MSG, SCHOOL);
    expect(f.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/999/messages');
  });

  it('a teacher login reaches the teacher, not a guardian', async () => {
    const d = db({ student: { findFirst: jest.fn().mockResolvedValue(null) }, teacher: { findFirst: jest.fn().mockResolvedValue({ phone: '+91 91234 56789' }) } });
    const f = okFetch();
    await new WhatsAppChannel(d as never, () => CFG, f).send('t@x', MSG, SCHOOL);
    expect(JSON.parse(f.mock.calls[0][1].body).to).toBe('919123456789');
  });

  it('no usable phone → nothing sent, nothing recorded', async () => {
    const d = db({ student: { findFirst: jest.fn().mockResolvedValue({ guardianPhone: 'office' }) } });
    const f = okFetch();
    expect(await new WhatsAppChannel(d as never, () => CFG, f).send('p@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(d.whatsAppDelivery.create).not.toHaveBeenCalled();
  });

  it("Meta's refusal becomes a FAILED row with the reason, and resolves false instead of throwing", async () => {
    const d = db();
    const f = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'Template name does not exist', code: 132001 } }) });
    expect(await new WhatsAppChannel(d as never, () => CFG, f).send('p@x', MSG, SCHOOL)).toBe(false);
    expect(d.whatsAppDelivery.create.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', error: 'Template name does not exist (code 132001)' });
  });

  it('a missing settings table (migration not yet run) reads as off — never a thrown error that would fail the outbox row', async () => {
    const d = db({ whatsAppSettings: { findUnique: jest.fn().mockRejectedValue(new Error('relation "WhatsAppSettings" does not exist')) } });
    const f = okFetch();
    await expect(new WhatsAppChannel(d as never, () => CFG, f).send('p@x', MSG, SCHOOL)).resolves.toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('caches the switch per school for a minute and forgets it on save', async () => {
    const d = db();
    const ch = new WhatsAppChannel(d as never, () => CFG, okFetch());
    await ch.send('p@x', MSG, SCHOOL);
    await ch.send('p@x', MSG, SCHOOL);
    expect(d.whatsAppSettings.findUnique).toHaveBeenCalledTimes(1);
    ch.forget(SCHOOL);
    await ch.send('p@x', MSG, SCHOOL);
    expect(d.whatsAppSettings.findUnique).toHaveBeenCalledTimes(2);
  });
});
