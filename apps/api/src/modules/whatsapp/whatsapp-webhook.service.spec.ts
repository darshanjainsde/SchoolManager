import { createHmac } from 'node:crypto';

const findUnique = jest.fn();
const updateMany = jest.fn().mockResolvedValue({ count: 1 });
jest.mock('@skoolos/db', () => ({ getPlatformPrisma: () => ({ whatsAppDelivery: { findUnique, updateMany } }) }));

import { WhatsAppWebhookService } from './whatsapp-webhook.service';

const SCHOOL = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const status = (s: string, extra: Record<string, unknown> = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: '2126847704608094', changes: [{ field: 'messages', value: { metadata: { phone_number_id: '1357286177463978' }, statuses: [{ id: 'wamid.1', status: s, timestamp: '1789700000', recipient_id: '919876543210', ...extra }] } }] }],
});

describe('WhatsAppWebhookService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'verify-me';
    process.env.META_APP_SECRET = 'shh';
  });
  afterAll(() => { process.env = env; });

  it('echoes the challenge only for the right token and mode', () => {
    const s = new WhatsAppWebhookService();
    expect(s.verifyChallenge('subscribe', 'verify-me', '123')).toBe('123');
    expect(s.verifyChallenge('subscribe', 'wrong', '123')).toBeNull();
    expect(s.verifyChallenge('unsubscribe', 'verify-me', '123')).toBeNull();
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    expect(s.verifyChallenge('subscribe', 'verify-me', '123')).toBeNull();
  });

  it('accepts only a body signed with the app secret; no secret means nothing is accepted', () => {
    const s = new WhatsAppWebhookService();
    const raw = Buffer.from('{"a":1}');
    const good = 'sha256=' + createHmac('sha256', 'shh').update(raw).digest('hex');
    expect(s.signatureValid(raw, good)).toBe(true);
    expect(s.signatureValid(raw, 'sha256=' + '0'.repeat(64))).toBe(false);
    expect(s.signatureValid(raw, undefined)).toBe(false);
    delete process.env.META_APP_SECRET;
    expect(s.signatureValid(raw, good)).toBe(false);
  });

  it("moves a row forward by Meta's message id, under the row's own school", async () => {
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, status: 'SENT' });
    const out = await new WhatsAppWebhookService().handle(status('read'));
    expect(out).toEqual({ statuses: 1, updated: 1, inbound: 0 });
    expect(findUnique.mock.calls[0][0].where).toEqual({ waMessageId: 'wamid.1' });
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'd1', schoolId: SCHOOL });
    expect(call.data.status).toBe('READ');
    expect(call.data.readAt).toEqual(new Date(1789700000 * 1000));
  });

  it('never lets an earlier stage overwrite a later one (delivered after read)', async () => {
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, status: 'READ' });
    await new WhatsAppWebhookService().handle(status('delivered'));
    expect(updateMany.mock.calls[0][0].data.status).toBeUndefined();
    expect(updateMany.mock.calls[0][0].data.deliveredAt).toBeDefined();
  });

  it("records Meta's failure reason", async () => {
    findUnique.mockResolvedValue({ id: 'd1', schoolId: SCHOOL, status: 'SENT' });
    await new WhatsAppWebhookService().handle(status('failed', { errors: [{ code: 131026, title: 'Message undeliverable' }] }));
    expect(updateMany.mock.calls[0][0].data).toMatchObject({ status: 'FAILED', error: 'Message undeliverable (code 131026)' });
  });

  it('a receipt for a message we never sent is counted and ignored', async () => {
    findUnique.mockResolvedValue(null);
    expect(await new WhatsAppWebhookService().handle(status('sent'))).toEqual({ statuses: 1, updated: 0, inbound: 0 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('counts inbound replies without touching the ledger', async () => {
    const body = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ id: 'm', from: '919876543210', type: 'text', text: { body: 'ok' } }] } }] }] };
    expect(await new WhatsAppWebhookService().handle(body as never)).toEqual({ statuses: 0, updated: 0, inbound: 1 });
  });
});
