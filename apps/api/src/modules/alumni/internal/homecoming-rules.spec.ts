import {
  giftJourney,
  giftJourneyIndex,
  giftStatusLabel,
  matchClaimToRoll,
  needsCollection,
  priceForPledge,
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

describe('gift state machine — the money track', () => {
  it('walks the happy path proposal → report', () => {
    expect(nextGiftStatus('PROPOSED', 'ACCEPT', 'FUND')).toBe('ACCEPTED');
    expect(nextGiftStatus('ACCEPTED', 'RECEIVE', 'FUND')).toBe('RECEIVED');
    expect(nextGiftStatus('RECEIVED', 'PURCHASE', 'FUND')).toBe('PURCHASED');
    expect(nextGiftStatus('PURCHASED', 'DISTRIBUTE', 'FUND')).toBe('DISTRIBUTED');
    expect(nextGiftStatus('DISTRIBUTED', 'REPORT', 'FUND')).toBe('REPORTED');
  });

  it('lets a school counter, and the donor then accept or walk', () => {
    expect(nextGiftStatus('PROPOSED', 'COUNTER', 'FUND')).toBe('COUNTERED');
    expect(nextGiftStatus('COUNTERED', 'ACCEPT', 'FUND')).toBe('ACCEPTED');
    expect(nextGiftStatus('COUNTERED', 'DECLINE', 'FUND')).toBe('DECLINED');
  });

  it('cannot counter a countered pledge — that is the haggle, and it is capped', () => {
    expect(nextGiftStatus('COUNTERED', 'COUNTER', 'FUND')).toBeNull();
  });

  it('accepts a second consignment against an already-received pledge', () => {
    // A short delivery is topped up, and each consignment is its own dated row.
    expect(nextGiftStatus('RECEIVED', 'RECEIVE', 'FUND')).toBe('RECEIVED');
  });

  it('will not hand out money that has not been spent yet', () => {
    // The money arriving is not the sweaters arriving. Skipping PURCHASED would
    // let a school report a distribution of something it had not bought.
    expect(nextGiftStatus('RECEIVED', 'DISTRIBUTE', 'FUND')).toBeNull();
  });

  it('refuses to cancel money the school has already spent', () => {
    // Refunding is a conversation, not a state transition, and pretending
    // otherwise leaves the books saying something untrue.
    expect(nextGiftStatus('PURCHASED', 'CANCEL', 'FUND')).toBeNull();
  });

  it('has no collection steps at all', () => {
    expect(nextGiftStatus('ACCEPTED', 'REQUEST_PICKUP', 'FUND')).toBeNull();
    expect(nextGiftStatus('PICKUP_REQUESTED', 'MARK_PICKED_UP', 'FUND')).toBeNull();
  });

  it('refuses every action from a terminal state', () => {
    for (const action of ['ACCEPT', 'DECLINE', 'RECEIVE', 'DISTRIBUTE', 'REPORT', 'CANCEL'] as const) {
      expect(nextGiftStatus('REPORTED', action, 'FUND')).toBeNull();
      expect(nextGiftStatus('DECLINED', action, 'FUND')).toBeNull();
      expect(nextGiftStatus('CANCELLED', action, 'FUND')).toBeNull();
    }
  });

  it('will not skip receiving — a pledge cannot go straight to distributed', () => {
    expect(nextGiftStatus('ACCEPTED', 'DISTRIBUTE', 'FUND')).toBeNull();
    expect(nextGiftStatus('PROPOSED', 'DISTRIBUTE', 'FUND')).toBeNull();
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
      guardianPhone: '+919800000001', className: 'XII – A', photoAssetId: 'ph-1',
      dob: new Date('2008-03-04'), guardianName: 'R. Sharma' },
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

/**
 * The drift guard for the four unions `homecoming-rules.ts` declares locally.
 *
 * That file cannot import the generated client — doing so broke the Vercel
 * build three times, because a cold checkout bundles before the client is
 * generated where apps/api resolves it. A spec is never bundled, so it can
 * import freely and hold the two in sync. Without this, adding a GiftStatus to
 * schema.prisma would leave the state machine silently unable to name it.
 */
describe('the local unions match the Prisma enums exactly', () => {
  // Required inside the describe: importing at module scope would put a
  // '@prisma/client' import in the same file as the rules under test, which is
  // the thing being avoided — and a require here runs only when jest does.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const prisma = require('@prisma/client') as Record<string, Record<string, string>>;

  const LOCAL = {
    GiftMode: ['FUND', 'SUPPLY'],
    GiftScope: ['SCHOOL', 'GRADE', 'SECTION'],
    GiftStatus: [
      'PROPOSED', 'ACCEPTED', 'DECLINED', 'COUNTERED', 'CANCELLED',
      'PICKUP_REQUESTED', 'PICKED_UP',
      'RECEIVED', 'PURCHASED', 'DISTRIBUTED', 'REPORTED',
    ],
    GiftAttachmentKind: ['BILL', 'CONSIGNMENT', 'DISTRIBUTION'],
    GuestSessionStatus: [
      'REQUESTED', 'COUNTERED', 'SCHEDULED', 'DECLINED', 'CANCELLED', 'DELIVERED',
    ],
  };

  it.each(Object.keys(LOCAL))('%s has the same members in both places', (name) => {
    const fromPrisma = Object.keys(prisma[name] ?? {}).sort();
    expect(fromPrisma.length).toBeGreaterThan(0);
    expect(fromPrisma).toEqual([...LOCAL[name as keyof typeof LOCAL]].sort());
  });

  it('the gift state machine names every GiftStatus Prisma knows, in BOTH tracks', () => {
    // A status missing from a transition table falls through to "refused"
    // forever, which looks like a rule rather than an omission. Now that there
    // are two tables, a value can be present in one and forgotten in the other
    // — which is worse, because it only breaks for half the donors.
    for (const status of Object.keys(prisma.GiftStatus)) {
      expect(nextGiftStatus(status as never, 'CANCEL', 'FUND')).not.toBeUndefined();
      expect(nextGiftStatus(status as never, 'CANCEL', 'SUPPLY')).not.toBeUndefined();
    }
  });

  it('gives every GiftStatus words a donor can read, in both modes', () => {
    for (const status of Object.keys(prisma.GiftStatus)) {
      for (const mode of ['FUND', 'SUPPLY'] as const) {
        const label = giftStatusLabel(status as never, mode);
        expect(label).toBeTruthy();
        // The raw enum name leaking to a donor is the failure this catches.
        expect(label).not.toBe(status);
      }
    }
  });
});

describe('matchClaimToRoll', () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  const cand = (over: Partial<Parameters<typeof matchClaimToRoll>[1][0]> = {}) => ({
    id: 'c1', firstName: 'Anita', lastName: 'Rao', batchYear: 2014,
    dob: d('2014-03-02'), admissionNo: 'A/101', guardianName: 'S Rao', status: 'VERIFIED',
    ...over,
  });
  const claim = (over: Partial<Parameters<typeof matchClaimToRoll>[0]> = {}) => ({
    firstName: 'Anita', lastName: 'Rao', batchYear: 2014, dob: d('2014-03-02'), ...over,
  });

  it('calls name + year + date of birth STRONG', () => {
    const [m] = matchClaimToRoll(claim(), [cand()]);
    expect(m.strength).toBe('STRONG');
    expect(m.candidateId).toBe('c1');
  });

  it('calls name + year alone WEAK — every sibling and namesake has that much', () => {
    const [m] = matchClaimToRoll(claim({ dob: null }), [cand()]);
    expect(m.strength).toBe('WEAK');
    expect(m.reasons).toContain('claimant gave no date of birth');
    expect(m.reasons).not.toContain('date of birth does NOT match');
  });

  it('shortlists on date of birth alone — a married name is what loses people', () => {
    const [m] = matchClaimToRoll(claim({ lastName: 'Menon' }), [cand()]);
    expect(m).toBeDefined();
    expect(m.strength).toBe('WEAK');
    expect(m.reasons).toContain('name differs — married name, or a spelling');
  });

  it('never crosses batch years, however well the name fits', () => {
    expect(matchClaimToRoll(claim(), [cand({ batchYear: 2013 })])).toEqual([]);
  });

  it('drops a candidate that shares neither name nor date of birth', () => {
    expect(matchClaimToRoll(claim(), [cand({ firstName: 'Vikram', lastName: 'Shah', dob: d('2014-09-09') })])).toEqual([]);
  });

  it('still shortlists a name match whose date of birth CONTRADICTS, and says so', () => {
    // Deliberate: the office decides. Hiding a near-miss is how a clerk merges
    // the wrong sibling, because the row simply never appeared.
    const [m] = matchClaimToRoll(claim(), [cand({ dob: d('2014-08-19') })]);
    expect(m.strength).toBe('WEAK');
    expect(m.reasons).toContain('date of birth does NOT match');
  });

  it('says plainly when the school holds no date of birth to check against', () => {
    const [m] = matchClaimToRoll(claim(), [cand({ dob: null })]);
    expect(m.reasons).toContain('no date of birth on file to check');
  });

  it('is case- and whitespace-insensitive on names', () => {
    const [m] = matchClaimToRoll(claim({ firstName: '  aNiTa ', lastName: 'RAO' }), [cand()]);
    expect(m.strength).toBe('STRONG');
  });

  it('puts strong suggestions above weak ones', () => {
    const rows = matchClaimToRoll(claim(), [
      cand({ id: 'weak', dob: null }),
      cand({ id: 'strong' }),
    ]);
    expect(rows[0].candidateId).toBe('strong');
  });

  it('caps the shortlist at five — a clerk reads a list, not a report', () => {
    const many = Array.from({ length: 12 }, (_, i) => cand({ id: `c${i}` }));
    expect(matchClaimToRoll(claim(), many)).toHaveLength(5);
  });

  it('returns nothing for an empty roll rather than throwing', () => {
    expect(matchClaimToRoll(claim(), [])).toEqual([]);
  });
});


describe('gift state machine — the goods track', () => {
  it('walks collection → transit → arrival → handover', () => {
    expect(nextGiftStatus('ACCEPTED', 'REQUEST_PICKUP', 'SUPPLY')).toBe('PICKUP_REQUESTED');
    expect(nextGiftStatus('PICKUP_REQUESTED', 'MARK_PICKED_UP', 'SUPPLY')).toBe('PICKED_UP');
    expect(nextGiftStatus('PICKED_UP', 'RECEIVE', 'SUPPLY')).toBe('RECEIVED');
    expect(nextGiftStatus('RECEIVED', 'DISTRIBUTE', 'SUPPLY')).toBe('DISTRIBUTED');
  });

  it('lets a donor who drives it over skip collection entirely', () => {
    // Not an oversight. Plenty of gifts arrive in the donor's own car, and
    // forcing a pickup that never happened makes the history a fiction.
    expect(nextGiftStatus('ACCEPTED', 'RECEIVE', 'SUPPLY')).toBe('RECEIVED');
  });

  it('lets a waiting consignment be collected in person after all', () => {
    expect(nextGiftStatus('PICKUP_REQUESTED', 'RECEIVE', 'SUPPLY')).toBe('RECEIVED');
  });

  it('never lets goods be "purchased" — the donor already bought them', () => {
    for (const from of ['ACCEPTED', 'PICKED_UP', 'RECEIVED'] as const) {
      expect(nextGiftStatus(from, 'PURCHASE', 'SUPPLY')).toBeNull();
    }
  });

  it('will not hand out goods that have not arrived', () => {
    expect(nextGiftStatus('PICKED_UP', 'DISTRIBUTE', 'SUPPLY')).toBeNull();
    expect(nextGiftStatus('PICKUP_REQUESTED', 'DISTRIBUTE', 'SUPPLY')).toBeNull();
  });

  it('can be called off at any point before it is handed out', () => {
    for (const from of ['ACCEPTED', 'PICKUP_REQUESTED', 'PICKED_UP', 'RECEIVED'] as const) {
      expect(nextGiftStatus(from, 'CANCEL', 'SUPPLY')).toBe('CANCELLED');
    }
    expect(nextGiftStatus('DISTRIBUTED', 'CANCEL', 'SUPPLY')).toBeNull();
  });
});

describe('what the donor typed', () => {
  it('takes a per-child price for a funded gift and multiplies it out', () => {
    const r = priceForPledge('FUND', 45000, 38);
    expect(r.ok).toBe(true);
    expect(r.unitPriceMinor).toBe(45000);
    expect(r.amountMinor).toBe(45000 * 38);
  });

  it('stores NO valuation for goods, whatever was typed', () => {
    // The rule that keeps donated goods out of the fee ledger.
    const r = priceForPledge('SUPPLY', 45000, 38);
    expect(r.ok).toBe(true);
    expect(r.unitPriceMinor).toBeNull();
    expect(r.amountMinor).toBeNull();
  });

  it('treats zero as "I am sending it myself", not as a mistake', () => {
    expect(priceForPledge('SUPPLY', 0, 38).ok).toBe(true);
  });

  it('refuses a funded gift with no price, and says what to do instead', () => {
    const r = priceForPledge('FUND', 0, 38);
    expect(r.ok).toBe(false);
    expect(r.problem).toMatch(/send the goods/i);
  });

  it('refuses a negative price', () => {
    expect(priceForPledge('FUND', -1, 38).ok).toBe(false);
  });

  it('refuses to price a gift for an empty group', () => {
    expect(priceForPledge('FUND', 45000, 0).ok).toBe(false);
  });
});

describe('the journey a donor is shown', () => {
  it('gives money and goods different journeys', () => {
    expect(giftJourney('FUND')).toContain('PURCHASED');
    expect(giftJourney('FUND')).not.toContain('PICKED_UP');
    expect(giftJourney('SUPPLY')).toContain('PICKED_UP');
    expect(giftJourney('SUPPLY')).not.toContain('PURCHASED');
  });

  it('advances the index along the journey', () => {
    expect(giftJourneyIndex('PROPOSED', 'FUND')).toBe(0);
    expect(giftJourneyIndex('DISTRIBUTED', 'FUND')).toBe(giftJourney('FUND').length - 1);
    expect(giftJourneyIndex('PICKED_UP', 'SUPPLY')).toBeGreaterThan(
      giftJourneyIndex('PICKUP_REQUESTED', 'SUPPLY'),
    );
  });

  it('marks a pledge that ended early as off the journey rather than at step 0', () => {
    // -1 and 0 render very differently: "nothing has happened yet" is a lie
    // about a gift the school declined.
    expect(giftJourneyIndex('DECLINED', 'FUND')).toBe(-1);
    expect(giftJourneyIndex('CANCELLED', 'SUPPLY')).toBe(-1);
  });

  it('puts a countered pledge back at the donor’s end, not partway along', () => {
    expect(giftJourneyIndex('COUNTERED', 'FUND')).toBe(0);
  });

  it('treats REPORTED as complete rather than as an unknown step', () => {
    expect(giftJourneyIndex('REPORTED', 'SUPPLY')).toBe(giftJourney('SUPPLY').length - 1);
  });

  it('says something different to a funder and a sender at the same status', () => {
    expect(giftStatusLabel('RECEIVED', 'FUND')).not.toBe(giftStatusLabel('RECEIVED', 'SUPPLY'));
  });
});

describe('whether to ask about collection at all', () => {
  it('never asks a funder for a pickup address', () => {
    // Asking a donor in Toronto where to collect their money is how a form
    // loses somebody.
    expect(needsCollection('FUND', 'ACCEPTED')).toBe(false);
  });

  it('asks while a consignment still needs collecting', () => {
    expect(needsCollection('SUPPLY', 'ACCEPTED')).toBe(true);
    expect(needsCollection('SUPPLY', 'PICKUP_REQUESTED')).toBe(true);
  });

  it('stops asking once it is on its way', () => {
    expect(needsCollection('SUPPLY', 'PICKED_UP')).toBe(false);
    expect(needsCollection('SUPPLY', 'RECEIVED')).toBe(false);
  });
});
