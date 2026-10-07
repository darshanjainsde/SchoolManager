import { planSplice, type SlotVersion } from './timetable-splice';

/**
 * The timetable's dated versions, spliced over a window. Dates are IST
 * midnights; "today" is Wed 7 Oct 2026, the viewed week Mon 5 – Sun 11 Oct.
 */
const d = (s: string) => new Date(`${s}T00:00:00+05:30`);
const TODAY = d('2026-10-07');
const NEXT_MON = d('2026-10-12');
const KRISHNA = { subjectId: 'eng', teacherId: 'krishna' };
const RISHIKA = { subjectId: 'eng', teacherId: 'rishika' };
const v = (id: string, from: string, to: string | null, value = KRISHNA): SlotVersion => ({ id, effectiveFrom: d(from), effectiveTo: to ? d(to) : null, ...value });

describe('planSplice — from now on', () => {
  it('closes the version that lived before today and starts the new one today: the past is untouched', () => {
    expect(planSplice([v('a', '2026-06-01', null)], TODAY, null, RISHIKA)).toEqual([
      { kind: 'close', id: 'a', to: TODAY },
      { kind: 'create', role: 'value', from: TODAY, to: null, value: RISHIKA },
    ]);
  });

  it('fills an empty period from today', () => {
    expect(planSplice([], TODAY, null, RISHIKA)).toEqual([{ kind: 'create', role: 'value', from: TODAY, to: null, value: RISHIKA }]);
  });

  it('a version that itself started today is corrected in place — never two versions on one day', () => {
    expect(planSplice([v('a', '2026-10-07', null)], TODAY, null, RISHIKA)).toEqual([{ kind: 'reuse', id: 'a', value: RISHIKA, to: null }]);
  });

  it('nothing to do when the period already holds that value for the whole window', () => {
    expect(planSplice([v('a', '2026-06-01', null, RISHIKA)], TODAY, null, RISHIKA)).toEqual([]);
  });

  it('a change already planned for a later week is overridden: "from now on" means every coming week', () => {
    const ops = planSplice([v('a', '2026-06-01', '2026-11-02'), v('b', '2026-11-02', null, { subjectId: 'eng', teacherId: 'kiara' })], TODAY, null, RISHIKA);
    expect(ops).toEqual([
      { kind: 'close', id: 'a', to: TODAY },
      { kind: 'delete', id: 'b' },
      { kind: 'create', role: 'value', from: TODAY, to: null, value: RISHIKA },
    ]);
  });

  it('a version that ended before today is not touched at all', () => {
    expect(planSplice([v('old', '2026-04-01', '2026-06-01'), v('a', '2026-06-01', null)], TODAY, null, RISHIKA).map((o) => 'id' in o && o.id)).not.toContain('old');
  });
});

describe('planSplice — this week only', () => {
  it('gives the week to the new teacher and brings the old one back next Monday', () => {
    expect(planSplice([v('a', '2026-06-01', null)], TODAY, NEXT_MON, RISHIKA)).toEqual([
      { kind: 'close', id: 'a', to: TODAY },
      { kind: 'create', role: 'value', from: TODAY, to: NEXT_MON, value: RISHIKA },
      { kind: 'create', role: 'tail', from: NEXT_MON, to: null, value: KRISHNA },
    ]);
  });

  it('a version that ended inside the window is not restored past where it ended', () => {
    const ops = planSplice([v('a', '2026-06-01', '2026-10-09')], TODAY, NEXT_MON, RISHIKA);
    expect(ops).toEqual([
      { kind: 'close', id: 'a', to: TODAY },
      { kind: 'create', role: 'value', from: TODAY, to: NEXT_MON, value: RISHIKA },
    ]);
  });

  it('a change planned to start next week keeps its start: the window ends where it begins', () => {
    const ops = planSplice([v('a', '2026-06-01', '2026-10-12'), v('b', '2026-10-12', null, { subjectId: 'eng', teacherId: 'kiara' })], TODAY, NEXT_MON, RISHIKA);
    expect(ops).toEqual([
      { kind: 'close', id: 'a', to: TODAY },
      { kind: 'create', role: 'value', from: TODAY, to: NEXT_MON, value: RISHIKA },
    ]);
  });

  it('a later version that starts mid-week moves to the end of the window', () => {
    const ops = planSplice([v('a', '2026-06-01', '2026-10-09'), v('b', '2026-10-09', null, { subjectId: 'eng', teacherId: 'kiara' })], TODAY, NEXT_MON, RISHIKA);
    expect(ops).toEqual([
      { kind: 'close', id: 'a', to: TODAY },
      { kind: 'shift', id: 'b', from: NEXT_MON },
      { kind: 'create', role: 'value', from: TODAY, to: NEXT_MON, value: RISHIKA },
    ]);
  });

  it('a future week edited for that week only, with the period empty before and after', () => {
    const MON19 = d('2026-10-19');
    expect(planSplice([], NEXT_MON, MON19, RISHIKA)).toEqual([{ kind: 'create', role: 'value', from: NEXT_MON, to: MON19, value: RISHIKA }]);
  });
});

describe('planSplice — removing a period', () => {
  it('from now on: closes it today', () => {
    expect(planSplice([v('a', '2026-06-01', null)], TODAY, null, null)).toEqual([{ kind: 'close', id: 'a', to: TODAY }]);
  });

  it('this week only: closes it today and brings it back next Monday', () => {
    expect(planSplice([v('a', '2026-06-01', null)], TODAY, NEXT_MON, null)).toEqual([
      { kind: 'close', id: 'a', to: TODAY },
      { kind: 'create', role: 'tail', from: NEXT_MON, to: null, value: KRISHNA },
    ]);
  });

  it('a version started today is removed outright — there is no earlier part to keep', () => {
    expect(planSplice([v('a', '2026-10-07', null)], TODAY, null, null)).toEqual([{ kind: 'delete', id: 'a' }]);
  });

  it('an empty period stays empty: nothing to do', () => {
    expect(planSplice([], TODAY, null, null)).toEqual([]);
  });
});

describe('planSplice — the order of writes', () => {
  it('every edit comes before any create, so a freed date is free before it is claimed', () => {
    const ops = planSplice([v('a', '2026-06-01', '2026-10-09'), v('b', '2026-10-09', null)], TODAY, NEXT_MON, RISHIKA);
    const firstCreate = ops.findIndex((o) => o.kind === 'create');
    expect(ops.slice(firstCreate).every((o) => o.kind === 'create')).toBe(true);
  });
});
