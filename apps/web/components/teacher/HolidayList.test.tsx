import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { Holiday } from '@skoolos/types';
import { HolidayList } from './HolidayList';

function holiday(overrides: Partial<Holiday> = {}): Holiday {
  return {
    id: 'h-1',
    name: 'Founders Day',
    type: 'SCHOOL',
    startDate: '2026-08-15T00:00:00.000Z',
    endDate: null,
    ...overrides,
  };
}

describe('HolidayList', () => {
  it('renders the name, date and type pill for each holiday', () => {
    render(<HolidayList holidays={[holiday({ name: 'Founders Day', type: 'SCHOOL' })]} />);

    const row = screen.getByText('Founders Day').closest('.sk-row') as HTMLElement;
    expect(within(row).getByText('SCHOOL')).toBeInTheDocument();
    expect(within(row).getByText(/Aug 15, 2026/)).toBeInTheDocument();
  });

  it('a holiday with endDate: null shows a single date, not "to null"', () => {
    render(<HolidayList holidays={[holiday({ startDate: '2026-08-15T00:00:00.000Z', endDate: null })]} />);

    expect(screen.getByText(/Aug 15, 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/null/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/–/)).not.toBeInTheDocument();
  });

  it('a multi-day holiday shows the range', () => {
    render(
      <HolidayList
        holidays={[holiday({ startDate: '2026-08-15T00:00:00.000Z', endDate: '2026-08-17T00:00:00.000Z' })]}
      />,
    );

    expect(screen.getByText(/Aug 15, 2026 – Aug 17, 2026/)).toBeInTheDocument();
  });

  describe('UTC date handling under a negative-UTC-offset timezone', () => {
    // `saved === undefined` must `delete` rather than assign — assigning
    // `process.env.TZ = undefined` writes the literal string "undefined",
    // which Node reads as UTC and which would then leak into every later
    // suite sharing this Vitest worker.
    let saved: string | undefined;

    beforeEach(() => {
      saved = process.env.TZ;
      process.env.TZ = 'America/New_York';
    });

    afterEach(() => {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    });

    it('a UTC-midnight startDate renders the correct calendar day, not the previous local day', () => {
      // 2026-08-15T00:00:00.000Z is 2026-08-14 20:00 in America/New_York
      // (UTC-4). Reading it with the LOCAL Date methods would show the 14th;
      // `HolidayList` must show the 15th, matching the UTC calendar date the
      // API actually means.
      render(<HolidayList holidays={[holiday({ startDate: '2026-08-15T00:00:00.000Z' })]} />);

      const badge = document.querySelector('.badge') as HTMLElement;
      expect(badge).toHaveTextContent('15');
      expect(badge).not.toHaveTextContent('14');
      expect(screen.getByText(/Aug 15, 2026/)).toBeInTheDocument();
      expect(screen.queryByText(/Aug 14, 2026/)).not.toBeInTheDocument();
    });
  });

  it('an unexpected type value renders a neutral pill rather than crashing or rendering nothing', () => {
    expect(() =>
      render(<HolidayList holidays={[holiday({ type: 'BOGUS' as Holiday['type'] })]} />),
    ).not.toThrow();

    expect(screen.getByText('BOGUS')).toBeInTheDocument();
    expect(screen.getByText('BOGUS')).toHaveAttribute('data-tone', 'neutral');
  });

  it('an empty array renders an explicit empty state', () => {
    render(<HolidayList holidays={[]} />);
    expect(screen.getByText('No upcoming holidays.')).toBeInTheDocument();
  });
});
