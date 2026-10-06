import { EXTRA_SUBMISSIONS, NOTICE_TEMPLATES, placeholderCount, templateFor } from './templates';

const base = { schoolName: 'Raffles Public School', title: 'T', body: 'B', postedOn: 'Mon 6 Oct', className: '5-B' as string | null };
const child = { child: { name: 'Ravi Sharma', className: '5-B' } };

/** The bodies Meta approved on 2026-10-01, read back with whatsapp-verify on 2026-10-06. */
const APPROVED: Record<string, string> = {
  sckools_holiday_notice: 'Holiday at {{1}}: the school will be closed on {{2}} for {{3}}. Classes resume as usual on {{4}}. Nothing else changes.',
  sckools_ptm_notice: 'Parents meeting at {{1}}: the meeting for class {{2}} is on {{3}} at {{4}}. Please come to the school reception a few minutes early.',
  sckools_timing_change: 'Timing change at {{1}}: on {{2}} the school day will run from {{3}} to {{4}} instead of the usual hours. Buses follow the same change.',
  sckools_fee_due: 'Fees at {{1}}: the fees for {{2}} are due on {{3}}. Open the Sckools app to pay, to see the bill, or to tell the office you have already paid.',
};

describe('notice topics', () => {
  it('the recorded submissions are exactly what Meta approved', () => {
    for (const [name, body] of Object.entries(APPROVED)) expect(EXTRA_SUBMISSIONS[name]?.body).toBe(body);
  });

  it.each([
    [{ kind: 'HOLIDAY', closedOn: 'Thu 2 Oct 2026', occasion: 'Gandhi Jayanti', resumesOn: 'Fri 3 Oct 2026' }, 'sckools_holiday_notice', ['Raffles Public School', 'Thu 2 Oct 2026', 'Gandhi Jayanti', 'Fri 3 Oct 2026']],
    [{ kind: 'PTM', on: 'Sat 11 Oct 2026', at: '10:00 am' }, 'sckools_ptm_notice', ['Raffles Public School', '5-B', 'Sat 11 Oct 2026', '10:00 am']],
    [{ kind: 'TIMING', on: 'Mon 13 Oct 2026', from: '8:00 am', to: '12:30 pm' }, 'sckools_timing_change', ['Raffles Public School', 'Mon 13 Oct 2026', '8:00 am', '12:30 pm']],
    [{ kind: 'FEE', term: 'Term 2', dueOn: 'Mon 13 Oct 2026' }, 'sckools_fee_due', ['Raffles Public School', 'Term 2 of Ravi Sharma (5-B)', 'Mon 13 Oct 2026']],
  ] as const)('%o → %s with the right parameters', (topic, name, params) => {
    const t = templateFor({ kind: 'ANNOUNCEMENT', payload: { ...base, topic } }, child);
    expect(t.name).toBe(name);
    expect(t.params).toEqual(params);
    expect(t.params.length).toBe(placeholderCount(APPROVED[name]));
  });

  it('a whole-school PTM names the child\'s own class', () => {
    const t = templateFor({ kind: 'ANNOUNCEMENT', payload: { ...base, className: null, topic: { kind: 'PTM', on: 'Sat 11 Oct 2026', at: '10:00 am' } } }, child);
    expect(t.params[1]).toBe('5-B');
  });

  it('no topic keeps the general pointer, and never sends the body', () => {
    const t = templateFor({ kind: 'ANNOUNCEMENT', payload: { ...base, topic: null } }, child);
    expect(t.name).toBe('sckools_notice_posted');
    expect(t.params).not.toContain('B');
  });

  it('every topic has a template', () => {
    expect(Object.keys(NOTICE_TEMPLATES).sort()).toEqual(['FEE', 'HOLIDAY', 'PTM', 'TIMING']);
  });
});
