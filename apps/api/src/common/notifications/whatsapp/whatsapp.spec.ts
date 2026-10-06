import { toE164, forGraph } from './phone';
import { whatsAppConfig, whatsAppConfigProblem } from './graph.client';
import { COVER_ASSIGNED_V2, EXTRA_SUBMISSIONS, GATED_TEMPLATES, HELLO_WORLD, SUBMISSIONS, TEMPLATE_NAMES, coverPendingTemplate, param, placeholderCount, templateFor, templateSubmissions, testNoticeTemplate, verifyCodeTemplate } from './templates';
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
  ANNOUNCEMENT: { kind: 'ANNOUNCEMENT', payload: { schoolName: 'Raffles', title: 'PTM', body: 'Saturday\n10 am', className: null, postedOn: '2 November' } },
  DIARY_REMARK: { kind: 'DIARY_REMARK', payload: { schoolName: 'Raffles', studentName: 'Ravi', teacherName: 'Priya', className: '5-B', date: 'Thu', remark: 'Homework not done.' } },
  LOW_ATTENDANCE: { kind: 'LOW_ATTENDANCE', payload: { schoolName: 'Raffles', studentName: 'Ravi', className: '5-B', percent: 68, threshold: 75, period: 'Jul–Sep' } },
  LEAVE_APPLIED: { kind: 'LEAVE_APPLIED', payload: { schoolName: 'Raffles', leaveId: 'l1', teacherName: 'Priya Nair', dates: 'Mon 22 – Tue 23 Sep 2026', days: 2, reason: null, periodsAffected: 5, approvePayload: 'lv:a:l1:sig', rejectPayload: 'lv:r:l1:sig' } },
  LEAVE_DECIDED: { kind: 'LEAVE_DECIDED', payload: { schoolName: 'Raffles', leaveId: 'l1', decision: 'REJECTED', dates: 'Mon 22 Sep 2026', byName: null } },
  COVER_ASSIGNED: { kind: 'COVER_ASSIGNED', payload: { schoolName: 'Raffles', substitutionId: 's1', when: 'Mon 22 Sep, period 3 (10:15–11:00)', className: '9-A', subjectName: null, originalTeacherName: 'Priya Nair', ackPayload: 'ca:s1:sig' } },
  LEAVE_CANCELLED: { kind: 'LEAVE_CANCELLED', payload: { schoolName: 'Raffles', leaveId: 'l1', teacherName: 'Priya Nair', dates: 'Mon 22 – Tue 23 Sep 2026', releasedCovers: 3 } },
  COVER_CANCELLED: { kind: 'COVER_CANCELLED', payload: { schoolName: 'Raffles', substitutionId: 's1', when: 'Mon 22 Sep, period 3 (10:15–11:00)', className: '9-A', why: 'LEAVE_CANCELLED' } },
  COVER_UNFILLED: { kind: 'COVER_UNFILLED', payload: { schoolName: 'Raffles', gaps: 4, forDate: '2026-09-22', forWhen: 'tomorrow, Tue 22 Sep 2026', note: null } },
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
    // The audience moved to the LAST slot when the announcement template
    // became `notice_posted` (school, title, day, audience) — and the body is
    // no longer a parameter at all.
    expect(templateFor(MESSAGES.ANNOUNCEMENT).params[3]).toBe('the whole school');
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
      expect(templateFor(forClass, ravi).params[3]).toBe('Ravi Sharma (5-B)');
      expect(templateFor(forClass).params[3]).toBe('5-B');
      expect(templateFor(MESSAGES.ANNOUNCEMENT, ravi).params[3]).toBe('the whole school');
      expect(templateFor(MESSAGES.ANNOUNCEMENT, { child: { name: 'Meera Sharma', className: '8-A' } }).params[3]).toBe('the whole school');
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

  it('a withdrawn leave and a called-off cover share the one cover_cancelled card, with words for each reader', () => {
    expect(templateFor(MESSAGES.LEAVE_CANCELLED)).toMatchObject({ name: 'sckools_cover_cancelled', params: ['Raffles', "Priya Nair's leave", 'Mon 22 – Tue 23 Sep 2026', 'it was withdrawn, so 3 covers were released'] });
    expect(templateFor(MESSAGES.COVER_CANCELLED).params).toEqual(['Raffles', 'your cover of 9-A', 'Mon 22 Sep, period 3 (10:15–11:00)', 'the leave it was for was cancelled']);
    expect(templateFor(MESSAGES.COVER_UNFILLED)).toEqual({ name: 'sckools_cover_pending', language: 'en', params: ['Raffles', '4'] });
  });

  it('every reason a cover is called off reads as plain English, and one released cover or none is said right', () => {
    const cov = (why: 'LEAVE_CANCELLED' | 'CHANGED' | 'TEACHER_ON_LEAVE') => templateFor({ ...MESSAGES.COVER_CANCELLED, payload: { ...MESSAGES.COVER_CANCELLED.payload, why } }).params[3];
    expect(cov('CHANGED')).toBe('the office has changed the cover');
    expect(cov('TEACHER_ON_LEAVE')).toBe('you are on leave that day');
    const left = (n: number) => templateFor({ ...MESSAGES.LEAVE_CANCELLED, payload: { ...MESSAGES.LEAVE_CANCELLED.payload, releasedCovers: n } }).params[3];
    expect(left(1)).toBe('it was withdrawn, so 1 cover was released');
    expect(left(0)).toBe('it was withdrawn');
  });

  it('the called-off card is gated until Meta approves it, and has no v1 to fall back to', () => {
    expect(GATED_TEMPLATES.has(templateFor(MESSAGES.COVER_CANCELLED).name)).toBe(true);
    expect(templateFor(MESSAGES.COVER_CANCELLED).fallback).toBeUndefined();
    // The desk's "still need cover" is the APPROVED cover_pending — never held back.
    expect(GATED_TEMPLATES.has(templateFor(MESSAGES.COVER_UNFILLED).name)).toBe(false);
  });
});

/**
 * THE MISCONFIGURATION THAT MADE WHATSAPP "NOT WORK" FOR DAYS.
 *
 * Staging had `WHATSAPP_PHONE_NUMBER_ID` set to the WABA id. Everything
 * looked configured — the settings screen showed a plausible id — and every
 * send died at Meta with code 100 "Object with ID … does not exist", which
 * reads like a permissions problem rather than a paste into the wrong box.
 * Reproduced against the live Graph API on 25 Sep 2026 before this was
 * written; the correct phone number id sends fine.
 */
describe('the sending number is never the business account', () => {
  const base = { WHATSAPP_TOKEN: 'EAAtoken', WHATSAPP_WABA_ID: '1615192556803051' };

  it('refuses a config whose phone number id IS the WABA id', () => {
    const env = { ...base, WHATSAPP_PHONE_NUMBER_ID: '1615192556803051' } as NodeJS.ProcessEnv;
    expect(whatsAppConfig(env)).toBeNull();
  });

  it('says which box the wrong id is in', () => {
    const env = { ...base, WHATSAPP_PHONE_NUMBER_ID: '1615192556803051' } as NodeJS.ProcessEnv;
    expect(whatsAppConfigProblem(env)).toMatch(/same as WHATSAPP_WABA_ID/);
    expect(whatsAppConfigProblem(env)).toMatch(/code 100/);
  });

  it('accepts the real pairing', () => {
    const env = { ...base, WHATSAPP_PHONE_NUMBER_ID: '1415040705015934' } as NodeJS.ProcessEnv;
    expect(whatsAppConfig(env)?.phoneNumberId).toBe('1415040705015934');
    expect(whatsAppConfigProblem(env)).toBeNull();
  });

  it('still works for a school that has no WABA id set', () => {
    // The check must not turn a working install off.
    const env = { WHATSAPP_TOKEN: 'EAAtoken', WHATSAPP_PHONE_NUMBER_ID: '1415040705015934' } as NodeJS.ProcessEnv;
    expect(whatsAppConfig(env)?.phoneNumberId).toBe('1415040705015934');
    expect(whatsAppConfigProblem(env)).toBeNull();
  });

  it('names a missing token and a missing number separately', () => {
    expect(whatsAppConfigProblem({ WHATSAPP_PHONE_NUMBER_ID: '1' } as NodeJS.ProcessEnv)).toMatch(/WHATSAPP_TOKEN/);
    expect(whatsAppConfigProblem({ WHATSAPP_TOKEN: 'EAAx' } as NodeJS.ProcessEnv)).toMatch(/WHATSAPP_PHONE_NUMBER_ID/);
  });
});

/**
 * The test button broke the day the school got a real number.
 *
 * `hello_world` is Meta's own sample and is REFUSED off their public test
 * numbers with code 131058 — so "Send test" worked all through setup and
 * failed exactly when somebody used it in anger.
 */
describe('the test send has a template that works on a real number', () => {
  it('fills an APPROVED template of the school’s own', () => {
    const t = testNoticeTemplate('Raffles Primary School');
    expect(t.name).toBe(TEMPLATE_NAMES.ABSENCE_NOTICE);
    expect(t.language).not.toBe('en_US');
  });

  it('matches the placeholder count Meta approved', () => {
    // A mismatch is code 132000, which would swap one broken test for another.
    const t = testNoticeTemplate('Raffles Primary School');
    expect(t.params).toHaveLength(placeholderCount(SUBMISSIONS.ABSENCE_NOTICE.body));
  });

  it('reads as a test, so nobody thinks a child is absent', () => {
    const t = testNoticeTemplate('Raffles Primary School');
    const sentence = SUBMISSIONS.ABSENCE_NOTICE.body.replace(/\{\{(\d)\}\}/g, (_m, i) => t.params[Number(i) - 1]);
    expect(sentence).toMatch(/This is a WhatsApp test/);
    expect(sentence).toMatch(/Please ignore/);
  });

  it('names the school, so the receiver knows who sent it', () => {
    expect(testNoticeTemplate('Raffles Primary School').params[0]).toBe('Raffles Primary School');
  });
});


/**
 * THE ANNOUNCEMENT TEMPLATE CARRIES A POINTER, NOT THE NOTICE.
 *
 * Meta moved `sckools_announcement` from UTILITY to MARKETING on 2026-10-01,
 * at 7.5× the price, and a school's general notices are exactly what goes to
 * everybody. The cause was not "it has a free-text variable" — `diary_remark`
 * quotes a teacher's own words and is still UTILITY. It was that the FIXED
 * words described any message at all and `{{4}}` WAS the message, so Meta
 * could not tell what the template was for.
 *
 * `sckools_notice_posted` names a concrete event instead — a notice, with a
 * title, posted on a day, for a class — and sends no body. Submitted the same
 * day and accepted as UTILITY, which is the experiment that proved the
 * diagnosis. The words themselves stay in the app, which also keeps a
 * school's notice off a lock screen.
 */
describe('the announcement template', () => {
  it('sends the title and the day, and never the body', async () => {
    const { templateFor, TEMPLATE_NAMES } = await import('./templates');
    const t = templateFor(MESSAGES.ANNOUNCEMENT, { child: null });
    expect(t.name).toBe(TEMPLATE_NAMES.ANNOUNCEMENT);
    expect(t.name).toContain('notice_posted');
    expect(t.params).toEqual(['Raffles', 'PTM', '2 November', 'the whole school']);
    // The one assertion that matters for the bill AND for privacy.
    expect(t.params.join(' ')).not.toContain('10 am');
  });

  it('names the child’s class when the notice is for one class', async () => {
    const { templateFor } = await import('./templates');
    const t = templateFor(
      { kind: 'ANNOUNCEMENT', payload: { ...MESSAGES.ANNOUNCEMENT.payload, className: '9-A' } },
      { child: { name: 'Ravi', className: '9-A' } },
    );
    expect(t.params[3]).toContain('9-A');
  });
});

describe('templateSubmissions — exactly what the submit script hands Meta', () => {
  it('one entry per template name, each with as many samples as placeholders', () => {
    const all = templateSubmissions();
    expect(new Set(all.map((t) => t.name)).size).toBe(all.length);
    for (const t of all) expect(t.samples).toHaveLength(placeholderCount(t.body));
  });

  it('carries the two Tier 1 templates, so they reach review before the code needs them', () => {
    const byName = new Map(templateSubmissions().map((t) => [t.name, t]));
    expect(byName.get('sckools_cover_assigned_v2')?.buttons).toEqual(['Got it', "Can't"]);
    expect(byName.get('sckools_cover_cancelled')?.category).toBe('UTILITY');
    // The narrow notice templates were invisible to the old regex parser.
    expect(byName.has('sckools_holiday_notice')).toBe(true);
  });

  it('no Utility body starts or ends with a placeholder — Meta refuses both', () => {
    for (const t of templateSubmissions().filter((x) => x.category === 'UTILITY')) {
      expect(t.body).not.toMatch(/^\{\{\d+\}\}/);
      expect(t.body).not.toMatch(/\{\{\d+\}\}[.!?"]?$/);
    }
  });

  it('v2 of the cover card takes the same parameters as v1, so v1 is a true fallback', () => {
    const byName = new Map(templateSubmissions().map((t) => [t.name, t]));
    expect(placeholderCount(byName.get(COVER_ASSIGNED_V2)!.body)).toBe(placeholderCount(SUBMISSIONS.COVER_ASSIGNED.body));
  });

  it('the same name with different buttons or samples is an error, not a silent first-wins', () => {
    const saved = EXTRA_SUBMISSIONS[COVER_ASSIGNED_V2];
    try {
      EXTRA_SUBMISSIONS[TEMPLATE_NAMES.COVER_ASSIGNED] = { ...SUBMISSIONS.COVER_ASSIGNED, category: 'UTILITY', buttons: ['Different'] };
      expect(() => templateSubmissions()).toThrow(/Two different definitions/);
    } finally {
      delete EXTRA_SUBMISSIONS[TEMPLATE_NAMES.COVER_ASSIGNED];
      expect(EXTRA_SUBMISSIONS[COVER_ASSIGNED_V2]).toBe(saved);
    }
  });
});
