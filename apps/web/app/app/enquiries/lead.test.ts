import { describe, it, expect } from 'vitest';
import {
  daysUntil, deskCounts, deskOrder, dialable, dueLabel, initials, isOpen,
  matchesFilter, matchesQuery, stageTone, STAGE_LABEL,
  type Lead,
} from './lead';

/** 3 Sept 2026, mid-morning in the school's timezone. */
const TODAY = new Date('2026-09-03T05:00:00.000Z');

function lead(over: Partial<Lead> = {}): Lead {
  return {
    id: 'l1', parentName: 'Sneha Kulkarni', phone: '+91 98123 00011', email: null,
    gradeInterest: 'Class III', message: null, status: 'CONTACTED', followUpAt: null,
    ownerUserId: null, ownerName: null, lostReason: null, noteCount: 0,
    createdAt: '2026-08-27T10:00:00.000Z',
    ...over,
  };
}

describe('how many days until a callback', () => {
  it('counts whole days in the school’s timezone, not the browser’s', () => {
    expect(daysUntil('2026-09-03', TODAY)).toBe(0);
    expect(daysUntil('2026-09-04', TODAY)).toBe(1);
    expect(daysUntil('2026-09-01', TODAY)).toBe(-2);
  });

  /**
   * The date arrives from the API as a full ISO timestamp; only the day part
   * means anything. Reading the whole string would make a callback flip between
   * "today" and "tomorrow" depending on the hour.
   */
  it('ignores the time on the wire', () => {
    expect(daysUntil('2026-09-03T18:30:00.000Z', TODAY)).toBe(0);
  });
});

describe('what the row says about the next step', () => {
  it('counts an overdue callback in days, and says so in red', () => {
    expect(dueLabel(lead({ followUpAt: '2026-09-01' }), TODAY)).toEqual({ text: '2 days overdue', tone: 'bad' });
    expect(dueLabel(lead({ followUpAt: '2026-09-02' }), TODAY)).toEqual({ text: '1 day overdue', tone: 'bad' });
  });

  it('names today and tomorrow rather than printing a date', () => {
    expect(dueLabel(lead({ followUpAt: '2026-09-03' }), TODAY)?.text).toBe('call today');
    expect(dueLabel(lead({ followUpAt: '2026-09-04' }), TODAY)?.text).toBe('call tomorrow');
  });

  /**
   * The state this page exists for. An open lead with nothing agreed is how a
   * family gets quietly forgotten, and an empty cell says nothing is wrong.
   */
  it('says out loud when no callback has been set', () => {
    expect(dueLabel(lead({ followUpAt: null }), TODAY)).toEqual({ text: 'no callback set', tone: 'muted' });
  });

  it('says nothing at all once a lead is finished', () => {
    expect(dueLabel(lead({ status: 'ENROLLED', followUpAt: '2026-08-01' }), TODAY)).toBeNull();
    expect(dueLabel(lead({ status: 'LOST' }), TODAY)).toBeNull();
  });
});

/**
 * CLOSED is the old three-state model's word for a finished lead. Existing rows
 * still carry it, and if the desk does not treat it as lost those families are
 * invisible: not open, and not under any filter either.
 */
describe('leads from before the pipeline existed', () => {
  it('reads CLOSED as lost', () => {
    expect(STAGE_LABEL.CLOSED).toBe('Lost');
    expect(stageTone('CLOSED')).toBe('bad');
    expect(isOpen(lead({ status: 'CLOSED' }))).toBe(false);
  });

  it('shows a CLOSED row under the Lost filter, so it is not lost from the page', () => {
    expect(matchesFilter(lead({ status: 'CLOSED' }), 'LOST', TODAY)).toBe(true);
    expect(matchesFilter(lead({ status: 'CLOSED' }), 'OPEN', TODAY)).toBe(false);
    expect(matchesFilter(lead({ status: 'CLOSED' }), 'ALL', TODAY)).toBe(true);
  });
});

describe('the desk’s order', () => {
  /**
   * Sorting by date received — the old behaviour — puts the forgotten leads at
   * the bottom, which is exactly where they stay. The desk leads with what is
   * late.
   */
  it('puts the latest callback first and the ones with none last', () => {
    const rows = [
      lead({ id: 'none', followUpAt: null }),
      lead({ id: 'future', followUpAt: '2026-09-20' }),
      lead({ id: 'late', followUpAt: '2026-08-25' }),
      lead({ id: 'today', followUpAt: '2026-09-03' }),
    ];
    expect(deskOrder(rows, TODAY).map((r) => r.id)).toEqual(['late', 'today', 'future', 'none']);
  });

  it('breaks a tie with the newest enquiry, not the oldest', () => {
    const rows = [
      lead({ id: 'older', followUpAt: null, createdAt: '2026-08-01T00:00:00.000Z' }),
      lead({ id: 'newer', followUpAt: null, createdAt: '2026-08-30T00:00:00.000Z' }),
    ];
    expect(deskOrder(rows, TODAY).map((r) => r.id)).toEqual(['newer', 'older']);
  });

  it('never drops or duplicates a row', () => {
    const rows = [lead({ id: 'a' }), lead({ id: 'b', followUpAt: '2026-09-01' }), lead({ id: 'c', status: 'ENROLLED' })];
    expect(deskOrder(rows, TODAY).map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('the summary tiles', () => {
  const rows = [
    lead({ id: '1', status: 'NEW', followUpAt: null }),
    lead({ id: '2', status: 'CONTACTED', followUpAt: '2026-08-30' }),
    lead({ id: '3', status: 'CONTACTED', followUpAt: '2026-09-03' }),
    lead({ id: '4', status: 'ENROLLED', followUpAt: '2026-08-01' }),
    lead({ id: '5', status: 'CLOSED', followUpAt: '2026-08-01' }),
  ];

  it('counts what needs doing today', () => {
    expect(deskCounts(rows, TODAY)).toEqual({ overdue: 1, today: 1, never: 1, nodue: 1, enrolled: 1 });
  });

  /** A finished lead cannot be overdue, or it sits in that count forever. */
  it('never counts a finished lead as overdue', () => {
    const done = [lead({ status: 'ENROLLED', followUpAt: '2026-01-01' }), lead({ status: 'CLOSED', followUpAt: '2026-01-01' })];
    expect(deskCounts(done, TODAY).overdue).toBe(0);
  });
});

describe('finding a family', () => {
  it('matches a name, case-insensitively', () => {
    expect(matchesQuery(lead(), 'sneha')).toBe(true);
    expect(matchesQuery(lead(), 'KULKARNI')).toBe(true);
    expect(matchesQuery(lead(), 'rohit')).toBe(false);
  });

  /** People type a number however they like; the stored one has spaces. */
  it('matches a phone number however either side is punctuated', () => {
    expect(matchesQuery(lead(), '9812300011')).toBe(true);
    expect(matchesQuery(lead(), '98123 00011')).toBe(true);
    expect(matchesQuery(lead(), '+91-98123-00011')).toBe(true);
  });

  it('an empty search matches everybody', () => {
    expect(matchesQuery(lead(), '   ')).toBe(true);
  });

  /**
   * A bare letter must not fall through to the phone branch and match every
   * lead — `''.replace(/\D/g,'')` is the empty string, and every string
   * contains it.
   */
  it('does not match everyone when the search has no digits', () => {
    expect(matchesQuery(lead({ parentName: 'Imran Shaikh' }), 'z')).toBe(false);
  });
});

describe('reaching them', () => {
  it('strips a display number down to something dialable', () => {
    expect(dialable('+91 98123 00011')).toBe('+919812300011');
    expect(dialable('(020) 2612-3400')).toBe('02026123400');
  });

  it('makes initials from a name', () => {
    expect(initials('Sneha Kulkarni')).toBe('SK');
    expect(initials('Manoj')).toBe('M');
    expect(initials('  Priya   Nair ')).toBe('PN');
  });
});
