import { render, screen, fireEvent, within, act } from '@testing-library/react-native';
import type { TeacherDay, TeacherDayEntry } from '@skoolos/types';
import Today from '../today';
import { api, ApiError } from '@/lib/api';
import { session } from '@/lib/session';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store[k] = v;
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      delete store[k];
    }),
  };
});

const mockPush = jest.fn();
// Captures each effect passed to useFocusEffect so a test can invoke one a
// second time to simulate a real re-focus event (react-navigation reruns the
// callback on every focus regardless of its identity). An ARRAY, not a single
// ref, because the NotificationBell in the header registers a SECOND focus
// effect as a child; index 0 is Today's own, which the refetch test re-runs.
// Named `mock…` so the jest.mock factory is allowed to reference it.
const mockFocusEffects: Array<() => (() => void) | void> = [];
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (effect: () => (() => void) | void) => {
    mockFocusEffects.push(effect);
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

function classEntry(overrides: Partial<TeacherDayEntry> = {}): TeacherDayEntry {
  return {
    periodId: 'p-1',
    label: 'P1',
    startTime: '08:00',
    endTime: '08:45',
    kind: 'CLASS',
    slot: {
      classSectionId: 'sec-8a',
      className: '8-A',
      subjectId: 'subj-maths',
      subjectName: 'Mathematics',
      covering: false,
      coveringFor: null,
    },
    register: { taken: false, present: 0, total: 28, markedBy: null },
    ...overrides,
  };
}

const breakEntry: TeacherDayEntry = {
  periodId: 'p-break',
  label: 'Break',
  startTime: '08:45',
  endTime: '09:05',
  kind: 'BREAK',
  slot: null,
  register: null,
};

const p2 = classEntry({
  periodId: 'p-2',
  label: 'P2',
  startTime: '09:05',
  endTime: '09:50',
  slot: {
    classSectionId: 'sec-8b',
    className: '8-B',
    subjectId: 'subj-science',
    subjectName: 'Science',
    covering: false,
    coveringFor: null,
  },
  register: { taken: false, present: 0, total: 30, markedBy: null },
});

const DAY: TeacherDay = { date: '2026-07-30', dayOfWeek: 4, entries: [classEntry(), breakEntry, p2] };

/** Local (not UTC) 2026-07-30 at the given hour/minute — matches todayISO(). */
function setNow(hour: number, minute: number) {
  jest.setSystemTime(new Date(2026, 6, 30, hour, minute, 0));
}

function mockDay(day: TeacherDay | Error, notesGet?: unknown) {
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path.startsWith('/manage/timetable/my-day')) {
      return day instanceof Error ? Promise.reject(day) : Promise.resolve(day);
    }
    if (path.startsWith('/manage/class-notes?')) {
      return Promise.resolve(notesGet ?? { notes: [], todos: [] });
    }
    if (path === '/me/notifications/unread-count') {
      // The header NotificationBell fetches this on focus; keep it quiet.
      return Promise.resolve({ count: 0 });
    }
    throw new Error(`unexpected call: ${path} ${JSON.stringify(opts)}`);
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
  mockFocusEffects.length = 0;
  await session.set({
    accessToken: 'at',
    refreshToken: 'rt',
    role: 'TEACHER',
    schoolHost: 'raffles.sckools.com',
    displayName: 'Priya Sharma',
  });
});

afterEach(() => {
  jest.useRealTimers();
});

it('shows a loading state before the day arrives', async () => {
  setNow(8, 20);
  (api.request as jest.Mock).mockReturnValue(new Promise(() => {}));
  render(<Today />);

  expect(await screen.findByText('Loading your day…')).toBeTruthy();
});

it('shows the server error message verbatim when the fetch fails', async () => {
  setNow(8, 20);
  mockDay(new ApiError(500, 'Could not reach the school server.'));
  render(<Today />);

  expect(await screen.findByText('Could not reach the school server.')).toBeTruthy();
});

it('shows an explicit empty state when no timetable has been set up', async () => {
  setNow(8, 20);
  mockDay({ date: '2026-07-30', dayOfWeek: 4, entries: [] });
  render(<Today />);

  expect(await screen.findByText(/No timetable has been set up for you yet/)).toBeTruthy();
});

it('greets the teacher by name and shows the classes/taken/pending summary', async () => {
  setNow(8, 20);
  mockDay(DAY);
  render(<Today />);

  expect(await screen.findByText('Good day, Priya Sharma')).toBeTruthy();
  expect(await screen.findByText('2 classes today · 0 taken · 2 pending')).toBeTruthy();
});

it('during a current CLASS period, renders the hero with class/subject/progress and mounts the notes panel', async () => {
  setNow(8, 20); // 20 minutes into P1 (08:00-08:45)
  mockDay(DAY);
  render(<Today />);

  const hero = await screen.findByTestId('now-card');
  expect(within(hero).getByText('8-A · Mathematics')).toBeTruthy();
  expect(screen.getByTestId('now-progress').props.accessibilityValue.now).toBe(44); // 20/45

  // Notes are scoped to the CURRENT period's subject.
  expect(await screen.findByText('Notes · Mathematics')).toBeTruthy();
});

it('once the register is taken, the hero shows counts and no Take button', async () => {
  setNow(8, 20);
  mockDay({
    date: '2026-07-30',
    dayOfWeek: 4,
    entries: [
      classEntry({ register: { taken: true, present: 26, total: 28, markedBy: 'Mr. Rao' } }),
      breakEntry,
      p2,
    ],
  });
  render(<Today />);

  expect(await screen.findByText('✓ 26/28 present')).toBeTruthy();
  expect(screen.getByText('Marked by Mr. Rao')).toBeTruthy();
  expect(screen.queryByText('Take attendance')).toBeNull();
});

it('shows a covering chip when the current period is a substitution', async () => {
  setNow(8, 20);
  mockDay({
    date: '2026-07-30',
    dayOfWeek: 4,
    entries: [
      classEntry({
        slot: {
          classSectionId: 'sec-8a',
          className: '8-A',
          subjectId: 'subj-maths',
          subjectName: 'Mathematics',
          covering: true,
          coveringFor: 'Ravi Kumar',
        },
      }),
      breakEntry,
      p2,
    ],
  });
  render(<Today />);

  expect(await screen.findByText('Covering for Ravi Kumar')).toBeTruthy();
});

it('during a BREAK, names the next class instead of offering to take attendance', async () => {
  setNow(8, 50); // inside the 08:45-09:05 break
  mockDay(DAY);
  render(<Today />);

  const hero = await screen.findByTestId('now-card');
  expect(within(hero).getByText('Break')).toBeTruthy();
  expect(within(hero).getByText(/8-B · Science/)).toBeTruthy();
  expect(screen.queryByText('Take attendance')).toBeNull();
  // Nothing is "current" during a break, so the subject-scoped notes panel
  // has no subject to attach to and must not render.
  expect(screen.queryByText(/^Notes ·/)).toBeNull();
});

const freeEntry: TeacherDayEntry = {
  periodId: 'p-free',
  label: 'Period 4',
  startTime: '09:05',
  endTime: '09:50',
  kind: 'FREE',
  slot: null,
  register: null,
};

it('during a FREE period renders the green free-period hero and mounts no notes panel', async () => {
  setNow(9, 20); // inside the 09:05-09:50 free period
  mockDay({ date: '2026-07-30', dayOfWeek: 4, entries: [classEntry(), breakEntry, freeEntry] });
  render(<Today />);

  const hero = await screen.findByTestId('now-card');
  expect(within(hero).getByText('Period 4 · Free period')).toBeTruthy();
  expect(within(hero).getByText("You're free — 30 min")).toBeTruthy();
  // A free period has no class, so the subject-scoped notes panel must not mount.
  expect(screen.queryByText(/^Notes ·/)).toBeNull();
});

it('excludes FREE periods from the classes/taken/pending glance count', async () => {
  setNow(7, 0);
  // One real class + one free period. The glance must count the class only.
  mockDay({ date: '2026-07-30', dayOfWeek: 4, entries: [classEntry(), freeEntry] });
  render(<Today />);

  expect(await screen.findByText('1 class today · 0 taken · 1 pending')).toBeTruthy();
});

it('before school starts, says so and names the first class', async () => {
  setNow(7, 0);
  mockDay(DAY);
  render(<Today />);

  expect(await screen.findByText('Nothing on right now')).toBeTruthy();
  expect(screen.getByText(/8-A · Mathematics at 08:00/)).toBeTruthy();
});

it('after school ends, renders the day-complete wrap-up with a summary of the day', async () => {
  setNow(18, 0);
  mockDay({
    date: '2026-07-30',
    dayOfWeek: 4,
    entries: [
      classEntry({ register: { taken: true, present: 27, total: 28, markedBy: 'Mr. Rao' } }),
      breakEntry,
      classEntry({
        periodId: 'p-2',
        startTime: '09:05',
        endTime: '09:50',
        register: { taken: true, present: 25, total: 30, markedBy: 'Mr. Rao' },
      }),
    ],
  });
  render(<Today />);

  expect(await screen.findByText('Day complete')).toBeTruthy();
  // 2 CLASS entries taught, 27 + 25 = 52 students marked (the BREAK is excluded).
  expect(screen.getByText('2 classes taught')).toBeTruthy();
  const summary = within(screen.getByTestId('now-summary'));
  expect(summary.getByText('52')).toBeTruthy();
  expect(summary.getByText('students marked')).toBeTruthy();
});

it('in a gap between periods, says nothing is on and names the next class', async () => {
  setNow(8, 20);
  mockDay({
    date: '2026-07-30',
    dayOfWeek: 4,
    entries: [classEntry({ startTime: '08:00', endTime: '08:15' }), classEntry({ periodId: 'p-later', startTime: '10:00', endTime: '10:45' })],
  });
  render(<Today />);

  expect(await screen.findByText('Nothing on right now')).toBeTruthy();
  expect(screen.getByText(/at 10:00/)).toBeTruthy();
});

it('dims periods before the current one under "Earlier today" in the timeline', async () => {
  setNow(9, 20); // inside P2, so P1 and Break are earlier
  mockDay(DAY);
  render(<Today />);

  expect(await screen.findByText('Earlier today')).toBeTruthy();
  const earlierRow = screen.getByTestId(`timeline-row-${DAY.entries[0].periodId}`);
  expect(earlierRow.props.style).toEqual(expect.objectContaining({ opacity: 0.5 }));
});

it('tapping Take attendance in the hero navigates to the take screen with the class name', async () => {
  setNow(8, 20);
  mockDay(DAY);
  render(<Today />);

  fireEvent.press(await screen.findByTestId('now-take-sec-8a'));
  expect(mockPush).toHaveBeenCalledWith('/(staff)/take/sec-8a?name=8-A');
});

it('refetches on focus so a colleague marking the register elsewhere shows up without a manual reload', async () => {
  setNow(8, 20);
  mockDay({
    date: '2026-07-30',
    dayOfWeek: 4,
    entries: [classEntry({ register: { taken: false, present: 0, total: 28, markedBy: null } }), breakEntry, p2],
  });
  render(<Today />);
  expect(await screen.findByText('Take attendance →')).toBeTruthy();

  // A colleague takes the register elsewhere; the next focus should show it.
  mockDay({
    date: '2026-07-30',
    dayOfWeek: 4,
    entries: [classEntry({ register: { taken: true, present: 28, total: 28, markedBy: 'Colleague' } }), breakEntry, p2],
  });
  await act(async () => {
    mockFocusEffects[0]?.();
  });

  expect(await screen.findByText('✓ 28/28 present')).toBeTruthy();
});
