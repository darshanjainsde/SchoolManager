import { noticeTopicFrom } from './notice-topic';

const TODAY = '2026-10-06';
const field = (fn: () => unknown) => { try { fn(); return null; } catch (e) { return (e as { getResponse(): { field?: string } }).getResponse().field; } };

describe('noticeTopicFrom', () => {
  it('formats a holiday for a reader', () => {
    expect(noticeTopicFrom({ kind: 'HOLIDAY', closedOn: '2026-10-20', occasion: ' Diwali ', resumesOn: '2026-10-23' }, TODAY))
      .toEqual({ kind: 'HOLIDAY', closedOn: 'Tue 20 Oct 2026', occasion: 'Diwali', resumesOn: 'Fri 23 Oct 2026' });
  });
  it('formats a PTM time as a 12-hour clock', () => {
    expect(noticeTopicFrom({ kind: 'PTM', on: '2026-10-11', at: '10:00' }, TODAY)).toEqual({ kind: 'PTM', on: 'Sun 11 Oct 2026', at: '10:00 am' });
    expect(noticeTopicFrom({ kind: 'PTM', on: '2026-10-11', at: '13:30' }, TODAY)).toEqual({ kind: 'PTM', on: 'Sun 11 Oct 2026', at: '1:30 pm' });
    expect(noticeTopicFrom({ kind: 'PTM', on: '2026-10-11', at: '00:15' }, TODAY)).toMatchObject({ at: '12:15 am' });
  });
  it('refuses a date in the past', () => expect(field(() => noticeTopicFrom({ kind: 'PTM', on: '2026-10-05', at: '10:00' }, TODAY))).toBe('topic.on'));
  it('today is allowed', () => expect(field(() => noticeTopicFrom({ kind: 'PTM', on: TODAY, at: '10:00' }, TODAY))).toBeNull());
  it('refuses a holiday that resumes on or before it starts', () => {
    expect(field(() => noticeTopicFrom({ kind: 'HOLIDAY', closedOn: '2026-10-20', occasion: 'Diwali', resumesOn: '2026-10-20' }, TODAY))).toBe('topic.resumesOn');
  });
  it('refuses a holiday longer than 60 days', () => {
    expect(field(() => noticeTopicFrom({ kind: 'HOLIDAY', closedOn: '2026-10-20', occasion: 'x', resumesOn: '2026-12-25' }, TODAY))).toBe('topic.resumesOn');
  });
  it('refuses a timing change that ends before it starts', () => {
    expect(field(() => noticeTopicFrom({ kind: 'TIMING', on: '2026-10-13', from: '12:30', to: '08:00' }, TODAY))).toBe('topic.to');
  });
  it('refuses an impossible date or time', () => {
    expect(field(() => noticeTopicFrom({ kind: 'PTM', on: '2026-02-30', at: '10:00' }, TODAY))).toBe('topic.on');
    expect(field(() => noticeTopicFrom({ kind: 'PTM', on: '2026-10-11', at: '25:00' }, TODAY))).toBe('topic.at');
  });
  it('refuses an empty or over-long occasion', () => {
    expect(field(() => noticeTopicFrom({ kind: 'HOLIDAY', closedOn: '2026-10-20', occasion: '  ', resumesOn: '2026-10-21' }, TODAY))).toBe('topic.occasion');
    expect(field(() => noticeTopicFrom({ kind: 'HOLIDAY', closedOn: '2026-10-20', occasion: 'x'.repeat(61), resumesOn: '2026-10-21' }, TODAY))).toBe('topic.occasion');
  });
});
