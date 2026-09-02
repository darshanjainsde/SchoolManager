import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { MorningBell } from '@skoolos/types';
import { BellCard } from './bell-card';

/**
 * Outcome-level: what the principal READS at 8am, not which calls produced
 * it. The card is pure render — the page owns the query.
 */

const quiet: MorningBell = {
  dateLabel: 'Tuesday, 2 September',
  staffAbsent: [],
  uncovered: [],
  upcomingUncovered: 0,
  students: { absent: 0, marked: 0, worst: null },
  fees: null,
  today: { holiday: null, events: [] },
  waiting: { leave: 0, registerChanges: 0, enquiries: 0 },
};

const busy: MorningBell = {
  dateLabel: 'Tuesday, 2 September',
  staffAbsent: [
    { name: 'Sunita Joshi', kind: 'TEACHER', status: 'ABSENT' },
    { name: 'Ram Meghwal', kind: 'STAFF', status: 'ON_LEAVE' },
  ],
  uncovered: [{ className: 'VII — B', periodLabel: 'P1', teacherName: 'Sunita Joshi' }],
  upcomingUncovered: 3,
  students: { absent: 34, marked: 730, worst: { className: 'VI-A', absent: 6 } },
  fees: { yesterdayMinor: 4233000, monthMinor: 31000000, awaitingReview: 3 },
  today: { holiday: null, events: [{ title: 'Vigyan Pradarshani', time: '2:00 pm' }] },
  waiting: { leave: 2, registerChanges: 1, enquiries: 4 },
};

describe('BellCard', () => {
  it('a quiet morning is one calm line, not six zeros', () => {
    render(<BellCard bell={quiet} />);
    expect(screen.getByText(/All quiet/)).toBeInTheDocument();
    expect(screen.queryByText(/absent/)).not.toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
  });

  it('a busy morning names people and numbers, and every row is a link to its fix', () => {
    render(<BellCard bell={busy} />);

    // Staff line names the humans; a staff member is marked as such.
    expect(screen.getByText(/Sunita Joshi and Ram Meghwal \(staff\)/)).toBeInTheDocument();
    // Uncovered periods ring hardest and go to Leave.
    const uncovered = screen.getByText(/1 class period has no teacher/).closest('a')!;
    expect(uncovered).toHaveAttribute('href', '/app/leave');
    // Students line carries the worst class.
    expect(screen.getByText(/34 students absent/).closest('a')!.textContent).toContain('VI-A worst (6)');
    // Fees line reads in rupees and routes to the verify desk while anything waits.
    const fees = screen.getByText(/collected yesterday/).closest('a')!;
    expect(fees.textContent).toContain('₹42,330');
    expect(fees).toHaveAttribute('href', '/app/fees/verify');
    // The 30-day early warning survives the old alert's replacement.
    expect(screen.getByText(/3 periods in the next 30 days/)).toBeInTheDocument();
    // Queues.
    expect(screen.getByText(/2 leave requests/).closest('a')).toHaveAttribute('href', '/app/leave');
    expect(screen.getByText(/1 register change/).closest('a')).toHaveAttribute('href', '/app/requests');
    expect(screen.getByText(/4 new enquiries/).closest('a')).toHaveAttribute('href', '/app/enquiries');
    // And no quiet line.
    expect(screen.queryByText(/All quiet/)).not.toBeInTheDocument();
  });

  it('a school without FEES sees no money row at all', () => {
    render(<BellCard bell={{ ...busy, fees: null }} />);
    expect(screen.queryByText(/collected yesterday/)).not.toBeInTheDocument();
  });

  it('a holiday leads the card', () => {
    render(<BellCard bell={{ ...quiet, today: { holiday: 'Teachers’ Day', events: [] } }} />);
    expect(screen.getByText(/Teachers’ Day/)).toBeInTheDocument();
  });
});
