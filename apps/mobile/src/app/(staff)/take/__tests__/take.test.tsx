import { Alert } from 'react-native';
import { act, render, fireEvent, waitFor, within } from '@testing-library/react-native';
import TakeAttendance from '../[classSectionId]';
import { api, ApiError } from '@/lib/api';
import { pendingSaves } from '@/lib/offline-queue';
import * as Haptics from 'expo-haptics';

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

/**
 * The register is a GRID now: one cell per student that CYCLES
 * present → absent → late on each press, rather than three buttons you select
 * directly. `setTo` presses a cell until it holds the status the test wants,
 * so every assertion below still says what it always said.
 */
/** WhoNeedsAWord now renders under the register; this keeps it silent. */
const RATES_EMPTY = {
  classSectionId: 'sec-1',
  className: '8-A',
  from: '2026-05-05',
  to: '2026-08-03',
  daysMarked: 0,
  students: [],
};

const CYCLE_ORDER = ['PRESENT', 'ABSENT', 'LATE'] as const;
async function setTo(
  findByTestId: (id: string) => Promise<{ props: { accessibilityLabel?: string } }>,
  studentId: string,
  want: (typeof CYCLE_ORDER)[number],
) {
  for (let i = 0; i < CYCLE_ORDER.length; i++) {
    const cell = await findByTestId(`cell-${studentId}`);
    const label = String(cell.props.accessibilityLabel ?? '').toLowerCase();
    if (label.includes(want.toLowerCase())) return cell;
    fireEvent.press(cell as never);
  }
  return findByTestId(`cell-${studentId}`);
}

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
let mockParams: { classSectionId: string; name?: string; date?: string; takenBy?: string } = {
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

// The light palette's cell tints (theme/tokens.ts). Asserted by value rather
// than by importing the token so a silent repaint of the register still
// trips a test — these are the three colours the whole screen reads by.
const PRESENT_TINT = '#E3F4EC'; // green50
const ABSENT_TINT = '#FBE9E8'; // red50
const LATE_TINT = '#FDE9C8'; // amber50

/** Re-query before every press: a cell's onPress closes over the status from
 * the render that produced it, so cycling twice off one stale reference would
 * apply the same first transition twice. */
function tap(getByTestId: (id: string) => unknown, id: string) {
  fireEvent.press(getByTestId(id) as Parameters<typeof fireEvent.press>[0]);
}

beforeEach(() => {
  mockBack.mockReset();
  (api.request as jest.Mock).mockReset();
  mockParams = { classSectionId: 'cs1', name: '5-B' };
});

it('joins attendance marks with student roster names and defaults unmarked students to present', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByLabelText, findByText } = render(<TakeAttendance />);

  // The grid drops the names from the face of the cell — that is what makes it
  // fast — so the join is asserted where the name now lives: the cell's
  // accessible name, which is what a screen reader reads out.
  expect(await findByLabelText('Asha Rao, roll 1, present')).toBeTruthy();
  expect(await findByLabelText('Ben Lee, roll 2, absent')).toBeTruthy();
  // Same four figures the web register states, in the same order. `late` has
  // to be one of them: without it, two latecomers in a class of forty read
  // "38 present · 0 absent" with two children unaccounted for.
  expect(await findByText(/2 students · 1 present · 1 absent · 0 late/)).toBeTruthy();
});

it('renders one cell per student, showing their roll number while present', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByTestId } = render(<TakeAttendance />);

  // s1 is present, so its cell reads as its roll number.
  expect(within(await findByTestId('cell-s1')).getByText('1')).toBeTruthy();
  // s2 is absent, so its cell has swapped the number for the glyph — and there
  // is exactly ONE control per student, not three.
  expect(within(getByTestId('cell-s2')).getByText('✕')).toBeTruthy();
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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, queryByText, getByLabelText } = render(<TakeAttendance />);

  const cell = await findByTestId('cell-s1');
  // The cell falls back to a mid-dot rather than printing nothing (or "null"),
  // and the accessible name says "roll none" in words.
  expect(within(cell).getByText('·')).toBeTruthy();
  expect(getByLabelText('Asha Rao, roll none, present')).toBeTruthy();
  expect(queryByText(/null/i)).toBeNull();
});

it('cycling a student and submitting sends the exact PUT contract, then shows the confirmation before Done navigates back', async () => {
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance') return Promise.resolve({ saved: 2, absentees: 1 });
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText, getByTestId } = render(<TakeAttendance />);

  // s2 loads ABSENT; two taps cycle it absent → late → present, which is the
  // only way this screen sets a status now.
  await findByTestId('cell-s2');
  tap(getByTestId, 'cell-s2');
  tap(getByTestId, 'cell-s2');

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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByLabelText } = render(<TakeAttendance />);

  // The cell for a LATE student must read as Late, not Present: amber tint,
  // the clock glyph in place of the roll number, and "late" in its name.
  // The tint lives on the cell BODY, not on the touch target wrapped around
  // it — the press animation owns the outer transform so the two scales
  // compose rather than one silently overwriting the other.
  const cell = await findByTestId('cell-body-s1');
  expect(cell.props.style).toMatchObject({ backgroundColor: LATE_TINT });
  expect(cell.props.style).not.toMatchObject({ backgroundColor: PRESENT_TINT });
  expect(within(cell).getByText('⏱')).toBeTruthy();
  expect(getByLabelText('Asha Rao, roll 1, late')).toBeTruthy();
});

it('keeps the ABSENT cell scaled up, which the press animation could silently eat', async () => {
  // An absence is the mark that costs a deliberate tap, so it is the one cell
  // that moves — scale(1.06). That style now sits on the cell BODY because the
  // Touchable wrapped around it owns the outer transform: RN takes the last
  // transform in the array, so putting both on one node would drop this one
  // with no error, no warning and no failing test. Hence this test.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([{ studentId: 's2', status: 'ABSENT' }]);
    }
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByTestId } = render(<TakeAttendance />);

  const absent = await findByTestId('cell-body-s2');
  expect(absent.props.style.transform).toEqual([{ scale: 1.06 }]);
  // …and a present cell is not scaled, so the emphasis means something.
  expect(getByTestId('cell-body-s1').props.style.transform).toEqual([]);
});

it('ticks the phone harder when the tap is about to mark someone ABSENT', async () => {
  // The haptic fires on press-IN, so it can only know the CURRENT state — the
  // firmness is chosen from where the cycle is going, not where it has been.
  // Present -> Absent is the mark that matters and the one a teacher makes
  // without looking down while walking a row; Absent -> Late is a correction.
  (api.request as jest.Mock).mockImplementation((path: string) => {
    if (path.startsWith('/manage/attendance?')) {
      return Promise.resolve([{ studentId: 's2', status: 'ABSENT' }]);
    }
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByTestId } = render(<TakeAttendance />);
  const impact = Haptics.impactAsync as jest.Mock;

  // s1 is present, so this tap marks an absence.
  fireEvent(await findByTestId('cell-s1'), 'pressIn');
  expect(impact).toHaveBeenLastCalledWith('medium');

  // s2 is already absent, so this tap only moves it on to late.
  fireEvent(getByTestId('cell-s2'), 'pressIn');
  expect(impact).toHaveBeenLastCalledWith('light');
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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText } = render(<TakeAttendance />);

  // Wait for the roster to render before pressing submit — until then the
  // button is disabled (rows.length === 0) and the press is a no-op.
  await findByTestId('cell-s1');
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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText, queryByText } = render(<TakeAttendance />);

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);
  await settled(() => expect(getByText('Attendance saved — 2 students, nobody absent.')).toBeTruthy());
  expect(queryByText(/guardians/i)).toBeNull();
});

describe('replacing a register someone else already took', () => {
  // The warning used to fire when the class was merely OPENED, which was
  // wrong twice over: opening this screen issues no PUT, and "Who needs a
  // word" lives at the bottom of it — so the question a teacher asks right
  // after the morning register ("who is slipping?") sat behind a red prompt
  // about overwriting a colleague's work. It belongs on Save.
  const mockSave = () =>
    (api.request as jest.Mock).mockImplementation((path: string) => {
      if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
      if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
      if (path === '/manage/attendance') return Promise.resolve({ saved: 2, absentees: 0 });
      if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
      throw new Error(`unexpected path: ${path}`);
    });

  it('names the marker and writes nothing until the teacher confirms', async () => {
    mockParams = { classSectionId: 'cs1', name: '5-B', takenBy: 'Mr. Rao' };
    mockSave();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByTestId, findByText } = render(<TakeAttendance />);

    // The banner names whose work is about to change, before you change it.
    expect(await findByText(/Taken by Mr\. Rao\. Saving replaces that record\./)).toBeTruthy();

    fireEvent.press(await findByTestId('submit-attendance'));

    const [title, message, buttons] = alertSpy.mock.calls[0];
    expect(title).toMatch(/5-B/);
    expect(message).toMatch(/Mr\. Rao/);
    expect(message).toMatch(/audit log/i);
    // Dismissing must not write.
    expect(
      (api.request as jest.Mock).mock.calls.filter((c) => c[0] === '/manage/attendance'),
    ).toHaveLength(0);

    await act(async () => {
      buttons?.find((b: { text?: string }) => b.text === 'Replace')?.onPress?.();
    });
    await waitFor(() =>
      expect(
        (api.request as jest.Mock).mock.calls.filter((c) => c[0] === '/manage/attendance'),
      ).toHaveLength(1),
    );

    alertSpy.mockRestore();
  });

  it('saves an unmarked class straight through, with no confirmation at all', async () => {
    mockParams = { classSectionId: 'cs1', name: '5-B' }; // no takenBy
    mockSave();
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { findByTestId, queryByText } = render(<TakeAttendance />);

    fireEvent.press(await findByTestId('submit-attendance'));

    // Asserted on the dialog and the PUT, NOT on the save toast: the toast is
    // a round-trip away, and waiting for it made this test starve under the
    // concurrent, CPU-oversubscribed run `pnpm preflight` actually uses — a
    // red suite for a timing reason that has nothing to do with the subject.
    // The confirmation branch is decided synchronously, so this is the whole
    // behaviour. (The save toast itself is covered by the tests above.)
    await waitFor(() =>
      expect(
        (api.request as jest.Mock).mock.calls.filter((c) => c[0] === '/manage/attendance'),
      ).toHaveLength(1),
    );
    expect(alertSpy).not.toHaveBeenCalled();
    expect(queryByText(/Saving replaces that record/)).toBeNull();

    alertSpy.mockRestore();
  });
});

it('a failed save shows the server message verbatim, keeps the marked roster, and does not navigate away', async () => {
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith('/manage/attendance?')) return Promise.resolve(MARKS);
    if (path.startsWith('/manage/students?')) return Promise.resolve(STUDENTS);
    if (path === '/manage/attendance' && opts?.method === 'PUT') {
      const { ApiError } = jest.requireActual('@/lib/api');
      return Promise.reject(new ApiError(409, 'That day is closed. Ask your admin to reopen it from Requests.'));
    }
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId, getByText } = render(<TakeAttendance />);

  await setTo(findByTestId, 's2', 'PRESENT');

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);
  await settled(() =>
    expect(getByText('That day is closed. Ask your admin to reopen it from Requests.')).toBeTruthy(),
  );
  expect(mockBack).not.toHaveBeenCalled();

  // The marked roster survives the failed save — s2's cell still reads present.
  const cell = await findByTestId('cell-s2');
  expect(String(cell.props.accessibilityLabel).toLowerCase()).toContain('present');
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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByTestId } = render(<TakeAttendance />);

  // Both arrive already marked from the server — s1 absent, s2 late.
  const before = await findByTestId('cell-s1');
  expect(String(before.props.accessibilityLabel).toLowerCase()).toContain('absent');

  fireEvent.press(await findByTestId('mark-all-present'));

  // ...and mark-all-present clears BOTH, not just the absent one.
  const c1 = await findByTestId('cell-s1');
  const c2 = await findByTestId('cell-s2');
  expect(String(c1.props.accessibilityLabel).toLowerCase()).toContain('present');
  expect(String(c2.props.accessibilityLabel).toLowerCase()).toContain('present');

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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByLabelText, findByTestId } = render(<TakeAttendance />);
  expect(await findByLabelText(/Asha Rao/)).toBeTruthy();

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
    // WhoNeedsAWord renders under the register and fetches this. Answered
    // here rather than in each mock so a ninth mock cannot forget it.
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path}`);
  });

  const { findByLabelText } = render(<TakeAttendance />);
  expect(await findByLabelText(/Asha Rao/)).toBeTruthy();

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
    if (path.startsWith('/manage/attendance/rates')) return Promise.resolve(RATES_EMPTY);
    throw new Error(`unexpected path: ${path} ${JSON.stringify(opts)}`);
  });

  const { findByTestId, getByTestId, queryByText, findByText } = render(<TakeAttendance />);

  await setTo(findByTestId, 's2', 'PRESENT');

  const submit = await findByTestId('submit-attendance');
  fireEvent.press(submit);

  await settled(() => expect(getByTestId('offline-pending-toast')).toBeTruthy());
  expect(await findByText(/saved on this device/i)).toBeTruthy();
  // No error state — a dead signal is not a rejection.
  expect(queryByText('Could not reach the school server.')).toBeNull();

  // The marked roster survives — s2's cell still reads present.
  const survivor = await findByTestId('cell-s2');
  expect(String(survivor.props.accessibilityLabel).toLowerCase()).toContain('present');

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
