import {
  amountForMode,
  assertScopeShape,
  buildSlots,
  decideSession,
  defaultPrivacy,
  giftShortfall,
  isoWeekday,
  isRequestable,
  MAX_COUNTER_ROUNDS,
  nextGiftStatus,
  privacyOf,
  toGraduationRows,
  type SlotInputs,
} from './homecoming-rules';

describe('gift state machine', () => {
  it('walks the happy path proposal → report', () => {
    expect(nextGiftStatus('PROPOSED', 'ACCEPT')).toBe('ACCEPTED');
    expect(nextGiftStatus('ACCEPTED', 'RECEIVE')).toBe('RECEIVED');
    expect(nextGiftStatus('RECEIVED', 'DISTRIBUTE')).toBe('DISTRIBUTED');
    expect(nextGiftStatus('DISTRIBUTED', 'REPORT')).toBe('REPORTED');
  });

  it('lets a school counter, and the donor then accept or walk', () => {
    expect(nextGiftStatus('PROPOSED', 'COUNTER')).toBe('COUNTERED');
    expect(nextGiftStatus('COUNTERED', 'ACCEPT')).toBe('ACCEPTED');
    expect(nextGiftStatus('COUNTERED', 'DECLINE')).toBe('DECLINED');
  });

  it('cannot counter a countered pledge — that is the haggle, and it is capped', () => {
    expect(nextGiftStatus('COUNTERED', 'COUNTER')).toBeNull();
  });

  it('accepts a second consignment against an already-received pledge', () => {
    // A short delivery is topped up, and each consignment is its own dated row.
    expect(nextGiftStatus('RECEIVED', 'RECEIVE')).toBe('RECEIVED');
  });

  it('refuses every action from a terminal state', () => {
    for (const action of ['ACCEPT', 'DECLINE', 'RECEIVE', 'DISTRIBUTE', 'REPORT', 'CANCEL'] as const) {
      expect(nextGiftStatus('REPORTED', action)).toBeNull();
      expect(nextGiftStatus('DECLINED', action)).toBeNull();
      expect(nextGiftStatus('CANCELLED', action)).toBeNull();
    }
  });

  it('will not skip receiving — a pledge cannot go straight to distributed', () => {
    expect(nextGiftStatus('ACCEPTED', 'DISTRIBUTE')).toBeNull();
    expect(nextGiftStatus('PROPOSED', 'DISTRIBUTE')).toBeNull();
  });
});

describe('the everyone-or-nobody rule', () => {
  it('refuses to distribute a short pledge', () => {
    const v = giftShortfall(38, 36);
    expect(v.short).toBe(2);
    expect(v.canDistribute).toBe(false);
  });

  it('distributes once the gap is closed', () => {
    expect(giftShortfall(38, 38).canDistribute).toBe(true);
  });

  it('treats over-delivery as surplus, not as an error', () => {
    const v = giftShortfall(38, 41);
    expect(v.short).toBe(0);
    expect(v.surplus).toBe(3);
    expect(v.canDistribute).toBe(true);
  });

  it('never reports a negative shortfall', () => {
    expect(giftShortfall(10, 99).short).toBe(0);
  });

  it('refuses to distribute a zero-quantity pledge', () => {
    // Otherwise an empty pledge would sail through as "nothing owed, all done".
    expect(giftShortfall(0, 0).canDistribute).toBe(false);
  });
});

describe('in-kind gifts carry no valuation', () => {
  it('prices a FUND pledge', () => {
    expect(amountForMode('FUND', 38000, 38)).toBe(1444000);
  });

  it('stores null for a SUPPLY pledge, so donated goods never reach the fee ledger', () => {
    expect(amountForMode('SUPPLY', 38000, 38)).toBeNull();
  });
});

describe('a pledge addresses a group, never a child', () => {
  it('requires a section for SECTION scope', () => {
    expect(() => assertScopeShape('SECTION', null, null)).toThrow();
    expect(() => assertScopeShape('SECTION', null, 'sec-1')).not.toThrow();
  });

  it('requires a grade for GRADE scope', () => {
    expect(() => assertScopeShape('GRADE', null, null)).toThrow();
  });

  it('refuses a whole-school pledge that also names a class', () => {
    expect(() => assertScopeShape('SCHOOL', null, 'sec-1')).toThrow();
    expect(() => assertScopeShape('SCHOOL', null, null)).not.toThrow();
  });
});

describe('guest session — the accompanying teacher gate', () => {
  const withTeacher = { accompanyingTeacherId: 't-1', counterRound: 0 };
  const noTeacher = { accompanyingTeacherId: null, counterRound: 0 };

  it('blocks SCHEDULED when no staff member is named', () => {
    const d = decideSession('REQUESTED', 'ACCEPT', 'SCHOOL', noTeacher);
    expect(d.ok).toBe(false);
    expect(d.reason).toBe('NEEDS_ACCOMPANYING_TEACHER');
  });

  it('schedules once a staff member is named', () => {
    expect(decideSession('REQUESTED', 'ACCEPT', 'SCHOOL', withTeacher)).toEqual({ ok: true, next: 'SCHEDULED' });
  });

  it('blocks a counter with no teacher named, because the counter is the approval', () => {
    expect(decideSession('REQUESTED', 'COUNTER', 'SCHOOL', noTeacher).reason).toBe('NEEDS_ACCOMPANYING_TEACHER');
  });

  it('still blocks if the teacher is blanked after the counter', () => {
    // The school could not have reached COUNTERED without one; a later edit
    // must not be able to sneak a session past the gate.
    expect(decideSession('COUNTERED', 'ACCEPT', 'HOST', noTeacher).reason).toBe('NEEDS_ACCOMPANYING_TEACHER');
  });
});

describe('guest session — whoever moves last schedules it', () => {
  const ok = { accompanyingTeacherId: 't-1', counterRound: 0 };

  it('the host accepting a countered slot books it, with no third approval', () => {
    expect(decideSession('COUNTERED', 'ACCEPT', 'HOST', ok)).toEqual({ ok: true, next: 'SCHEDULED' });
  });

  it('the school cannot accept on the host’s behalf once it has countered', () => {
    expect(decideSession('COUNTERED', 'ACCEPT', 'SCHOOL', ok).reason).toBe('WRONG_ACTOR');
  });

  it('the host cannot accept their own request', () => {
    expect(decideSession('REQUESTED', 'ACCEPT', 'HOST', ok).reason).toBe('WRONG_ACTOR');
  });

  it('only the school suggests another time', () => {
    expect(decideSession('REQUESTED', 'COUNTER', 'HOST', ok).reason).toBe('WRONG_ACTOR');
  });

  it('caps the haggle at one counter', () => {
    const spent = { accompanyingTeacherId: 't-1', counterRound: MAX_COUNTER_ROUNDS };
    expect(decideSession('REQUESTED', 'COUNTER', 'SCHOOL', spent).reason).toBe('COUNTER_LIMIT_REACHED');
  });

  it('lets either side cancel a live session, and nobody cancel a dead one', () => {
    expect(decideSession('SCHEDULED', 'CANCEL', 'HOST', ok).next).toBe('CANCELLED');
    expect(decideSession('REQUESTED', 'CANCEL', 'SCHOOL', ok).next).toBe('CANCELLED');
    expect(decideSession('DECLINED', 'CANCEL', 'SCHOOL', ok).ok).toBe(false);
    expect(decideSession('DELIVERED', 'CANCEL', 'SCHOOL', ok).ok).toBe(false);
  });

  it('marks delivered only from scheduled, and only by the school', () => {
    expect(decideSession('SCHEDULED', 'DELIVER', 'SCHOOL', ok).next).toBe('DELIVERED');
    expect(decideSession('SCHEDULED', 'DELIVER', 'HOST', ok).reason).toBe('WRONG_ACTOR');
    expect(decideSession('REQUESTED', 'DELIVER', 'SCHOOL', ok).ok).toBe(false);
  });
});

describe('slot availability', () => {
  const periods = [
    { id: 'p1', order: 1, label: 'Period 1', startTime: '08:00', endTime: '08:40' },
    { id: 'p4', order: 4, label: 'Period 4', startTime: '10:20', endTime: '11:00' },
  ];
  const base = (over: Partial<SlotInputs> = {}): SlotInputs => ({
    dates: ['2026-11-11'], // a Wednesday
    periods,
    timetable: [
      { weekday: 3, periodId: 'p1', subjectId: 's-m', subjectName: 'Maths', teacherId: 't-a', teacherName: 'A. Rao' },
      { weekday: 3, periodId: 'p4', subjectId: 's-p', subjectName: 'Physics', teacherId: 't-v', teacherName: 'R. Verma' },
    ],
    holidays: new Set<string>(),
    examDates: new Set<string>(),
    taken: new Map(),
    ...over,
  });

  it('maps a date to the right ISO weekday regardless of local timezone', () => {
    expect(isoWeekday('2026-11-11')).toBe(3); // Wednesday
    expect(isoWeekday('2026-11-15')).toBe(7); // Sunday, not 0
  });

  it('offers a timetabled period as FREE', () => {
    const slots = buildSlots(base(), 'ALUMNUS');
    expect(slots.every((s) => s.state === 'FREE')).toBe(true);
    expect(slots.filter((s) => isRequestable(s.state))).toHaveLength(2);
  });

  it('closes an exam day and a holiday, and never offers them', () => {
    expect(buildSlots(base({ examDates: new Set(['2026-11-11']) }), 'ALUMNUS')[0].state).toBe('CLOSED');
    expect(buildSlots(base({ holidays: new Set(['2026-11-11']) }), 'ALUMNUS')[0].state).toBe('CLOSED');
    expect(isRequestable('CLOSED')).toBe(false);
  });

  it('marks a period another request already holds', () => {
    const taken = new Map<string, 'HELD' | 'BOOKED'>([['2026-11-11|p4', 'HELD']]);
    const slots = buildSlots(base({ taken }), 'ALUMNUS');
    expect(slots.find((s) => s.periodId === 'p4')!.state).toBe('HELD');
    expect(isRequestable('HELD')).toBe(false);
  });

  it('reports EMPTY where nothing is timetabled, and does not offer it', () => {
    const slots = buildSlots(base({ timetable: [] }), 'ALUMNUS');
    expect(slots.every((s) => s.state === 'EMPTY')).toBe(true);
    expect(isRequestable('EMPTY')).toBe(false);
  });

  it('NEVER puts a subject or a teacher on an alumnus’s slot', () => {
    // The one that matters. A full timetable tells an outsider where 300
    // children are at every minute of the week.
    for (const s of buildSlots(base(), 'ALUMNUS')) {
      expect(s.subjectName).toBeUndefined();
      expect(s.teacherName).toBeUndefined();
      expect(s.subjectId).toBeUndefined();
      expect(s.teacherId).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(s, 'subjectName')).toBe(false);
    }
  });

  it('gives the office the subject and the teacher on the same slot', () => {
    const s = buildSlots(base(), 'OFFICE').find((x) => x.periodId === 'p4')!;
    expect(s.subjectName).toBe('Physics');
    expect(s.teacherName).toBe('R. Verma');
    expect(s.teacherId).toBe('t-v');
  });

  it('leaves a closed office slot without a subject, since there is no lesson to name', () => {
    const s = buildSlots(base({ timetable: [] }), 'OFFICE')[0];
    expect(s.subjectName).toBeUndefined();
  });
});

describe('graduating a batch', () => {
  const students = [
    { id: 'st-1', admissionNo: '2013/0417', firstName: 'Aarav', lastName: 'Sharma', email: 'a@x.com',
      guardianPhone: '+919800000001', className: 'XII – A', photoAssetId: 'ph-1' },
  ];

  it('carries the record across without anybody typing it', () => {
    const [row] = toGraduationRows(students, 2026);
    expect(row).toMatchObject({
      studentId: 'st-1', admissionNo: '2013/0417', firstName: 'Aarav',
      batchYear: 2026, lastClass: 'XII – A', photoAssetId: 'ph-1',
    });
  });

  it('does NOT copy the guardian phone into the alumnus’s own phone field', () => {
    // Four years on, a school that copied it is WhatsApping four hundred
    // fathers in the belief it is reaching its alumni.
    const [row] = toGraduationRows(students, 2026);
    expect(row).not.toHaveProperty('phone');
    expect(row.guardianPhoneForInvite).toBe('+919800000001');
  });
});

describe('privacy defaults fail closed', () => {
  it('reads an absent field as HIDDEN, not as visible', () => {
    expect(privacyOf({}, 'phone')).toBe('HIDDEN');
    expect(privacyOf(null, 'city')).toBe('HIDDEN');
    expect(privacyOf('nonsense', 'city')).toBe('HIDDEN');
  });

  it('rejects a level it does not recognise rather than trusting it', () => {
    expect(privacyOf({ city: 'EVERYONE' }, 'city')).toBe('HIDDEN');
  });

  it('reads a level it does recognise', () => {
    expect(privacyOf({ city: 'PUBLIC' }, 'city')).toBe('PUBLIC');
  });

  it('starts a new alumnus with contact details closed', () => {
    const d = defaultPrivacy();
    expect(d.phone).toBe('HIDDEN');
    expect(d.city).toBe('HIDDEN');
    expect(d.name).toBe('ALUMNI');
  });
});
