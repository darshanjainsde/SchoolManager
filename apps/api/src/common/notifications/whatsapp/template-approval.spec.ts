import { APPROVAL_RETRY_MS, APPROVAL_TTL_MS, TemplateApproval, chooseTemplate } from './template-approval';
import type { WhatsAppTemplate } from './templates';

const CFG = { token: 't', phoneNumberId: '1357286177463978', wabaId: '1615000000000000', graphVersion: 'v21.0' };
const listing = (rows: { name: string; status: string; language?: string }[]) =>
  jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: rows.map((r) => ({ language: 'en', ...r })) }) });

describe('TemplateApproval — is a NEW template approved yet?', () => {
  it('never looks up a name Meta approved long ago', async () => {
    const f = listing([]);
    expect(await new TemplateApproval(() => CFG, f).isApproved('sckools_absence_notice')).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it('a gated name is approved only when Meta lists it APPROVED in English', async () => {
    const f = listing([
      { name: 'sckools_cover_assigned_v2', status: 'PENDING' },
      { name: 'sckools_cover_cancelled', status: 'APPROVED', language: 'en_US' },
    ]);
    const a = new TemplateApproval(() => CFG, f);
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(false);
    expect(await a.isApproved('sckools_cover_cancelled')).toBe(false);
    expect(f.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/1615000000000000/message_templates?fields=name,status,language&limit=200');
    expect(f.mock.calls[0][1]).toEqual({ headers: { Authorization: 'Bearer t' } });
  });

  it('asks Meta at most once per ten minutes, then sees the approval without a deploy', async () => {
    let now = 1_000_000;
    const f = listing([{ name: 'sckools_cover_assigned_v2', status: 'PENDING' }]);
    const a = new TemplateApproval(() => CFG, f, () => now);
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(false);
    now += APPROVAL_TTL_MS - 1;
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
    f.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ name: 'sckools_cover_assigned_v2', status: 'APPROVED', language: 'en' }] }) });
    now += 1;
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('with no WABA id nothing gated is approved, and Meta is not asked', async () => {
    const f = listing([{ name: 'sckools_cover_assigned_v2', status: 'APPROVED' }]);
    expect(await new TemplateApproval(() => ({ ...CFG, wabaId: null }), f).isApproved('sckools_cover_assigned_v2')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('a failed lookup keeps the last answer and asks again after a minute, not ten', async () => {
    let now = 1_000_000;
    const f = listing([{ name: 'sckools_cover_assigned_v2', status: 'APPROVED' }]);
    const a = new TemplateApproval(() => CFG, f, () => now);
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(true);
    now += APPROVAL_TTL_MS;
    f.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    expect(await a.isApproved('sckools_cover_assigned_v2')).toBe(true);
    now += APPROVAL_RETRY_MS;
    await a.isApproved('sckools_cover_assigned_v2');
    expect(f).toHaveBeenCalledTimes(3);
  });
});

describe('chooseTemplate', () => {
  const v1: WhatsAppTemplate = { name: 'sckools_cover_assigned', language: 'en', params: ['a'] };
  const v2: WhatsAppTemplate = { name: 'sckools_cover_assigned_v2', language: 'en', params: ['a'], fallback: v1 };
  it('sends v2 once approved, v1 until then, and nothing for a gated name with no v1', async () => {
    expect(await chooseTemplate(v2, { isApproved: async () => true })).toBe(v2);
    expect(await chooseTemplate(v2, { isApproved: async () => false })).toBe(v1);
    expect(await chooseTemplate({ ...v2, fallback: undefined }, { isApproved: async () => false })).toBeNull();
  });
});
