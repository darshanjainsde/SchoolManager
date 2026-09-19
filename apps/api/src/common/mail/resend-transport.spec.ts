import { ResendApiError, ResendTransport } from './resend-transport';

describe('ResendTransport', () => {
  it('posts the letter to Resend and hands back the id the webhook will report against', async () => {
    const f = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'em_123' }) });
    const t = new ResendTransport('re_key', f);
    const info = await t.sendMail({ from: { name: 'Raffles "Public" School', address: 'notify@notify.sckools.com' }, to: 'Parent@Example.com', subject: 'Absence notice: Ravi', html: '<p>hi</p>', text: 'hi', replyTo: 'office@raffles.in' });
    expect(info.messageId).toBe('em_123');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_key');
    const body = JSON.parse(init.body);
    // Display names are quoted-safe; a stray double quote must not break the header.
    expect(body.from).toBe("Raffles 'Public' School <notify@notify.sckools.com>");
    expect(body.to).toEqual(['Parent@Example.com']);
    expect(body.reply_to).toBe('office@raffles.in');
    expect(body.text).toBe('hi');
  });

  it("surfaces Resend's refusal as an error the ledger can record", async () => {
    const f = jest.fn().mockResolvedValue({ ok: false, status: 422, json: async () => ({ name: 'validation_error', message: 'The notify.sckools.com domain is not verified' }) });
    await expect(new ResendTransport('re_key', f).sendMail({ from: 'a@b.c', to: 'x@y.z', subject: 's', html: 'h' })).rejects.toMatchObject({ name: 'ResendApiError', httpStatus: 422, message: 'The notify.sckools.com domain is not verified' });
    expect(new ResendApiError('m', 500, null)).toBeInstanceOf(Error);
  });
});
