import { toE164, forGraph } from './phone';
import { EXTRA_SUBMISSIONS, HELLO_WORLD, SUBMISSIONS, TEMPLATE_NAMES, coverPendingTemplate, param, placeholderCount, templateFor, verifyCodeTemplate } from './templates';
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
  LEAVE_APPLIED: { kind: 'LEAVE_APPLIED', payload: { schoolName: 'Raffles', leaveId: 'l1', teacherName: 'Priya Nair', dates: 'Mon 22 – Tue 23 Sep 2026', days: 2, reason: null, periodsAffected: 5, approvePayload: 'lv:a:l1:sig', rejectPayload: 'lv:r:l1:sig' } },
  LEAVE_DECIDED: { kind: 'LEAVE_DECIDED', payload: { schoolName: 'Raffles', leaveId: 'l1', decision: 'REJECTED', dates: 'Mon 22 Sep 2026', byName: null } },
  COVER_ASSIGNED: { kind: 'COVER_ASSIGNED', payload: { schoolName: 'Raffles', substitutionId: 's1', when: 'Mon 22 Sep, period 3 (10:15–11:00)', className: '9-A', subjectName: null, originalTeacherName: 'Priya Nair', ackPayload: 'ca:s1:sig' } },
};

describe('a missing template is a permanent refusal, not a blip', () => {
  it('names Meta 132001 separately so the login screen can send people to the password door', async () => {
    const { WhatsAppOtpSender } = await import('../../otp/otp-senders');
    const channel = { configured: true, deliverWith: async () => ({ ok: false, code: 132001 }) };
    const sender = new WhatsAppOtpSender(channel as never);
    const r = await sender.send('+919876543210', '482911', { schoolId: 's1', purpose: 'LOGIN' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not approved on this WhatsApp account/);
  });

  it('still calls an ordinary failure an ordinary failure', async () => {
    const { WhatsAppOtpSender } = await import('../../otp/otp-senders');
    const channel = { configured: true, deliverWith: async () => ({ ok: false, code: 500 }) };
    const sender = new WhatsAppOtpSender(channel as never);
    expect((await sender.send('+919876543210', '1', { schoolId: 's1', purpose: 'LOGIN' })).reason).toBe('WhatsApp did not deliver');
  });
});

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
    expect(templateFor(MESSAGES.TEST_SCHEDULED).params[1]).toBe('your child');
    expect(templateFor(MESSAGES.ANNOUNCEMENT).params[1]).toBe('the whole school');
    expect(templateFor(MESSAGES.ANNOUNCEMENT).params[3]).toBe('Saturday 10 am');
    expect(templateFor(MESSAGES.TEST_REMINDER).params[5]).toBe('tomorrow');
  });

  describe('one guardian phone, two children — every notice about a child names the child', () => {
    const ravi = { child: { name: 'Ravi Sharma', className: '5-B' } };
    it('test, reminder and results carry "Name (class)"', () => {
      expect(templateFor(MESSAGES.TEST_SCHEDULED, ravi).params[1]).toBe('Ravi Sharma (5-B)');
      expect(templateFor(MESSAGES.TEST_REMINDER, ravi).params[1]).toBe('Ravi Sharma (5-B)');
      expect(templateFor(MESSAGES.RESULTS_PUBLISHED, ravi).params[3]).toBe('Ravi Sharma (5-B)');
    });
    it('a class announcement names the child in that class; a school-wide one keeps the same words for every child, so the phone gets one copy', () => {
      const forClass = { ...MESSAGES.ANNOUNCEMENT, payload: { ...MESSAGES.ANNOUNCEMENT.payload, className: '5-B' } } as typeof MESSAGES.ANNOUNCEMENT;
      expect(templateFor(forClass, ravi).params[1]).toBe('Ravi Sharma (5-B)');
      expect(templateFor(forClass).params[1]).toBe('5-B');
      expect(templateFor(MESSAGES.ANNOUNCEMENT, ravi).params[1]).toBe('the whole school');
      expect(templateFor(MESSAGES.ANNOUNCEMENT, { child: { name: 'Meera Sharma', className: '8-A' } }).params[1]).toBe('the whole school');
    });
    it('a child with no section yet is named without a class; a teacher recipient gets the plain fallback', () => {
      expect(templateFor(MESSAGES.RESULTS_PUBLISHED, { child: { name: 'Ravi Sharma', className: null } }).params[3]).toBe('Ravi Sharma');
      expect(templateFor(MESSAGES.RESULTS_PUBLISHED, { child: null }).params[3]).toBe('your child');
    });
  });

  it("hello_world is Meta's sample: no parameters, en_US", () => expect(HELLO_WORLD).toEqual({ name: 'hello_world', language: 'en_US', params: [] }));

  it('the leave request carries its two signed buttons in the template positions Meta will have them, and the cover its one', () => {
    const t = templateFor(MESSAGES.LEAVE_APPLIED);
    expect(t.buttons).toEqual([{ type: 'quick_reply', index: 0, payload: 'lv:a:l1:sig' }, { type: 'quick_reply', index: 1, payload: 'lv:r:l1:sig' }]);
    expect(SUBMISSIONS.LEAVE_APPLIED.buttons).toEqual(['Approve', 'Reject']);
    expect(t.params[4]).toBe('no reason given');
    expect(templateFor(MESSAGES.COVER_ASSIGNED).buttons).toEqual([{ type: 'quick_reply', index: 0, payload: 'ca:s1:sig' }]);
    expect(templateFor(MESSAGES.LEAVE_DECIDED).params).toEqual(['Raffles', 'not approved', 'Mon 22 Sep 2026', 'the office']);
  });

  it('the verification code goes as an AUTHENTICATION template with a copy-code button; the fallback names the school and the count', () => {
    expect(verifyCodeTemplate('482911')).toEqual({ name: 'sckools_verify_code', language: 'en', params: ['482911'], buttons: [{ type: 'copy_code', index: 0, text: '482911' }] });
    expect(EXTRA_SUBMISSIONS.sckools_verify_code.category).toBe('AUTHENTICATION');
    expect(coverPendingTemplate('Raffles', 3).params).toEqual(['Raffles', '3']);
    for (const [name, sub] of Object.entries(EXTRA_SUBMISSIONS)) expect(sub.samples).toHaveLength(placeholderCount(sub.body));
  });
});
