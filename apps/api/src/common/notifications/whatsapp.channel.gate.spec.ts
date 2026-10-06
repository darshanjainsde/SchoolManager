jest.mock('./whatsapp/templates', () => {
  const actual = jest.requireActual('./whatsapp/templates');
  return { ...actual, templateFor: jest.fn(actual.templateFor) };
});

import { WhatsAppChannel } from './whatsapp.channel';
import { templateFor, type WhatsAppTemplate } from './whatsapp/templates';
import type { NotificationMessage } from './notification.types';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CFG = { token: 't', phoneNumberId: '1357286177463978', wabaId: '1615000000000000', graphVersion: 'v21.0' };
const MSG: NotificationMessage = { kind: 'ABSENCE_NOTICE', payload: { schoolName: 'Raffles', studentName: 'Ravi', date: 'Thu 18 Sep' } };
const PARAMS = ['Raffles', 'Mon 13 Oct, period 3', '9-A', 'Maths', 'Priya Nair'];
const V1: WhatsAppTemplate = { name: 'sckools_cover_assigned', language: 'en', params: PARAMS, buttons: [{ type: 'quick_reply', index: 0, payload: 'ack' }] };
const V2: WhatsAppTemplate = {
  name: 'sckools_cover_assigned_v2', language: 'en', params: PARAMS,
  buttons: [{ type: 'quick_reply', index: 0, payload: 'ack' }, { type: 'quick_reply', index: 1, payload: 'cant' }],
  fallback: V1,
};

function db() {
  return {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'u1' }) },
    student: { findFirst: jest.fn().mockResolvedValue({ guardianPhone: '98765 43210' }) },
    teacher: { findFirst: jest.fn().mockResolvedValue(null) },
    staff: { findFirst: jest.fn().mockResolvedValue(null) },
    whatsAppSettings: { findUnique: jest.fn().mockResolvedValue({ enabled: true, phoneNumberId: null }) },
    whatsAppDelivery: { create: jest.fn().mockResolvedValue({}) },
  };
}
const okFetch = () => jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.1' }] }) });
const buttonsOf = (f: jest.Mock) => JSON.parse(f.mock.calls[0][1].body).template.components.filter((c: { type: string }) => c.type === 'button');

describe('WhatsAppChannel — a template Meta has not approved yet', () => {
  beforeEach(() => (templateFor as jest.Mock).mockClear());

  it('sends the approved v1 while v2 waits for review', async () => {
    (templateFor as jest.Mock).mockReturnValueOnce(V2);
    const f = okFetch();
    const ch = new WhatsAppChannel(db() as never, () => CFG, f, () => null, { isApproved: async () => false });
    expect(await ch.send('t@x', MSG, SCHOOL)).toBe(true);
    expect(JSON.parse(f.mock.calls[0][1].body).template.name).toBe('sckools_cover_assigned');
    expect(buttonsOf(f)).toHaveLength(1);
  });

  it('sends v2 the moment Meta approves it', async () => {
    (templateFor as jest.Mock).mockReturnValueOnce(V2);
    const f = okFetch();
    const ch = new WhatsAppChannel(db() as never, () => CFG, f, () => null, { isApproved: async () => true });
    await ch.send('t@x', MSG, SCHOOL);
    expect(JSON.parse(f.mock.calls[0][1].body).template.name).toBe('sckools_cover_assigned_v2');
    expect(buttonsOf(f)).toHaveLength(2);
  });

  it('a gated template with no v1 sends nothing and records nothing', async () => {
    (templateFor as jest.Mock).mockReturnValueOnce({ ...V2, fallback: undefined });
    const d = db();
    const f = okFetch();
    const ch = new WhatsAppChannel(d as never, () => CFG, f, () => null, { isApproved: async () => false });
    expect(await ch.send('t@x', MSG, SCHOOL)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect(d.whatsAppDelivery.create).not.toHaveBeenCalled();
  });
});
