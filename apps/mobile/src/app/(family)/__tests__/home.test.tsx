import { render, fireEvent, act } from '@testing-library/react-native';
import Home from '../(tabs)/home/index';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';

const mockPush = jest.fn();
// Captures each screen's `useFocusEffect` callback so a test can re-invoke one
// directly to simulate a focus event (no NavigationContainer in the test env) —
// same technique as (staff)/__tests__/today.test.tsx. An ARRAY (not a single
// ref) because the NotificationBell in the header registers a second effect as a
// child; index 0 is Home's own, which the refetch test re-runs. Named `mock…` so
// the jest.mock factory is allowed to reference it.
const mockFocusEffects: Array<() => void> = [];
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useFocusEffect: (effect: () => void) => {
    mockFocusEffects.push(effect);
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});
// The persisted session `useSession` reads: a STUDENT at a school with every
// module on, so the Fees dome and the four new tools have a reason to render.
jest.mock('expo-secure-store', () => {
  const s = JSON.stringify({ accessToken: 'a', refreshToken: 'r', role: 'STUDENT', schoolHost: 'raffles.sckools.com', displayName: 'Aarav Sharma', features: ['FEES', 'LIBRARY', 'SPORTS', 'PRESS'] });
  return { getItemAsync: jest.fn(async (k: string) => (k === 'sckools.session' ? s : null)), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() };
});
import { clearCache } from '@/lib/query';

const PROFILE = {
  firstName: 'Aarav',
  lastName: 'Sharma',
  admissionNo: 'A123',
  rollNo: '12',
  className: 'Grade 5-B',
  photoUrl: null,
};

const EMPTY_ATTENDANCE = { month: '2026-07', percent: 0, present: 0, absent: 0, late: 0, days: [] };

/** A timetable slot for TODAY spanning the whole day, so the hero is reliably in
 *  its "in class now" state at any test run time (deterministic — no clock mock). */
function allDaySlot() {
  const isoDay = ((new Date().getDay() + 6) % 7) + 1; // 1=Mon … 7=Sun
  return {
    id: 'sl-all',
    dayOfWeek: isoDay,
    period: { id: 'p-all', label: 'Period 1', order: 1, startTime: '00:00', endTime: '23:59' },
    subject: { id: 'su1', name: 'Mathematics', code: 'MATH' },
    teacher: { id: 'te1', firstName: 'Priya', lastName: 'Sharma' },
    classSection: { id: 'cs1', name: 'B', grade: { name: '5' } },
  };
}

beforeEach(() => {
  clearCache();
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
  mockFocusEffects.length = 0;
});

/**
 * `overrides` lets a test replace just the SECTIONS it cares about, by the
 * path each section used to be fetched from. Home now asks for them in ONE
 * request (`/me/home`, second edition D1), so the per-section keys are
 * composed into that one answer here — every existing override keeps its
 * meaning. Anything else (badges, fees, the birthday wall) resolves to a
 * quiet default so tests stay focused.
 */
const SECTION_KEYS = ['/me/profile', '/me/announcements', '/me/attendance', '/me/exams', '/me/results', '/me/timetable', '/me/diary'] as const;

function mockEndpoints(overrides: Partial<Record<string, unknown>> = {}) {
  const sections: Record<string, unknown> = {
    '/me/profile': PROFILE,
    '/me/announcements': [],
    '/me/attendance': EMPTY_ATTENDANCE,
    '/me/exams': [],
    '/me/results': [],
    '/me/timetable': [],
    '/me/diary': { entries: [], unsignedCount: 0 },
  };
  const rest: Record<string, unknown> = {
    '/me/notifications/unread-count': { count: 0 },
    // The Messages dome's badge (pitch №4); quiet by default.
    '/me/messages/unread-count': { count: 0 },
  };
  for (const [k, v] of Object.entries(overrides)) {
    if ((SECTION_KEYS as readonly string[]).includes(k)) sections[k] = v;
    else rest[k] = v;
  }
  const home = {
    profile: sections['/me/profile'],
    announcements: sections['/me/announcements'],
    attendance: sections['/me/attendance'],
    exams: sections['/me/exams'],
    results: sections['/me/results'],
    timetable: sections['/me/timetable'],
    diary: sections['/me/diary'],
  };
  const defaults: Record<string, unknown> = { '/me/home': home, ...rest };
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path in defaults) {
      const v = defaults[path];
      return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    }
    // A school without the module, or a wall that is switched off — quiet.
    if (path === '/me/fees' || path.startsWith('/me/birthdays')) return Promise.reject(new ApiError(404, 'off'));
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('identity card — role-neutral copy', () => {
  it('renders the student\'s own name, class and roll number', async () => {
    mockEndpoints();
    const { findByText } = render(<Home />);

    expect(await findByText('Hi, Aarav')).toBeTruthy();
    expect(await findByText(/Grade 5-B/)).toBeTruthy();
    expect(await findByText(/Roll 12/)).toBeTruthy();
  });

  // Prove-by-deletion target: with a single shared STUDENT login, the app
  // cannot know whether a parent or the student is holding the phone, so
  // "Your child" is simply wrong. Reintroducing that string into home.tsx
  // must fail this test.
  it('never renders "Your child" — the app cannot know who is holding the phone', async () => {
    mockEndpoints();
    const { findByText, queryByText } = render(<Home />);

    await findByText('Hi, Aarav'); // let the screen settle first
    expect(queryByText('Your child')).toBeNull();
  });

  it("passes today's attendance status into the hero (its status chip)", async () => {
    mockEndpoints({
      '/me/attendance': {
        month: '2026-07',
        percent: 100,
        present: 1,
        absent: 0,
        late: 0,
        days: [{ date: todayISO(), status: 'PRESENT' }],
      },
      '/me/timetable': [allDaySlot()],
    });
    const { findByText } = render(<Home />);
    expect(await findByText('Present today')).toBeTruthy();
  });
});

describe('next test', () => {
  // Pitch №4: the pinned notice row became the Results dome's badge — the
  // fact stays tappable, the full detail (date, syllabus, marks) lives one
  // tap away on Results where it always did.
  it('a scheduled exam badges the Results dome', async () => {
    mockEndpoints({
      '/me/exams': [
        {
          id: 'ex1',
          title: 'Unit Test 2',
          subjectName: 'Mathematics',
          scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          maxMarks: 50,
          syllabus: 'Chapters 4-6',
        },
      ],
    });
    const { findByTestId } = render(<Home />);
    expect(await findByTestId('hometool-badge-Results')).toBeTruthy();
  });

  it('the badge is absent when there are no upcoming exams', async () => {
    mockEndpoints();
    const { findByText, queryByTestId } = render(<Home />);
    await findByText('Hi, Aarav');
    expect(queryByTestId('hometool-badge-Results')).toBeNull();
  });

  it('tapping the Results dome navigates to the Results screen', async () => {
    mockEndpoints({
      '/me/exams': [
        {
          id: 'ex1',
          title: 'Unit Test 2',
          subjectName: 'Mathematics',
          scheduledAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
          maxMarks: 50,
          syllabus: 'Chapters 4-6',
        },
      ],
    });
    const { findByTestId } = render(<Home />);

    fireEvent.press(await findByTestId('hometool-Results'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/results');
  });
});

describe('KPI row', () => {
  it("shows this month's attendance percent and the latest published result", async () => {
    mockEndpoints({
      '/me/attendance': { month: '2026-07', percent: 86, present: 25, absent: 3, late: 1, days: [] },
      '/me/results': [
        {
          examId: 'ex0',
          title: 'Unit Test 1',
          subjectName: 'Science',
          scheduledAt: '2026-07-01T00:00:00.000Z',
          marks: 42,
          maxMarks: 50,
          classAverage: 38,
        },
      ],
    });
    const { findByText } = render(<Home />);
    expect(await findByText('86%')).toBeTruthy();
    expect(await findByText('42/50')).toBeTruthy();
  });

  it('shows neutral fallbacks when nothing has been recorded yet', async () => {
    mockEndpoints();
    const { findByText } = render(<Home />);
    expect(await findByText('No records')).toBeTruthy();
    expect(await findByText('None yet')).toBeTruthy();
  });
});

describe('latest announcements', () => {
  it('shows up to the 3 most recent announcements', async () => {
    mockEndpoints({
      '/me/announcements': [
        { id: 'a1', title: 'First', body: 'x', classSectionId: null, createdAt: new Date().toISOString() },
        { id: 'a2', title: 'Second', body: 'x', classSectionId: null, createdAt: new Date().toISOString() },
        { id: 'a3', title: 'Third', body: 'x', classSectionId: null, createdAt: new Date().toISOString() },
        { id: 'a4', title: 'Fourth', body: 'x', classSectionId: null, createdAt: new Date().toISOString() },
      ],
    });
    const { findByText, queryByText } = render(<Home />);
    expect(await findByText('First')).toBeTruthy();
    expect(await findByText('Second')).toBeTruthy();
    expect(await findByText('Third')).toBeTruthy();
    expect(queryByText('Fourth')).toBeNull();
  });

  it('shows an empty state when there are no announcements', async () => {
    mockEndpoints();
    const { findByText } = render(<Home />);
    expect(await findByText('No announcements yet.')).toBeTruthy();
  });
});

describe('navigation', () => {
  it('KPI tiles deep-link to Attendance and Results', async () => {
    mockEndpoints();
    const { findByText } = render(<Home />);

    fireEvent.press(await findByText('This month'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/attendance');

    fireEvent.press(await findByText('Latest result'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/results');
  });

  it("the \"Today's classes\" rail links out to the full week", async () => {
    mockEndpoints({ '/me/timetable': [allDaySlot()] });
    const { findByText } = render(<Home />);

    fireEvent.press(await findByText('Full week'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/timetable');
  });

  // Pitch №3: the slip is gone — it unfolded over the status bar and showed
  // one row. The bell navigates to the full notifications screen, the same
  // route a tapped push notification lands on: one screen, reached one way.
  it('the notification bell navigates to the notifications screen', async () => {
    mockEndpoints({});
    const { findByTestId } = render(<Home />);

    fireEvent.press(await findByTestId('notification-bell'));

    expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/notifications');
  });
});

describe('fetch states', () => {
  it('shows a loading state before any endpoint resolves', () => {
    (api.request as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const { getByLabelText } = render(<Home />);
    expect(getByLabelText('Loading your details…')).toBeTruthy();
  });

  it('shows the API error message when a fetch fails', async () => {
    (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
    const { findByText } = render(<Home />);
    expect(await findByText('Could not reach the school server.')).toBeTruthy();
  });

  it('shows a generic message when a non-ApiError rejection occurs', async () => {
    (api.request as jest.Mock).mockRejectedValue(new Error('boom'));
    const { findByText } = render(<Home />);
    expect(await findByText('Something went wrong.')).toBeTruthy();
  });

  it('refetches on focus, so a notice posted while backgrounded shows up without reload', async () => {
    mockEndpoints();
    const { findByText, queryByText } = render(<Home />);
    await findByText('No announcements yet.');

    // A notice arrives while the family tab was backgrounded elsewhere.
    mockEndpoints({
      '/me/announcements': [
        { id: 'a1', title: 'Fresh notice', body: 'x', classSectionId: null, createdAt: new Date().toISOString() },
      ],
    });
    expect(mockFocusEffects[0]).toBeDefined();
    await act(async () => {
      mockFocusEffects[0]?.();
    });

    expect(await findByText('Fresh notice')).toBeTruthy();
    expect(queryByText('No announcements yet.')).toBeNull();
  });
});

describe('diary remarks', () => {
  // Pitch №4: the banner card became the Diary dome in "Needs you today" —
  // lit amber (the one lit thing on this screen) with the waiting count as
  // its badge.
  it('unsigned remarks light the Diary dome and badge it with the count', async () => {
    mockEndpoints({ '/me/diary': { entries: [], unsignedCount: 2 } });
    const { findByTestId, getByTestId } = render(<Home />);

    expect(await findByTestId('hometool-live-Diary')).toBeTruthy();
    expect(getByTestId('hometool-badge-Diary')).toBeTruthy();
  });

  it('the dome is quiet when nothing is waiting to be signed', async () => {
    mockEndpoints();
    const { queryByTestId, findByTestId } = render(<Home />);

    await findByTestId('screen-scroll');
    expect(queryByTestId('hometool-live-Diary')).toBeNull();
    expect(queryByTestId('hometool-badge-Diary')).toBeNull();
  });

  it('tapping the Diary dome opens the diary', async () => {
    mockEndpoints({ '/me/diary': { entries: [], unsignedCount: 1 } });
    const { findByTestId } = render(<Home />);

    fireEvent.press(await findByTestId('hometool-Diary'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/(tabs)/home/diary');
  });

  it('unread messages badge the Messages dome', async () => {
    mockEndpoints({ '/me/messages/unread-count': { count: 3 } });
    const { findByTestId } = render(<Home />);
    expect(await findByTestId('hometool-badge-Messages')).toBeTruthy();
  });
});

describe('second edition — the doors the web portal had first', () => {
  it('the Fees dome joins "Needs you today" and badges the count of LATE bills', async () => {
    mockEndpoints({
      '/me/fees': {
        student: { id: 's', name: 'Aarav Sharma', admissionNo: 'A123', className: 'Grade 5-B' },
        balanceMinor: 100, billedMinor: 100, paidMinor: 0, lateFeeRule: null, ledger: [], payments: [],
        invoices: [
          { id: 'i1', number: '1', termName: 'T1', dueDate: '2026-01-01', totalMinor: 100, paidMinor: 0, principalDueMinor: 100, lateFeeMinor: 0, dueMinor: 100, isPaid: false, isOverdue: true, lines: [] },
          { id: 'i2', number: '2', termName: 'T2', dueDate: '2099-01-01', totalMinor: 100, paidMinor: 0, principalDueMinor: 100, lateFeeMinor: 0, dueMinor: 100, isPaid: false, isOverdue: false, lines: [] },
        ],
      },
    });
    const { findByTestId } = render(<Home />);
    expect(await findByTestId('hometool-Fees')).toBeTruthy();
    const badge = await findByTestId('hometool-badge-Fees');
    expect(badge).toBeTruthy();
    expect(badge.props.children.props.children).toBe(1);
  });

  it('the four new tools sit in "Go to" for a school that has the modules', async () => {
    mockEndpoints();
    const { findByTestId } = render(<Home />);
    for (const label of ['Sports', 'Library', 'Report cards', 'Birthdays']) {
      expect(await findByTestId(`hometool-${label}`)).toBeTruthy();
    }
  });

  it("on the child's birthday the dateline becomes the banner", async () => {
    mockEndpoints({
      '/me/birthdays': {
        generatedFor: '2026-09-17', window: 'TODAY', maxAge: 3600, next: null, upcoming: [],
        today: [{ day: 17, month: 9, name: 'Aarav Sharma', classLabel: 'Grade 5-B', photoUrl: null, key: 'k1' }],
      },
    });
    const { findByTestId, findByText } = render(<Home />);
    expect(await findByTestId('birthday-banner')).toBeTruthy();
    expect(await findByText('Happy birthday, Aarav')).toBeTruthy();
  });

  it('a wall that names someone ELSE today leaves the dateline alone', async () => {
    mockEndpoints({
      '/me/birthdays': {
        generatedFor: '2026-09-17', window: 'TODAY', maxAge: 3600, next: null, upcoming: [],
        today: [{ day: 17, month: 9, name: 'Meera Nair', classLabel: 'Grade 5-B', photoUrl: null, key: 'k2' }],
      },
    });
    const { findByText, queryByTestId } = render(<Home />);
    await findByText('Hi, Aarav');
    expect(queryByTestId('birthday-banner')).toBeNull();
  });
});
