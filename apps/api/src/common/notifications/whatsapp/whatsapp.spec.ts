import { toE164, forGraph } from './phone';
import { HELLO_WORLD, SUBMISSIONS, TEMPLATE_NAMES, param, placeholderCount, templateFor } from './templates';
import type { NotificationKind, NotificationMessage } from '../notification.types';

describe('toE164', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['0091 9876543210', '+919876543210'],
    ['+1 (555) 159-7744', '+15551597744'],
  ])('normalises %s', (raw, want) => expect(toE164(raw)).toBe(want));

  it.each(['', null, undefined, '12345', '0141-2345678', 'call me', '1234567890'])('rejects %s', (raw) =>
    expect(toE164(raw as string)).toBeNull(),
  );

  it('hands the Graph API digits without the plus', () => expect(forGraph('+919876543210')).toBe('919876543210'));
});

describe('param', () => {
  it("never yields what Meta refuses: newlines, 4+ spaces, empty, >1024", () => {
    expect(param('a\nb\tc    d')).toBe('a b c d');
    expect(param('   ')).toBe('—');
    expect(param(null, 'x')).toBe('x');
    expect(param('y'.repeat(2000)).length).toBe(1024);
  });
});

const MESSAGES: { [K in NotificationKind]: NotificationMessage & { kind: K } } = {
  TEST_SCHEDULED: { kind: 'TEST_SCHEDULED', payload: { schoolName: 'Raffles', subjectName: 'Maths', examTitle: 'UT 2', scheduledAt: 'Mon 6 Oct' } },
  TEST_REMINDER: { kind: 'TEST_REMINDER', payload: { schoolName: 'Raffles', subjectName: 'Maths', examTitle: 'UT 2', scheduledAt: 'Mon 6 Oct', daysUntil: 1 } },
  RESULTS_PUBLISHED: { kind: 'RESULTS_PUBLISHED', payload: { schoolName: 'Raffles', subjectName: 'Maths', examTitle: 'UT 2' } },
  ABSENCE_NOTICE: { kind: 'ABSENCE_NOTICE', payload: { schoolName: 'Raffles', studentName: 'Ravi', date: 'Thu 18 Sep' } },
  ANNOUNCEMENT: { kind: 'ANNOUNCEMENT', payload: { schoolName: 'Raffles', title: 'PTM', body: 'Saturday\n10 am', className: null } },
  DIARY_REMARK: { kind: 'DIARY_REMARK', payload: { schoolName: 'Raffles', studentName: 'Ravi', teacherName: 'Priya', className: '5-B', date: 'Thu', remark: 'Homework not done.' } },
  LOW_ATTENDANCE: { kind: 'LOW_ATTENDANCE', payload: { schoolName: 'Raffles', studentName: 'Ravi', className: '5-B', percent: 68, threshold: 75, period: 'Jul–Sep' } },
};

describe('templateFor ↔ SUBMISSIONS', () => {
  it.each(Object.keys(MESSAGES) as NotificationKind[])('%s: params match the body placeholders, and the name is the registered one', (kind) => {
    const t = templateFor(MESSAGES[kind]);
    expect(t.name).toBe(TEMPLATE_NAMES[kind]);
    expect(t.language).toBe('en');
    expect(t.params).toHaveLength(placeholderCount(SUBMISSIONS[kind].body));
    expect(SUBMISSIONS[kind].samples).toHaveLength(t.params.length);
    for (const p of t.params) expect(p).toMatch(/^\S(.*\S)?$/);
  });

  it('every message names the school first — a family with children at two schools always knows who is speaking', () => {
    for (const kind of Object.keys(MESSAGES) as NotificationKind[]) expect(templateFor(MESSAGES[kind]).params[0]).toBe('Raffles');
  });

  it('an optional field becomes a real word, never an empty parameter', () => {
    expect(templateFor(MESSAGES.TEST_SCHEDULED).params[4]).toBe("your child's class");
    expect(templateFor(MESSAGES.ANNOUNCEMENT).params[1]).toBe('the whole school');
    expect(templateFor(MESSAGES.ANNOUNCEMENT).params[3]).toBe('Saturday 10 am');
    expect(templateFor(MESSAGES.TEST_REMINDER).params[4]).toBe('tomorrow');
  });

  it("hello_world is Meta's sample: no parameters, en_US", () => expect(HELLO_WORLD).toEqual({ name: 'hello_world', language: 'en_US', params: [] }));
});
