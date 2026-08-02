import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import TakeAttendance from '../[classSectionId]';
import { api, ApiError } from '@/lib/api';
import { pendingSaves } from '@/lib/offline-queue';

// The offline queue's default storage goes through expo-secure-store — an
// in-memory fake so enqueueSave/pendingSaves in the tests below actually
// round-trip within a single test, matching the convention already used by
// src/app/(staff)/__tests__/today.test.tsx for the same module.
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

// `submit`'s onPress is async but Pressable's onPress type is `() => void`,
// so fireEvent.press can't be awaited to know the resulting state updates
// (setBusy/setConfirmation/setError) have landed. A single macrotask tick
// drains the mocked fetch's promise chain in the common case; `settled`
// below also polls afterward as a safety net, since under heavy parallel
// test-worker contention React's own scheduler can defer the actual commit
// by more than one tick.
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** Flushes, then polls until `assertion` stops throwing — belt and suspenders
 * against scheduler timing under load, without a fixed real-time budget that
 * can itself flake on a busy machine. */
async function settled(assertion: () => void) {
  await flush();
  // 30s (well under the 45s testTimeout): these async save-flow assertions poll
  // for a state update that gets starved on a busy machine. `pnpm preflight`
  // runs this suite CONCURRENTLY with the api and web suites under turbo, which
  // oversubscribes the CPU far harder than `pnpm test` in this package alone —
  // 15s was enough for the latter and not the former, so the gate flaked while
  // the same file passed in isolation every time. Higher timeout only costs
  // time on a genuine failure, never on the happy path.
  await waitFor(assertion, { timeout: 30000 });
}

const mockBack = jest.fn();
// Mutable so individual tests can exercise a `date` route param without a
// fresh jest.mock per test — Jest's out-of-scope-variable check for mock
// factories allows referencing `mock`-prefixed identifiers like this one.
let mockParams: { classSectionId: string; name?: string; date?: string } = {
  classSectionId: 'cs1',
  name: '5-B',
};
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const MARKS = [
  { studentId: 's1', status: 'PRESENT' },
  { studentId: 's2', status: 'ABSENT' },
];
const STUDENTS = [
  { id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' },
  { id: 's2', firstName: 'Ben', lastName: 'Lee', rollNo: '2' },
];

beforeEach(() => {
  mockBack.mockReset();
  (api.request as jest.Mock).mockReset();
  mockParams = { classSectionId: 'cs1', name: '5-B' };
});

it('joins attendance marks with student roster names and defaults unmarked students to present', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByText } = render(<TakeAttendance />);

  expect(await findByText('Asha Rao')).toBeTruthy();
  expect(await findByText('Ben Lee')).toBeTruthy();
  expect(await findByText(/1 present · 1 absent · 2 total/)).toBeTruthy();
});

it('renders each roster row with its roll number', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByText } = render(<TakeAttendance />);

  expect(await findByText('Roll 1')).toBeTruthy();
  expect(await findByText('Roll 2')).toBeTruthy();
});

it('renders a dash for a student with no roll number yet, never the string "null"', async () => {
  // A student mid-admission may not have a rollNo assigned — GET
  // /manage/students explicitly documents this field as nullable.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([{ studentId: 's1', status: 'PRESENT' }]);
    }
    if (path.startsWith('/manage/students?')) {
      return Promise.resolve([{ id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: null }]);
    }
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByText, queryByText, getByText } = render(<TakeAttendance />);

  expect(await findByText('Asha Rao')).toBeTruthy();
  expect(getByText('Roll —')).toBeTruthy();
  expect(queryByText(/null/i)).toBeNull();
});

it('toggling a student and submitting sends the exact PUT contract, then shows the confirmation before Done navigates back', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance') return Promise.resolve({ saved: 2, absentees: 1 });
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText, getByTestId } = render(<TakeAttendance />);

  const markPresent = await findByTestId('present-s2');
  fireEvent.press(markPresent);

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);
  await settled(() =>
    expect(
      getByText('Attendance saved — 2 students, 1 absent. Guardians of absentees are being notified.'),
    ).toBeTruthy(),
  );
  expect(mockBack).not.toHaveBeenCalled(); // confirmation must land before we leave

  const putCall = (api.request as jest.Mock).mock.calls.find(([path]) => path === '/manage/attendance');
  expect(putCall[1]).toMatchObject({
    method: 'PUT',
    body: {
      classSectionId: 'cs1',
      marks: [
        { studentId: 's1', status: 'PRESENT' },
        { studentId: 's2', status: 'PRESENT' },
      ],
    },
  });
  expect(putCall[1].body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  fireEvent.press(getByTestId('save-confirmation-action'));
  expect(mockBack).toHaveBeenCalled();
});

it('loads a LATE student as LATE, not as present', async () => {
  // The bug: `present: status !== 'ABSENT'` rendered LATE as Present, and the
  // next save rewrote it to PRESENT — destroying a mark made on the web.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([{ studentId: 's1', status: 'LATE' }]);
    }
    if (path.startsWith('/manage/students?')) {
      return Promise.resolve([{ id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' }]);
    }
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<TakeAttendance />);

  const lateButton = await findByTestId('late-s1');
  // The selected pill for a LATE student must be Late, not Present.
  expect(lateButton.props.style).toMatchObject({ backgroundColor: '#F59E0B' });
  const presentButton = await findByTestId('present-s1');
  expect(presentButton.props.style).not.toMatchObject({ backgroundColor: '#16B364' });
});

it('submitting a roster with a LATE student sends LATE', async () => {
  // Assert on the PUT body, not on the UI.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([{ studentId: 's1', status: 'LATE' }]);
    }
    if (path.startsWith('/manage/students?')) {
      return Promise.resolve([{ id: 's1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' }]);
    }
    if (path === '/manage/attendance') return Promise.resolve({ saved: 1, absentees: 0 });
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText } = render(<TakeAttendance />);

  // Wait for the roster row to render before pressing submit — until then
  // the button is disabled (rows.length === 0) and the press is a no-op.
  await findByTestId('late-s1');
  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);
  await settled(() => expect(getByText('Attendance saved — 1 students, nobody absent.')).toBeTruthy());

  const putCall = (api.request as jest.Mock).mock.calls.find(([path]) => path === '/manage/attendance');
  expect(putCall[1]).toMatchObject({
    method: 'PUT',
    body: { classSectionId: 'cs1', marks: [{ studentId: 's1', status: 'LATE' }] },
  });
});

it('a save with zero absentees says nobody was absent, not "0 absent … guardians are being notified"', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance') return Promise.resolve({ saved: 2, absentees: 0 });
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText, queryByText } = render(<TakeAttendance />);

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);
  await settled(() => expect(getByText('Attendance saved — 2 students, nobody absent.')).toBeTruthy());
  expect(queryByText(/guardians/i)).toBeNull();
});

it('a failed save shows the server message verbatim, keeps the marked roster, and does not navigate away', async () => {
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance' && opts?.method === 'PUT') {
      const { ApiError } = jest.requireActual('@/lib/api');
      return Promise.reject(new ApiError(409, 'That day is closed. Ask your admin to reopen it from Requests.'));
    }
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText } = render(<TakeAttendance />);

  const markPresent = await findByTestId('present-s2');
  fireEvent.press(markPresent);

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);
  await settled(() =>
    expect(getByText('That day is closed. Ask your admin to reopen it from Requests.')).toBeTruthy(),
  );
  expect(mockBack).not.toHaveBeenCalled();

  // The marked roster survives the failed save — s2's pill is still PRESENT.
  const presentButton = await findByTestId('present-s2');
  expect(presentButton.props.style).toMatchObject({ backgroundColor: '#16B364' });
});

it('mark-all-present sets every row to PRESENT, including rows that were ABSENT and LATE, without saving', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([
        { studentId: 's1', status: 'ABSENT' },
        { studentId: 's2', status: 'LATE' },
      ]);
    }
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<TakeAttendance />);

  await findByTestId('absent-s1');
  const markAll = await findByTestId('mark-all-present');
  fireEvent.press(markAll);

  const present1 = await findByTestId('present-s1');
  const present2 = await findByTestId('present-s2');
  expect(present1.props.style).toMatchObject({ backgroundColor: '#16B364' });
  expect(present2.props.style).toMatchObject({ backgroundColor: '#16B364' });

  // Edge: it must not have called the API at all.
  expect(api.request as jest.Mock).not.toHaveBeenCalledWith(
    '/manage/attendance',
    expect.objectContaining({ method: 'PUT' }),
  );
});

it('mark-all-present is disabled while a save is in flight', async () => {
  let resolvePut!: (v: unknown) => void;
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance') return new Promise((resolve) => { resolvePut = resolve; });
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<TakeAttendance />);

  const submit = await findByTestId('submit-attendance');
  const markAll = await findByTestId('mark-all-present');
  // `submit` sets `busy` SYNCHRONOUSLY at the top of the handler (before its
  // await), so the disabled state is deterministic once React flushes the
  // press — assert it directly. Wrapping the press in `await act(async …)`
  // drains that flush; a polling waitFor here starves under the parallel
  // 5-suite contention of `pnpm test`/CI (this is what made the test flaky).
  // The save is held pending by resolvePut below, so `busy` stays true.
  await act(async () => {
    fireEvent.press(submit);
  });
  expect(markAll.props.accessibilityState?.disabled).toBe(true);

  // Settle the pending PUT and let its state updates land before the test
  // ends — an unawaited resolution here would fire during the next test's
  // render (a dangling update outside any act() scope), which is exactly
  // the kind of cross-test leakage that shows up as sporadic, hard-to-place
  // failures elsewhere in the file.
  await act(async () => {
    resolvePut({ saved: 2, absentees: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

it('accepts a date param and passes it through to both the GET and the PUT', async () => {
  mockParams = { classSectionId: 'cs1', name: '5-B', date: '2026-07-20' };
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path === '/manage/attendance?classSectionId=cs1&date=2026-07-20') {
      return Promise.resolve(MARKS);
    }
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance') return Promise.resolve({ saved: 2, absentees: 1 });
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByText, findByTestId } = render(<TakeAttendance />);
  expect(await findByText('Asha Rao')).toBeTruthy();

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);
  await settled(() => expect(true).toBe(true));

  const putCall = (api.request as jest.Mock).mock.calls.find(([path]) => path === '/manage/attendance');
  expect(putCall[1]).toMatchObject({ method: 'PUT', body: { date: '2026-07-20' } });
});

it('defaults to today when no date param is given (no regression)', async () => {
  // mockParams from beforeEach carries no `date`.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByText } = render(<TakeAttendance />);
  expect(await findByText('Asha Rao')).toBeTruthy();

  const getCall = (api.request as jest.Mock).mock.calls.find(([path]: [string]) =>
    path.startsWith('/manage/attendance?'),
  );
  expect(getCall[0]).toMatch(/date=\d{4}-\d{2}-\d{2}$/);
});

it('a network-fail save is queued on the device, toasts instead of erroring, and keeps the marked roster on screen', async () => {
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance' && opts?.method === 'PUT') {
      // `safeFetch` in lib/api.ts normalizes an unreachable server to
      // `ApiError(0, ...)` — this is what "no signal" looks like from the
      // screen's point of view.
      return Promise.reject(new ApiError(0, 'Could not reach the school server.'));
    }
    throw new Error(`unexpected path: ${path} ${JSON.stringify(opts)}`);
  });

  const { findByTestId, getByTestId, queryByText, findByText } = render(<TakeAttendance />);

  const markPresent = await findByTestId('present-s2');
  fireEvent.press(markPresent);

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);

  await settled(() => expect(getByTestId('offline-pending-toast')).toBeTruthy());
  expect(await findByText(/saved on this device/i)).toBeTruthy();
  // No error state — a dead signal is not a rejection.
  expect(queryByText('Could not reach the school server.')).toBeNull();

  // The marked roster survives — s2's pill is still PRESENT.
  const presentButton = await findByTestId('present-s2');
  expect(presentButton.props.style).toMatchObject({ backgroundColor: '#16B364' });

  const pending = await pendingSaves();
  expect(pending).toHaveLength(1);
  expect(pending[0].payload).toMatchObject({
    classSectionId: 'cs1',
    marks: [
      { studentId: 's1', status: 'PRESENT' },
      { studentId: 's2', status: 'PRESENT' },
    ],
  });
});
