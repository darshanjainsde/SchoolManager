import { WhatsAppOtpSender } from './otp-senders';
import type { WhatsAppChannel } from '../notifications/whatsapp.channel';

/**
 * THE SESSION-WINDOW FALLBACK.
 *
 * Meta gates the AUTHENTICATION category per account and refuses ours
 * (subcode 2388185, verified against the Graph API on 2026-09-30 — a plain
 * UTILITY template was accepted in the same minute, so it is the category
 * that is blocked, not the token or the account). Without a template a code
 * can still travel as FREE TEXT, which Meta allows inside the 24-hour window
 * a person opens by writing to the business first.
 *
 * That window is not a workaround's weak spot — it is the same proof the
 * template would have given: only somebody holding the number can open it
 * AND read the reply.
 */
const ctx = { schoolId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', purpose: 'VERIFY_PHONE' as const };

function channelWith(results: { ok: boolean; code: number | null }[]) {
  const labels: string[] = [];
  const deliverWith = jest.fn(async (_s: string, _p: string, _k: string, label: string) => {
    labels.push(label);
    return results[labels.length - 1] ?? { ok: false, code: null };
  });
  return { channel: { configured: true, deliverWith, senderNumber: async () => '+91 95999 15010' } as unknown as WhatsAppChannel, labels };
}

describe('WhatsAppOtpSender', () => {
  it('sends the template when it is approved, and never falls back', async () => {
    const { channel, labels } = channelWith([{ ok: true, code: null }]);
    await expect(new WhatsAppOtpSender(channel).send('+919876543210', '482911', ctx)).resolves.toEqual({ ok: true, code: null });
    expect(labels).toEqual(['sckools_verify_code']);
  });

  it('falls back to free text when the template is not approved (132001)', async () => {
    const { channel, labels } = channelWith([
      { ok: false, code: 132001 },
      { ok: true, code: null },
    ]);
    await expect(new WhatsAppOtpSender(channel).send('+919876543210', '482911', ctx)).resolves.toEqual({ ok: true, code: null });
    expect(labels).toEqual(['sckools_verify_code', 'session_text']);
  });

  it('asks for the window when free text is refused outside it (131047)', async () => {
    const { channel } = channelWith([
      { ok: false, code: 132001 },
      { ok: false, code: 131047 },
    ]);
    await expect(new WhatsAppOtpSender(channel).send('+919876543210', '482911', ctx)).resolves.toEqual({
      ok: false,
      code: 131047,
      reason: 'no open WhatsApp window',
    });
  });

  it('does not offer the window for failures the window cannot fix', async () => {
    // Not on WhatsApp at all: no template, no text, no instruction that helps.
    const { channel, labels } = channelWith([{ ok: false, code: 131026 }]);
    await expect(new WhatsAppOtpSender(channel).send('+919876543210', '482911', ctx)).resolves.toMatchObject({ ok: false, reason: 'not on WhatsApp' });
    expect(labels).toEqual(['sckools_verify_code']);
  });

  it('carries the six digits into the text it sends', async () => {
    const sent: string[] = [];
    const channel = {
      configured: true,
      deliverWith: jest.fn(async (_s: string, _p: string, _k: string, label: string, fn: (c: unknown, p: unknown, f: unknown) => Promise<unknown>) => {
        if (label === 'sckools_verify_code') return { ok: false, code: 132001 };
        await fn({ phoneNumberId: 'x', token: 't', graphVersion: 'v21.0' }, null, (async (_u: string, init: { body: string }) => {
          sent.push(JSON.parse(init.body).text.body);
          return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) };
        }) as unknown as typeof fetch);
        return { ok: true, code: null };
      }),
      senderNumber: async () => '+91 95999 15010',
    } as unknown as WhatsAppChannel;
    await new WhatsAppOtpSender(channel).send('+919876543210', '482911', ctx);
    expect(sent[0]).toContain('482911');
    // Meta's own authentication copy says this, and a code that does not is
    // the one people forward to a stranger who asked for it.
    expect(sent[0]).toMatch(/do not share/i);
  });
});
