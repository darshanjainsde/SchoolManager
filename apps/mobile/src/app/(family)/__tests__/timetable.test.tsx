import { fireEvent, render, screen, within, act } from '@testing-library/react-native';
import type { TimetableSlot } from '@skoolos/types';
import Timetable from '../(tabs)/home/timetable';
import { api, ApiError } from '@/lib/api';

let capturedFocusEffect: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    capturedFocusEffect = effect;
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

// Same fixture shape as (staff)/__tests__/timetable.test.tsx — GET
// /me/timetable returns the identical TimetableSlot[] wire contract.
const WEEK: TimetableSlot[] = [1, 2, 3, 4, 5].flatMap((day) => [
  wireSlot({ id: `s${day}-1`, dayOfWeek: day, period: { id: 'p1', label: 'Period 1', order: 1, startTime: '08:00', endTime: '08:45' } }),
  wireSlot({
    id: `s${day}-2`,
    dayOfWeek: day,
    period: { id: 'p2', label: 'Period 2', order: 2, startTime: '08:50', endTime: '09:35' },
    subject: { id: 'sub2', name: 'Science', code: 'SCI' },
  }),
]);

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

it('fetches from /me/timetable (the student endpoint, not the teacher one)', async () => {
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockResolvedValue(WEEK);
  render(<Timetable />);
  await screen.findByTestId('day-chip-3');
  expect(api.request).toHaveBeenCalledWith('/me/timetable');
});

it("reuses the shared DaySelector/TimetableList: today (Wednesday) preselected and its periods render", async () => {
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

it('tapping a different day chip switches the periods shown', async () => {
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockResolvedValue(WEEK);
  render(<Timetable />);

  await screen.findByTestId('day-chip-3');
  fireEvent.press(screen.getByTestId('day-chip-1'));
  expect(screen.getByTestId('day-chip-1').props.accessibilityState).toEqual({ selected: true });
});

it('highlights the current period only while viewing today', async () => {
  setNow(2026, 6, 29, 8, 20); // 08:20 falls inside p1's 08:00-08:45 window
  (api.request as jest.Mock).mockResolvedValue(WEEK);
  render(<Timetable />);

  await screen.findByTestId('day-chip-3');
  expect(within(screen.getByTestId('period-row-p1')).getByText('Now')).toBeTruthy();

  fireEvent.press(screen.getByTestId('day-chip-1'));
  expect(within(screen.getByTestId('period-row-p1')).queryByText('Now')).toBeNull();
});

it('shows a loading state while the week is in flight', async () => {
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockReturnValue(new Promise(() => {}));
  render(<Timetable />);
  expect(await screen.findByLabelText('Loading your timetable…')).toBeTruthy();
});

it('shows an explicit empty state when there are no slots', async () => {
  setNow(2026, 6, 29, 8, 20);
  (api.request as jest.Mock).mockResolvedValue([]);
  render(<Timetable />);
  expect(
    await screen.findByText('No timetable has been set up for your class yet — check back later.'),
  ).toBeTruthy();
});

describe('fetch states', () => {
  it("shows the server's error message verbatim when the week fails to load", async () => {
    setNow(2026, 6, 29, 8, 20);
    (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Timetable service is unavailable'));
    render(<Timetable />);
    expect(await screen.findByText('Timetable service is unavailable')).toBeTruthy();
  });

  it('shows a generic message when a non-ApiError rejection occurs', async () => {
    setNow(2026, 6, 29, 8, 20);
    (api.request as jest.Mock).mockRejectedValue(new Error('boom'));
    render(<Timetable />);
    expect(await screen.findByText('Something went wrong.')).toBeTruthy();
  });

  it('refetches on focus', async () => {
    setNow(2026, 6, 29, 8, 20);
    (api.request as jest.Mock).mockResolvedValueOnce(WEEK);
    render(<Timetable />);
    await screen.findByTestId('day-chip-3');

    (api.request as jest.Mock).mockResolvedValueOnce([]);
    expect(capturedFocusEffect).toBeDefined();
    await act(async () => {
      capturedFocusEffect?.();
    });
    expect(
      await screen.findByText('No timetable has been set up for your class yet — check back later.'),
    ).toBeTruthy();
  });
});
