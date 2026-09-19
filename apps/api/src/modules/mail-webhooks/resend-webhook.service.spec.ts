import { createHmac } from 'node:crypto';

const findUnique = jest.fn();
const updateMany = jest.fn().mockResolvedValue({ count: 1 });
const upsert = jest.fn().mockResolvedValue({});
jest.mock('@skoolos/db', () => ({ getPlatformPrisma: () => ({ emailDelivery: { findUnique, updateMany }, emailSuppression: { upsert } }) }));

import { ResendWebhookService } from './resend-webhook.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SECRET_RAW = Buffer.from('0123456789abcdef0123456789abcdef');
const ev = (type: string, extra: Record<string, unknown> = {}) => ({ type, created_at: '2026-09-20T05:00:00.000Z', data: { email_id: 'em_1', to: ['parent@gmail.com'], ...extra } });

describe('ResendWebhookService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${SECRET_RAW.toString('base64')}`;
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, to: 'parent@gmail.com', status: 'SENT' });
  });
  afterAll(() => { process.env = env; });

  it('accepts only a Svix-signed body inside the timestamp window', () => {
    const s = new ResendWebhookService();
    const raw = '{"type":"email.delivered"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v1,' + createHmac('sha256', SECRET_RAW).update(`msg_1.${ts}.${raw}`).digest('base64');
    expect(s.signatureValid(raw, { id: 'msg_1', timestamp: ts, signature: sig })).toBe(true);
    expect(s.signatureValid(raw, { id: 'msg_1', timestamp: ts, signature: `v0,${sig.slice(3)} ${sig}` })).toBe(true); // several versions, one matches
    expect(s.signatureValid(raw, { id: 'msg_2', timestamp: ts, signature: sig })).toBe(false);
    expect(s.signatureValid(raw, { id: 'msg_1', timestamp: String(Number(ts) - 3600), signature: sig })).toBe(false); // replay
    delete process.env.RESEND_WEBHOOK_SECRET;
    expect(s.signatureValid(raw, { id: 'msg_1', timestamp: ts, signature: sig })).toBe(false);
  });

  it('delivered → DELIVERED with the time, under the row\'s own school', async () => {
    const out = await new ResendWebhookService().handle(ev('email.delivered'));
    expect(out).toEqual({ events: 1, updated: 1, suppressed: 0 });
    expect(findUnique.mock.calls[0][0].where).toEqual({ providerId: 'em_1' });
    expect(updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 'd1', schoolId: SCHOOL }, data: { status: 'DELIVERED', deliveredAt: new Date('2026-09-20T05:00:00.000Z') } });
  });

  it('a permanent bounce suppresses the address; a transient one does not', async () => {
    const out = await new ResendWebhookService().handle(ev('email.bounced', { bounce: { message: 'mailbox does not exist', type: 'Permanent', subType: 'General' } }));
    expect(out.suppressed).toBe(1);
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'BOUNCED', error: 'mailbox does not exist (Permanent/General)' });
    expect(upsert.mock.calls[0][0]).toMatchObject({ where: { email: 'parent@gmail.com' }, create: { email: 'parent@gmail.com', schoolId: SCHOOL, reason: 'BOUNCE', detail: 'mailbox does not exist' } });

    jest.clearAllMocks();
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, to: 'parent@gmail.com', status: 'SENT' });
    const out2 = await new ResendWebhookService().handle(ev('email.bounced', { bounce: { message: 'mailbox full', type: 'Transient' } }));
    expect(out2.suppressed).toBe(0);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('a spam complaint suppresses immediately', async () => {
    const out = await new ResendWebhookService().handle(ev('email.complained'));
    expect(out.suppressed).toBe(1);
    expect(upsert.mock.calls[0][0].create.reason).toBe('COMPLAINT');
  });

  it('a delay is noted without changing the status; a later stage never regresses', async () => {
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, to: 'parent@gmail.com', status: 'DELIVERED' });
    await new ResendWebhookService().handle(ev('email.delivery_delayed'));
    expect(updateMany.mock.calls[0][0].data).toEqual({ error: 'delivery delayed by the receiving server' });
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, to: 'parent@gmail.com', status: 'BOUNCED' });
    await new ResendWebhookService().handle(ev('email.delivered'));
    expect(updateMany.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('an unknown id or type is counted and ignored', async () => {
    findUnique.mockResolvedValue(null);
    expect(await new ResendWebhookService().handle(ev('email.delivered'))).toEqual({ events: 1, updated: 0, suppressed: 0 });
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, to: 'x', status: 'SENT' });
    expect(await new ResendWebhookService().handle(ev('email.opened'))).toEqual({ events: 1, updated: 0, suppressed: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });
});
