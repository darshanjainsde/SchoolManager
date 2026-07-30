import { render, fireEvent, act } from '@testing-library/react-native';
import Home from '../home';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';

const mockPush = jest.fn();
// Captures the screen's own `useFocusEffect` callback so a test can re-invoke
// it directly to simulate a real focus event (no NavigationContainer exists
// in the test env) — same technique as (staff)/__tests__/today.test.tsx.
let capturedFocusEffect: (() => void) | undefined;
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
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

const PROFILE = {
  firstName: 'Aarav',
  lastName: 'Sharma',
  admissionNo: 'A123',
  rollNo: '12',
  className: 'Grade 5-B',
  photoUrl: null,
};

const EMPTY_ATTENDANCE = { month: '2026-07', percent: 0, present: 0, absent: 0, late: 0, days: [] };

beforeEach(() => {
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
});

/**
 * `overrides` lets a test replace just the endpoints it cares about; every
 * other endpoint resolves to an empty/neutral default so tests stay focused.
 */
function mockEndpoints(overrides: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = {
    '/me/profile': PROFILE,
    '/me/announcements': [],
    '/me/attendance': EMPTY_ATTENDANCE,
    '/me/exams': [],
    '/me/results': [],
    ...overrides,
  };
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path in defaults) return Promise.resolve(defaults[path]);
    throw new Error(`unexpected path: ${path}`);
  });
}

describe('identity card — role-neutral copy', () => {
  it('renders the student\'s own name, class and roll number', async () => {
    mockEndpoints();
    const { findByText } = render(<Home />);

    expect(await findByText('Aarav Sharma')).toBeTruthy();
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

    await findByText('Aarav Sharma'); // let the screen settle first
    expect(queryByText('Your child')).toBeNull();
  });

  it("shows today's attendance status chip", async () => {
    mockEndpoints({
      '/me/attendance': {
        month: '2026-07',
        percent: 100,
        present: 1,
        absent: 0,
        late: 0,
        days: [{ date: todayISO(), status: 'PRESENT' }],
      },
    });
    const { findByText } = render(<Home />);
    expect(await findByText('✓ Present today')).toBeTruthy();
  });
});

describe('next-test banner', () => {
  it('renders the next exam when one is scheduled', async () => {
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
    const { findByText } = render(<Home />);
    expect(await findByText(/Mathematics/)).toBeTruthy();
    expect(await findByText(/Unit Test 2/)).toBeTruthy();
  });

  it('is absent when there are no upcoming exams', async () => {
    mockEndpoints();
    const { findByText, queryByText } = render(<Home />);
    await findByText('Aarav Sharma');
    expect(queryByText(/out of/)).toBeNull();
  });

  // S6/S7: tapping the banner opens the full next-test detail (syllabus,
  // max marks, date) on the Results screen.
  it('tapping the banner navigates to the Results screen', async () => {
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

    fireEvent.press(await findByTestId('next-exam-banner'));
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

describe('quick actions', () => {
  it('navigates via the quick-action row (Attendance/Notices/Timetable)', async () => {
    mockEndpoints();

    const { findByText } = render(<Home />);

    fireEvent.press(await findByText('Attendance'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/attendance');

    fireEvent.press(await findByText('Notices'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/notices');

    fireEvent.press(await findByText('Timetable'));
    expect(mockPush).toHaveBeenCalledWith('/(family)/timetable');
  });

  // Prove-by-deletion target (S5): a real build shipping "Coming soon" here
  // was the whole complaint. Re-adding the Alert path must fail this test.
  it('tapping Timetable never shows a "Coming soon" alert', async () => {
    mockEndpoints();
    const { Alert } = jest.requireActual('react-native');
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    const { findByText } = render(<Home />);
    fireEvent.press(await findByText('Timetable'));

    expect(mockPush).toHaveBeenCalledWith('/(family)/timetable');
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe('fetch states', () => {
  it('shows a loading state before any endpoint resolves', () => {
    (api.request as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const { getByText } = render(<Home />);
    expect(getByText('Loading…')).toBeTruthy();
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
    expect(capturedFocusEffect).toBeDefined();
    await act(async () => {
      capturedFocusEffect?.();
    });

    expect(await findByText('Fresh notice')).toBeTruthy();
    expect(queryByText('No announcements yet.')).toBeNull();
  });
});
