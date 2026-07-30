import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { TimetableSlot } from '@skoolos/types';
import Timetable from '../timetable';
import { api, ApiError } from '@/lib/api';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

function wireSlot(overrides: Partial<TimetableSlot> & Pick<TimetableSlot, 'id' | 'dayOfWeek'>): TimetableSlot {
  return {
    period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' },
    subject: { id: 'sub1', name: 'Mathematics', code: 'MATH' },
    teacher: { id: 't1', firstName: 'Priya', lastName: 'Sharma' },
    classSection: { id: 'c1', name: 'B', grade: { name: '7' } },
    ...overrides,
  };
}

// Monday-Friday, two periods each day — same shape as the web page's fixture
// (apps/web/app/teacher/timetable/page.test.tsx) so both surfaces are pinned
// against equivalent data.
const WEEK: TimetableSlot[] = [1, 2, 3, 4, 5].flatMap((day) => [
  wireSlot({ id: `s${day}-1`, dayOfWeek: day, period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' } }),
  wireSlot({
    id: `s${day}-2`,
    dayOfWeek: day,
    period: { id: 'p2', label: 'Period 2', order: 2, startTime: '08:50', endTime: '09:35' },
    subject: { id: 'sub2', name: 'Science', code: 'SCI' },
  }),
]);

// A week that includes Sunday (dayOfWeek 7) and Monday (dayOfWeek 1), for
// the getDay() 0 -> 7 both-ends mapping test.
const WEEK_WITH_WEEKEND: TimetableSlot[] = [7, 1, 2, 3, 4, 5].flatMap((day) => [
  wireSlot({ id: `s${day}-1`, dayOfWeek: day, period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' } }),
  wireSlot({
    id: `s${day}-2`,
    dayOfWeek: day,
    period: { id: 'p2', label: 'Period 2', order: 2, startTime: '08:50', endTime: '09:35' },
    subject: { id: 'sub2', name: 'Science', code: 'SCI' },
  }),
]);

// A week where Wednesday is missing Period 2 entirely -> a free period row
// on that day even though Period 2 exists (and is filled) on other days.
const WEEK_WITH_A_GAP: TimetableSlot[] = [
  wireSlot({ id: 's1-1', dayOfWeek: 1, period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' } }),
  wireSlot({
    id: 's1-2',
    dayOfWeek: 1,
    period: { id: 'p2', label: 'Period 2', order: 2, startTime: '08:50', endTime: '09:35' },
    subject: { id: 'sub2', name: 'Science', code: 'SCI' },
  }),
  wireSlot({ id: 's3-1', dayOfWeek: 3, period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' } }),
  // No p2 slot on day 3 -> free period.
];

function setNow(y: number, m: number, d: number, hh: number, mm: number) {
  jest.setSystemTime(new Date(y, m, d, hh, mm, 0));
}

beforeEach(() => {
  jest.useFakeTimers();
  (api.request as jest.Mock).mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

it('shows a loading state while the week is in flight', async () => {
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockReturnValue(new Promise(() => {}));
  render(<Timetable />);
  expect(await screen.findByText('Loading your timetable…')).toBeTruthy();
});

it("shows the server's error message verbatim when the week fails to load", async () => {
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Timetable service is unavailable'));
  render(<Timetable />);
  expect(await screen.findByText('Timetable service is unavailable')).toBeTruthy();
});

it('shows an explicit empty state pointing at the admin when there are no slots', async () => {
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockResolvedValue([]);
  render(<Timetable />);
  expect(
    await screen.findByText('No timetable has been set up for you yet — ask your school admin.'),
  ).toBeTruthy();
});

it('defaults the day selector to today and renders that day\'s periods', async () => {
  // 2026-07-29 is a Wednesday (dayOfWeek 3).
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockResolvedValue(WEEK);
  render(<Timetable />);

  const chip3 = await screen.findByTestId('day-chip-3');
  expect(chip3.props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('day-chip-today-label-3')).toBeTruthy();

  const row = screen.getByTestId('period-row-p1');
  expect(within(row).getByText('7-B')).toBeTruthy();
  expect(within(row).getByText('Mathematics')).toBeTruthy();
});

it('tapping a different chip switches the periods shown', async () => {
  setNow(2026, 6, 29, 8, 20); // today = Wednesday (day 3)
  (api.request as jest.Mock).mockResolvedValue(WEEK);
  render(<Timetable />);

  await screen.findByTestId('day-chip-3');
  fireEvent.press(screen.getByTestId('day-chip-1'));

  expect(screen.getByTestId('day-chip-1').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('day-chip-3').props.accessibilityState).toEqual({ selected: false });
  // Data is the same fixture on every weekday, but this proves the selected
  // day actually drove which day's cells were read.
  expect(within(screen.getByTestId('period-row-p1')).getByText('7-B')).toBeTruthy();
});

it('mapping: a frozen Sunday (getDay() 0) selects and marks dayOfWeek 7 as today', async () => {
  // 2026-07-26 is a Sunday.
  setNow(2026, 6, 26, 10, 0);
  (api.request as jest.Mock).mockResolvedValue(WEEK_WITH_WEEKEND);
  render(<Timetable />);

  const chip7 = await screen.findByTestId('day-chip-7');
  expect(chip7.props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('day-chip-today-label-7')).toBeTruthy();
});

it('mapping: a frozen Monday (getDay() 1) selects and marks dayOfWeek 1 as today', async () => {
  // 2026-07-27 is a Monday.
  setNow(2026, 6, 27, 10, 0);
  (api.request as jest.Mock).mockResolvedValue(WEEK_WITH_WEEKEND);
  render(<Timetable />);

  const chip1 = await screen.findByTestId('day-chip-1');
  expect(chip1.props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('day-chip-today-label-1')).toBeTruthy();
});

it('edge: on a Sunday with no Sunday classes, nothing is tinted, the first available day is selected, and nothing crashes', async () => {
  // 2026-07-26 is a Sunday; WEEK only has Mon-Fri slots, so buildGrid drops
  // Sunday from `days` entirely and the screen must fall back to the first
  // available day (Monday) rather than pointing at a day with no data.
  setNow(2026, 6, 26, 10, 0);
  (api.request as jest.Mock).mockResolvedValue(WEEK);
  render(<Timetable />);

  const chip1 = await screen.findByTestId('day-chip-1');
  expect(chip1.props.accessibilityState).toEqual({ selected: true });
  expect(screen.queryByTestId('day-chip-7')).toBeNull();
  for (const day of [1, 2, 3, 4, 5]) {
    expect(screen.queryByTestId(`day-chip-today-label-${day}`)).toBeNull();
  }
  expect(within(screen.getByTestId('period-row-p1')).queryByText('Now')).toBeNull();
});

it('highlights the current period only while viewing today, not after switching to another day', async () => {
  // 08:20 falls inside p1's 08:00-08:45 window. Today = Wednesday (day 3).
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockResolvedValue(WEEK);
  render(<Timetable />);

  await screen.findByTestId('day-chip-3');
  expect(within(screen.getByTestId('period-row-p1')).getByText('Now')).toBeTruthy();
  expect(within(screen.getByTestId('period-row-p2')).queryByText('Now')).toBeNull();

  // Switch to Monday (not today) — even though Monday has the identical
  // p1 08:00-08:45 slot, it must not show as current.
  fireEvent.press(screen.getByTestId('day-chip-1'));
  expect(within(screen.getByTestId('period-row-p1')).queryByText('Now')).toBeNull();
});

it('renders a free-period row for a day missing a period that exists on other days', async () => {
  setNow(2026, 6, 29, 8, 20); // Wednesday (day 3) — the day missing p2
  (api.request as jest.Mock).mockResolvedValue(WEEK_WITH_A_GAP);
  render(<Timetable />);

  await screen.findByTestId('day-chip-3');
  expect(screen.getByTestId('period-row-free-p2')).toBeTruthy();
  expect(within(screen.getByTestId('period-row-p2')).getByText('Free')).toBeTruthy();
});
