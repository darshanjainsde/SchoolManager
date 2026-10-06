import { APPROVAL_MAX_PAGES, APPROVAL_RETRY_MS, APPROVAL_TTL_MS, TemplateApproval, chooseTemplate } from './template-approval';
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
    expect(f.mock.calls[0][1].headers).toEqual({ Authorization: 'Bearer t' });
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

describe('TemplateApproval — lookups that go wrong or span pages', () => {
  const NAME = 'sckools_cover_assigned_v2';
  const ok = (rows: object[], next?: string) => ({ ok: true, status: 200, json: async () => ({ data: rows, ...(next ? { paging: { next } } : {}) }) });
  // Approve once, then expire the cache, so each case starts from a known previous set.
  async function primed(f: jest.Mock) {
    let now = 1_000_000;
    const a = new TemplateApproval(() => CFG, f, () => now);
    expect(await a.isApproved(NAME)).toBe(true);
    now += APPROVAL_TTL_MS;
    return { a, tick: (ms: number) => (now += ms) };
  }
  const approvedRow = { name: NAME, status: 'APPROVED', language: 'en' };

  it('passes an abort signal, and a timeout keeps the previous set', async () => {
    const f = listing([approvedRow]);
    const { a } = await primed(f);
    expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    f.mockRejectedValueOnce(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
    expect(await a.isApproved(NAME)).toBe(true);
  });

  it('a non-200 keeps the previous set', async () => {
    const f = listing([approvedRow]);
    const { a } = await primed(f);
    f.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await a.isApproved(NAME)).toBe(true);
  });

  it('a malformed body keeps the previous set', async () => {
    const f = listing([approvedRow]);
    const { a } = await primed(f);
    f.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } });
    expect(await a.isApproved(NAME)).toBe(true);
  });

  it('a failure is cached: no fetch just before the retry time, one at it', async () => {
    const f = listing([approvedRow]);
    const { a, tick } = await primed(f);
    f.mockRejectedValue(new Error('down'));
    await a.isApproved(NAME);
    expect(f).toHaveBeenCalledTimes(2);
    tick(APPROVAL_RETRY_MS - 1);
    await a.isApproved(NAME);
    expect(f).toHaveBeenCalledTimes(2);
    tick(1);
    await a.isApproved(NAME);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('concurrent calls share exactly one fetch', async () => {
    const f = listing([approvedRow]);
    const a = new TemplateApproval(() => CFG, f);
    const r = await Promise.all([a.isApproved(NAME), a.isApproved(NAME), a.isApproved('sckools_cover_cancelled')]);
    expect(r).toEqual([true, true, false]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('follows paging.next, so a name on page 2 is found', async () => {
    const f = jest.fn()
      .mockResolvedValueOnce(ok([{ name: 'other', status: 'APPROVED', language: 'en' }], 'https://graph.facebook.com/page2'))
      .mockResolvedValueOnce(ok([approvedRow]));
    expect(await new TemplateApproval(() => CFG, f).isApproved(NAME)).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
    expect(f.mock.calls[1][0]).toBe('https://graph.facebook.com/page2');
  });

  it('stops after 5 pages', async () => {
    const f = jest.fn().mockImplementation(async () => ok([], 'https://graph.facebook.com/more'));
    expect(await new TemplateApproval(() => CFG, f).isApproved(NAME)).toBe(false);
    expect(f).toHaveBeenCalledTimes(APPROVAL_MAX_PAGES);
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
