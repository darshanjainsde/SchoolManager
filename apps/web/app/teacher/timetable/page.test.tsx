import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherTimetablePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

interface WireSlot {
  id: string;
  dayOfWeek: number;
  period: { id: string; label: string; order: number; startTime?: string; endTime?: string };
  subject: { id: string; name: string; code: string };
  classSection: { id: string; name: string; grade: { name: string } };
}

function wireSlot(overrides: Partial<WireSlot> & Pick<WireSlot, 'id' | 'dayOfWeek'>): WireSlot {
  return {
    period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' },
    subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
    classSection: { id: 'c1', name: 'B', grade: { name: '7' } },
    ...overrides,
  };
}

// A Monday–Friday week, two periods each day, so the "correct period marked
// current" test has something to distinguish and the Sunday test has real
// days for buildGrid to have dropped.
const WEEK: WireSlot[] = [1, 2, 3, 4, 5].flatMap((day) => [
  wireSlot({ id: `s${day}-1`, dayOfWeek: day, period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' } }),
  wireSlot({
    id: `s${day}-2`,
    dayOfWeek: day,
    period: { id: 'p2', label: 'Period 2', order: 2, startTime: '08:50', endTime: '09:35' },
    subject: { id: 'sub2', name: 'Science', code: 'SCI' },
  }),
]);

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TeacherTimetablePage', () => {
  it('renders a loading state while the week is in flight', () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn(() => new Promise(() => {})) }) as never);
    renderWithProviders(<TeacherTimetablePage />);
    expect(screen.getByText('Loading your timetable…')).toBeInTheDocument();
  });

  it("renders the server's error message verbatim when the week fails to load", async () => {
    vi.mocked(useApi).mockReturnValue(
      mockApi({ get: vi.fn().mockRejectedValue(new Error('Timetable service is unavailable')) }) as never,
    );
    renderWithProviders(<TeacherTimetablePage />);
    expect(await screen.findByText('Timetable service is unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state pointing at the admin when there are no slots', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn().mockResolvedValue([]) }) as never);
    renderWithProviders(<TeacherTimetablePage />);
    expect(
      await screen.findByText('No timetable has been set up for you yet — ask your school admin.'),
    ).toBeInTheDocument();
  });

  it('renders the grid when slots are present', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn().mockResolvedValue(WEEK) }) as never);
    renderWithProviders(<TeacherTimetablePage />);
    expect(await screen.findByTestId('cell-1-p1')).toBeInTheDocument();
  });

  it('edge: freezes the clock and marks the correct period current, only in today\'s column', async () => {
    // 2026-07-29 is a Wednesday (dayOfWeek 3); 08:20 falls inside p1's
    // 08:00-08:45 window, not p2's.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 29, 8, 20));

    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn().mockResolvedValue(WEEK) }) as never);
    renderWithProviders(<TeacherTimetablePage />);

    const todayCurrent = await screen.findByTestId('cell-3-p1');
    expect(todayCurrent.querySelector('.sk-tt-cell')).toHaveAttribute('data-current', 'true');

    const todayOtherPeriod = screen.getByTestId('cell-3-p2');
    expect(todayOtherPeriod.querySelector('.sk-tt-cell')).toHaveAttribute('data-current', 'false');

    // Same period (p1), a different day: not current even though the time matches.
    const otherDaySamePeriod = screen.getByTestId('cell-1-p1');
    expect(otherDaySamePeriod.querySelector('.sk-tt-cell')).toHaveAttribute('data-current', 'false');

    expect(screen.getByTestId('day-header-3')).toHaveAttribute('data-today', 'true');
    expect(screen.getByTestId('day-header-1')).toHaveAttribute('data-today', 'false');
  });

  it('edge: freezes the clock on a Sunday and renders with nothing tinted, without crashing', async () => {
    // 2026-07-26 is a Sunday (dayOfWeek 7); this teacher's week only has
    // Mon-Fri slots, so buildGrid drops Sunday from `days` entirely and the
    // page must fall back to todayDayOfWeek: null rather than crash trying
    // to highlight a column that doesn't exist.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 6, 26, 10, 0));

    vi.mocked(useApi).mockReturnValue(mockApi({ get: vi.fn().mockResolvedValue(WEEK) }) as never);
    renderWithProviders(<TeacherTimetablePage />);

    await screen.findByTestId('cell-1-p1');

    expect(screen.queryByTestId('day-header-7')).not.toBeInTheDocument();
    for (const day of [1, 2, 3, 4, 5]) {
      expect(screen.getByTestId(`day-header-${day}`)).toHaveAttribute('data-today', 'false');
    }
    expect(screen.getByTestId('cell-1-p1').querySelector('.sk-tt-cell')).toHaveAttribute('data-current', 'false');
  });
});
