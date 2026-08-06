import { Alert } from 'react-native';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import type { RegisterChangeRow } from '@skoolos/types';
import StaffAttendance from '../(tabs)/attendance';
import { api, ApiError } from '@/lib/api';
import { shiftISO, todayISO } from '@/lib/attendance';
import { enqueueSave } from '@/lib/offline-queue';

// The offline queue's default storage goes through expo-secure-store — an
// in-memory fake so enqueueSave (used below to pre-seed a queued save) and
// the screen's own flush/pendingSaves calls actually round-trip within a
// test, matching the convention already used by
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

const mockPush = jest.fn();
// There are TWO useFocusEffect calls in this screen (status+flush, then "my
// open requests"), always registered in that order on every render since
// neither is conditional. Capturing both by position lets a test re-invoke
// just the status/flush effect (index 0) without changing `date` — the only
// other thing that gives it a new identity — to simulate connectivity
// returning between two focuses of the same screen.
let mockCapturedEffects: Array<() => void> = [];
let mockHookCallIndex = 0;
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  // Test env has no NavigationContainer, so mimic focus-on-mount/refetch:
  // rerun the wrapped callback whenever ITS OWN identity changes (matching
  // real react-navigation's useFocusEffect, which reruns when the memoized
  // callback changes even without an actual focus/blur event), not just
  // once on mount. The screen's effects are wrapped in `useCallback(fn,
  // [date])`, so this is what lets pressing the date arrows in a test
  // actually trigger a refetch for the newly selected date.
  useFocusEffect: (effect: () => void) => {
    const idx = mockHookCallIndex % 2;
    mockHookCallIndex++;
    mockCapturedEffects[idx] = effect;
    const React = jest.requireActual('react');
    React.useEffect(effect, [effect]);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const TODAY = todayISO();
const YESTERDAY = shiftISO(TODAY, -1);
const TOMORROW = shiftISO(TODAY, 1);

const PENDING = {
  classSectionId: 'cs-pending',
  name: '5-B',
  total: 28,
  present: 0,
  taken: false,
  markedBy: null,
  markedAt: null,
};

const TAKEN = {
  classSectionId: 'cs-taken',
  name: '6-A',
  total: 30,
  present: 26,
  taken: true,
  markedBy: 'Mr. Rao',
  markedAt: '2026-07-24T05:00:00.000Z',
};

// A class as it looked on YESTERDAY specifically — taken, so the locked card
// has counts to show.
const PAST_TAKEN = {
  classSectionId: 'cs-past-taken',
  name: '5-B',
  total: 28,
  present: 24,
  taken: true,
  markedBy: 'Mr. Rao',
  markedAt: `${YESTERDAY}T05:00:00.000Z`,
};

// A class nobody marked on YESTERDAY.
const PAST_UNTAKEN = {
  classSectionId: 'cs-past-untaken',
  name: '6-A',
  total: 15,
  present: 0,
  taken: false,
  markedBy: null,
  markedAt: null,
};

function registerChangeRow(overrides: Partial<RegisterChangeRow> = {}): RegisterChangeRow {
  return {
    id: 'rc-1',
    classSectionId: 'cs-past-taken',
    className: '5-B',
    date: YESTERDAY,
    reason: 'Forgot to mark',
    status: 'PENDING',
    requestedByTeacherId: 't1',
    requestedByName: 'Ms. Rao',
    reviewedAt: null,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Routes the mocked api.request by path/method, matching the take-screen
 * test file's convention. `status` maps a `date=` query param to the rows
 * that endpoint should answer with for that day. */
function mockApi({
  status = {},
  mine,
  post,
}: {
  status?: Record<string, unknown[]>;
  mine?: RegisterChangeRow[] | Promise<never> | Error;
  post?: RegisterChangeRow | Error;
}) {
  (api.request as jest.Mock).mockImplementation(
    (path: string, opts?: { method?: string; body?: unknown }) => {
      const statusMatch = path.match(/^\/manage\/attendance\/status\?date=(.+)$/);
      if (statusMatch) {
        const rows = status[statusMatch[1]];
        if (rows === undefined) throw new Error(`unexpected status date: ${statusMatch[1]}`);
        return Promise.resolve(rows);
      }
      if (path === '/manage/register-changes/mine') {
        if (mine === undefined) throw new Error('unexpected /manage/register-changes/mine call');
        if (mine instanceof Promise) return mine;
        if (mine instanceof Error) return Promise.reject(mine);
        return Promise.resolve(mine);
      }
      if (path === '/manage/register-changes' && opts?.method === 'POST') {
        if (post === undefined) throw new Error('unexpected POST /manage/register-changes');
        if (post instanceof Error) return Promise.reject(post);
        return Promise.resolve(post);
      }
      throw new Error(`unexpected path: ${path} ${JSON.stringify(opts)}`);
    },
  );
}

beforeEach(() => {
  mockPush.mockReset();
  (api.request as jest.Mock).mockReset();
  mockCapturedEffects = [];
  mockHookCallIndex = 0;
});

it('navigates to the take screen when a pending class is tapped', async () => {
  mockApi({ status: { [TODAY]: [PENDING] } });
  const { findByTestId } = render(<StaffAttendance />);

  const takeBtn = await findByTestId('take-cs-pending');
  fireEvent.press(takeBtn);

  expect(mockPush).toHaveBeenCalledWith('/(staff)/take/cs-pending?name=5-B');
});

it('opens an already-marked register without warning, and carries who marked it', async () => {
  // Opening writes nothing — the PUT on the take screen is the only write —
  // so there is no overwrite to confirm here. The confirmation moved to Save,
  // where the overwrite actually happens. This matters beyond tidiness:
  // "Who needs a word" lives at the bottom of the take screen, so a warning
  // at the door put the question "who is slipping?" behind a red, destructive
  // prompt about damaging a colleague's work.
  mockApi({ status: { [TODAY]: [TAKEN] } });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId } = render(<StaffAttendance />);

  fireEvent.press(await findByTestId('retake-cs-taken'));

  expect(alertSpy).not.toHaveBeenCalled();
  // `takenBy` is what lets the take screen name the marker in its banner and
  // in the Save confirmation.
  expect(mockPush).toHaveBeenCalledWith('/(staff)/take/cs-taken?name=6-A&takenBy=Mr.%20Rao');

  alertSpy.mockRestore();
});

it('shows the API error message when the status fetch fails', async () => {
  (api.request as jest.Mock).mockRejectedValue(new ApiError(500, 'Could not reach the school server.'));
  const { findByText } = render(<StaffAttendance />);

  expect(await findByText('Could not reach the school server.')).toBeTruthy();
});

it('shows an empty state when the teacher has no classes', async () => {
  mockApi({ status: { [TODAY]: [] } });
  const { findByText } = render(<StaffAttendance />);

  expect(await findByText(/no classes assigned/i)).toBeTruthy();
});

describe('past dates', () => {
  it('selecting a past date renders the locked card and never issues a PUT', async () => {
    mockApi({
      status: { [TODAY]: [PAST_TAKEN], [YESTERDAY]: [PAST_TAKEN] },
      mine: [],
    });
    const { findByTestId, getByTestId } = render(<StaffAttendance />);
    await findByTestId('retake-cs-past-taken'); // today's normal flow renders first

    fireEvent.press(getByTestId('date-prev'));

    await findByTestId('locked-day-cs-past-taken');
    expect(
      (api.request as jest.Mock).mock.calls.some(
        ([path, opts]) => path === '/manage/attendance' && (opts as { method?: string })?.method === 'PUT',
      ),
    ).toBe(false);
  });

  it('shows the day\'s counts in the locked card when the register exists', async () => {
    mockApi({ status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] }, mine: [] });
    const { getByTestId, findByText } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    expect(await findByText(/24 of 28 present/)).toBeTruthy();
    expect(await findByText(/Mr\. Rao/)).toBeTruthy();
  });

  it('shows an explicit no-record state in the locked card when nothing was recorded', async () => {
    mockApi({ status: { [TODAY]: [], [YESTERDAY]: [PAST_UNTAKEN] }, mine: [] });
    const { getByTestId, findByText } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    expect(await findByText(/No attendance was recorded for that day\./)).toBeTruthy();
  });

  it('a whitespace-only reason does not submit', async () => {
    mockApi({ status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] }, mine: [] });
    const { getByTestId, findByTestId } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    const reasonInput = await findByTestId('locked-day-cs-past-taken-reason');
    fireEvent.changeText(reasonInput, '   ');
    fireEvent.press(getByTestId('locked-day-cs-past-taken-submit'));

    expect(
      (api.request as jest.Mock).mock.calls.some(
        ([path, opts]) =>
          path === '/manage/register-changes' && (opts as { method?: string })?.method === 'POST',
      ),
    ).toBe(false);
  });

  it('an open PENDING request for that class+date shows the pending state, not the form', async () => {
    mockApi({
      status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] },
      mine: [registerChangeRow({ status: 'PENDING' })],
    });
    const { getByTestId, findByTestId, queryByTestId } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    await findByTestId('locked-day-cs-past-taken-pending');
    expect(queryByTestId('locked-day-cs-past-taken-reason')).toBeNull();
  });

  it('while mine is still loading, the form is not submittable', async () => {
    mockApi({
      status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] },
      mine: new Promise<never>(() => {}), // never resolves within this test
    });
    const { getByTestId, findByTestId, queryByTestId } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    await findByTestId('locked-day-cs-past-taken-loading');
    expect(queryByTestId('locked-day-cs-past-taken-reason')).toBeNull();
    expect(queryByTestId('locked-day-cs-past-taken-submit')).toBeNull();
    expect(queryByTestId('locked-day-cs-past-taken-pending')).toBeNull();
  });

  it('an APPROVED unlock with a future expiresAt allows the take flow', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockApi({
      status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] },
      mine: [registerChangeRow({ status: 'APPROVED', expiresAt: future })],
    });
    const { getByTestId, findByTestId, queryByTestId } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    await findByTestId('retake-cs-past-taken'); // normal (unlocked) card, not the locked one
    expect(queryByTestId('locked-day-cs-past-taken')).toBeNull();
  });

  it('an APPROVED unlock with a past expiresAt renders locked', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockApi({
      status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] },
      mine: [registerChangeRow({ status: 'APPROVED', expiresAt: past })],
    });
    const { getByTestId, findByTestId } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    await findByTestId('locked-day-cs-past-taken');
  });

  it('expiresAt: null on a REJECTED row renders locked, not "expires null", and does not crash', async () => {
    mockApi({
      status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] },
      mine: [registerChangeRow({ status: 'REJECTED', expiresAt: null })],
    });
    const { getByTestId, findByTestId, queryByText } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    await findByTestId('locked-day-cs-past-taken');
    expect(queryByText(/expires null/i)).toBeNull();
    expect(queryByText(/null/i)).toBeNull();
  });

  it('submitting a valid reason posts it and the card flips to pending', async () => {
    const created = registerChangeRow({ id: 'rc-new', status: 'PENDING' });
    mockApi({ status: { [TODAY]: [], [YESTERDAY]: [PAST_TAKEN] }, mine: [], post: created });
    const { getByTestId, findByTestId } = render(<StaffAttendance />);
    fireEvent.press(getByTestId('date-prev'));

    const reasonInput = await findByTestId('locked-day-cs-past-taken-reason');
    fireEvent.changeText(reasonInput, ' Forgot to mark this class ');
    fireEvent.press(getByTestId('locked-day-cs-past-taken-submit'));

    await findByTestId('locked-day-cs-past-taken-pending');
    const postCall = (api.request as jest.Mock).mock.calls.find(
      ([path]) => path === '/manage/register-changes',
    );
    expect(postCall[1]).toMatchObject({
      method: 'POST',
      body: { classSectionId: 'cs-past-taken', date: YESTERDAY, reason: 'Forgot to mark this class' },
    });
  });
});

describe('future dates', () => {
  it('a future date is blocked client-side with no request fired', async () => {
    mockApi({ status: { [TODAY]: [PENDING] } });
    const { getByTestId, findByTestId, findByText } = render(<StaffAttendance />);
    await findByTestId('take-cs-pending');
    const callsBefore = (api.request as jest.Mock).mock.calls.length;

    fireEvent.press(getByTestId('date-next'));

    expect(await findByText(/cannot take attendance for a future date/i)).toBeTruthy();
    await waitFor(() => expect((api.request as jest.Mock).mock.calls.length).toBe(callsBefore));
  });
});

describe('offline save queue', () => {
  const PENDING_1 = {
    classSectionId: 'cs-pending',
    name: '5-B',
    total: 1,
    present: 0,
    taken: false,
    markedBy: null,
    markedAt: null,
  };
  const TAKEN_1 = { ...PENDING_1, taken: true, present: 1, markedBy: 'You' };

  it('shows a pending-sync marker, distinct from the normal amber Pending pill, for a class with a queued offline save', async () => {
    await enqueueSave({
      classSectionId: 'cs-pending',
      date: TODAY,
      marks: [{ studentId: 's1', status: 'PRESENT' }],
    });
    (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/manage/attendance' && opts?.method === 'PUT') {
        // Still offline — the flush this screen attempts on focus must not
        // succeed, so the marker stays.
        return Promise.reject(new ApiError(0, 'Could not reach the school server.'));
      }
      if (path === `/manage/attendance/status?date=${TODAY}`) return Promise.resolve([PENDING_1]);
      throw new Error(`unexpected path: ${path} ${JSON.stringify(opts)}`);
    });

    const { findByTestId, findByText, queryByText } = render(<StaffAttendance />);

    await findByTestId('pending-sync-cs-pending');
    expect(await findByText('Saved on device · syncing')).toBeTruthy();
    // Never both at once — the normal not-taken-yet pill's own label must
    // not also be showing.
    expect(queryByText('Pending')).toBeNull();
  });

  it('a successful flush clears the pending-sync marker and shows the true server state (proves the refetch)', async () => {
    await enqueueSave({
      classSectionId: 'cs-pending',
      date: TODAY,
      marks: [{ studentId: 's1', status: 'PRESENT' }],
    });
    let online = false;
    (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === '/manage/attendance' && opts?.method === 'PUT') {
        if (!online) return Promise.reject(new ApiError(0, 'Could not reach the school server.'));
        return Promise.resolve({ saved: 1, absentees: 0 });
      }
      if (path === `/manage/attendance/status?date=${TODAY}`) {
        return Promise.resolve([online ? TAKEN_1 : PENDING_1]);
      }
      throw new Error(`unexpected path: ${path} ${JSON.stringify(opts)}`);
    });

    const { findByTestId, findByText, queryByText } = render(<StaffAttendance />);
    await findByTestId('pending-sync-cs-pending');
    expect(await findByText('Saved on device · syncing')).toBeTruthy();

    // Connectivity returns; re-focus the screen (the actual sync trigger —
    // see the `useFocusEffect` at the top of attendance.tsx).
    online = true;
    await act(async () => {
      mockCapturedEffects[0]?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(queryByText('Saved on device · syncing')).toBeNull());
    expect(await findByText('✓ 1/1 present')).toBeTruthy();
  });
});
