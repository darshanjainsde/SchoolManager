import { Alert } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import type { LeaveApplication, RegisterChangeRow } from '@skoolos/types';
import Requests from '../requests';
import { api, ApiError } from '@/lib/api';
import { todayISO } from '@/lib/attendance';

jest.mock('expo-router', () => ({
  // Test env has no NavigationContainer, so mimic focus-on-mount/refetch:
  // rerun the wrapped callback whenever ITS OWN identity changes, matching
  // real react-navigation's useFocusEffect (see the identical shim in
  // (staff)/__tests__/attendance.test.tsx).
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, [effect]);
  },
}));

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const TODAY = todayISO();

function leaveRow(overrides: Partial<LeaveApplication> = {}): LeaveApplication {
  return {
    id: 'lv-1',
    type: 'SICK',
    startDate: '2026-07-20T00:00:00.000Z',
    endDate: '2026-07-21T00:00:00.000Z',
    reason: 'Flu',
    status: 'PENDING',
    createdAt: '2026-07-18T10:00:00.000Z',
    ...overrides,
  };
}

function registerRow(overrides: Partial<RegisterChangeRow> = {}): RegisterChangeRow {
  return {
    id: 'rc-1',
    classSectionId: 'cs-1',
    className: '5-B',
    date: '2026-07-15',
    reason: 'Forgot to mark',
    status: 'PENDING',
    requestedByTeacherId: 't1',
    requestedByName: 'Ms. Rao',
    reviewedAt: null,
    expiresAt: null,
    createdAt: '2026-07-15T09:00:00.000Z',
    ...overrides,
  };
}

/** Routes the mocked api.request by path/method. `leaveSequence`, when
 * given, answers successive `GET /manage/leave/mine` calls with successive
 * entries (repeating the last once exhausted) — used to prove a cancel
 * actually refetches rather than patching state locally. */
function mockApi({
  leave,
  leaveSequence,
  register,
  cancelResult,
  postResult,
}: {
  leave?: LeaveApplication[] | Error;
  leaveSequence?: (LeaveApplication[] | Error)[];
  register?: RegisterChangeRow[] | Error;
  cancelResult?: { status: string; restoredDates: number } | Error;
  postResult?: LeaveApplication | Error;
}) {
  let leaveCalls = 0;
  (api.request as jest.Mock).mockImplementation((path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === '/manage/leave/mine') {
      let result: LeaveApplication[] | Error | undefined;
      if (leaveSequence) {
        result = leaveSequence[Math.min(leaveCalls, leaveSequence.length - 1)];
        leaveCalls += 1;
      } else {
        result = leave;
      }
      if (result === undefined) throw new Error('unexpected /manage/leave/mine call');
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
    }
    if (path === '/manage/register-changes/mine') {
      if (register === undefined) throw new Error('unexpected /manage/register-changes/mine call');
      return register instanceof Error ? Promise.reject(register) : Promise.resolve(register);
    }
    if (/^\/manage\/leave\/[\w-]+\/cancel$/.test(path) && opts?.method === 'POST') {
      if (cancelResult === undefined) throw new Error('unexpected cancel call');
      return cancelResult instanceof Error ? Promise.reject(cancelResult) : Promise.resolve(cancelResult);
    }
    if (path === '/manage/leave' && opts?.method === 'POST') {
      if (postResult === undefined) throw new Error('unexpected POST /manage/leave');
      return postResult instanceof Error ? Promise.reject(postResult) : Promise.resolve(postResult);
    }
    throw new Error(`unexpected path: ${path} ${JSON.stringify(opts)}`);
  });
}

beforeEach(() => {
  (api.request as jest.Mock).mockReset();
});

// ── Basic states ─────────────────────────────────────────────────────────

it('shows a loading state before either fetch settles', async () => {
  mockApi({ leave: new Promise<never>(() => {}) as unknown as LeaveApplication[], register: [] });
  const { findByLabelText } = render(<Requests />);

  expect(await findByLabelText('Loading your requests…')).toBeTruthy();
});

it('shows an empty state once both sources have settled with nothing', async () => {
  mockApi({ leave: [], register: [] });
  const { findByText } = render(<Requests />);

  expect(await findByText('No requests yet.')).toBeTruthy();
});

it('shows the kind badge for each row', async () => {
  mockApi({ leave: [leaveRow()], register: [registerRow()] });
  const { findByText } = render(<Requests />);

  expect(await findByText('Leave')).toBeTruthy();
  expect(await findByText('Register change')).toBeTruthy();
});

// ── Merged, sorted queue ─────────────────────────────────────────────────

it('merges leave and register-change rows into one queue sorted by createdAt desc', async () => {
  mockApi({
    leave: [leaveRow({ id: 'lv-old', createdAt: '2026-07-10T00:00:00.000Z' })],
    register: [registerRow({ id: 'rc-new', createdAt: '2026-07-20T00:00:00.000Z' })],
  });
  const { findAllByTestId } = render(<Requests />);

  const rows = await findAllByTestId(/^request-row-/);
  expect(rows.map((r) => r.props.testID)).toEqual(['request-row-register-rc-new', 'request-row-leave-lv-old']);
});

// ── Expiry honesty (proved by deletion — see task report) ─────────────────

describe('expiry honesty', () => {
  it('an APPROVED register-change with a past expiresAt reads Expired, not Approved', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    mockApi({ leave: [], register: [registerRow({ status: 'APPROVED', expiresAt: past })] });
    const { findByTestId, findByText, queryByText } = render(<Requests />);

    await findByTestId('request-row-register-rc-1');
    expect(await findByText('Expired')).toBeTruthy();
    expect(queryByText('Approved')).toBeNull();
  });

  it('an APPROVED register-change with a future expiresAt reads Approved and shows the deadline', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockApi({ leave: [], register: [registerRow({ status: 'APPROVED', expiresAt: future })] });
    const { findByText } = render(<Requests />);

    expect(await findByText('Approved')).toBeTruthy();
    expect(await findByText(/Expires/)).toBeTruthy();
  });

  it('expiresAt: null on a REJECTED row renders Rejected, never the literal "null"', async () => {
    mockApi({ leave: [], register: [registerRow({ status: 'REJECTED', expiresAt: null })] });
    const { findByTestId, findByText, queryByText } = render(<Requests />);

    await findByTestId('request-row-register-rc-1');
    expect(await findByText('Rejected')).toBeTruthy();
    expect(queryByText(/null/i)).toBeNull();
  });
});

// ── Cancellability ───────────────────────────────────────────────────────

it('only PENDING and APPROVED leave rows offer a Cancel button', async () => {
  mockApi({
    leave: [
      leaveRow({ id: 'lv-pending', status: 'PENDING' }),
      leaveRow({ id: 'lv-approved', status: 'APPROVED' }),
      leaveRow({ id: 'lv-rejected', status: 'REJECTED' }),
      leaveRow({ id: 'lv-cancelled', status: 'CANCELLED' }),
    ],
    register: [],
  });
  const { findByTestId, queryByTestId } = render(<Requests />);

  await findByTestId('cancel-lv-pending');
  expect(await findByTestId('cancel-lv-approved')).toBeTruthy();
  expect(queryByTestId('cancel-lv-rejected')).toBeNull();
  expect(queryByTestId('cancel-lv-cancelled')).toBeNull();
});

// ── Cancel flow ──────────────────────────────────────────────────────────

it('cancelling asks for confirmation naming that classes and attendance are restored', async () => {
  mockApi({ leave: [leaveRow({ status: 'PENDING' })], register: [] });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId } = render(<Requests />);

  fireEvent.press(await findByTestId('cancel-lv-1'));

  expect(alertSpy).toHaveBeenCalledTimes(1);
  const [title, message] = alertSpy.mock.calls[0];
  expect(title).toMatch(/cancel/i);
  expect(String(message)).toMatch(/classes and attendance/i);
  expect(String(message)).toMatch(/restored/i);

  alertSpy.mockRestore();
});

it('cancel refetches — the second GET is what the UI ends up showing', async () => {
  mockApi({
    leaveSequence: [[leaveRow({ status: 'PENDING' })], [leaveRow({ status: 'CANCELLED' })]],
    register: [],
    cancelResult: { status: 'CANCELLED', restoredDates: 1 },
  });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId, findByText } = render(<Requests />);

  fireEvent.press(await findByTestId('cancel-lv-1'));
  const buttons = alertSpy.mock.calls[0][2];
  const confirm = buttons?.find((b) => b.text === 'Yes, cancel leave');
  act(() => {
    confirm?.onPress?.();
  });

  // Prove it is the RESPONSE OF THE SECOND GET on screen, not a locally
  // patched status — the row must read Cancelled, and the confirm toast
  // (which fires as soon as the cancel POST resolves, before the refetch)
  // must also be visible by then.
  await waitFor(async () => expect(await findByText('Cancelled')).toBeTruthy());
  expect(await findByTestId('cancel-success')).toBeTruthy();

  const leaveCalls = (api.request as jest.Mock).mock.calls.filter(([p]) => p === '/manage/leave/mine');
  expect(leaveCalls.length).toBe(2);

  alertSpy.mockRestore();
});

it('double-tapping the confirm button cannot fire two cancel calls', async () => {
  mockApi({
    leave: [leaveRow({ status: 'PENDING' })],
    register: [],
    cancelResult: { status: 'CANCELLED', restoredDates: 0 },
  });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId } = render(<Requests />);

  fireEvent.press(await findByTestId('cancel-lv-1'));
  const buttons = alertSpy.mock.calls[0][2];
  const confirm = buttons?.find((b) => b.text === 'Yes, cancel leave');
  // Two synchronous invocations, as a double-tap would produce before any
  // state update from the first has flushed — both inside one `act` so
  // React never gets a chance to flush the ref-guarding state update from
  // the first call between the two `onPress` invocations.
  act(() => {
    confirm?.onPress?.();
    confirm?.onPress?.();
  });

  await waitFor(() => {
    const cancelCalls = (api.request as jest.Mock).mock.calls.filter(([p]: [string]) =>
      /\/cancel$/.test(p),
    );
    expect(cancelCalls.length).toBe(1);
  });

  alertSpy.mockRestore();
});

it('a failed cancel shows the server message verbatim and does not remove the row', async () => {
  mockApi({
    leave: [leaveRow({ status: 'PENDING' })],
    register: [],
    cancelResult: new ApiError(409, 'This application has nothing to cancel'),
  });
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const { findByTestId, findByText } = render(<Requests />);

  fireEvent.press(await findByTestId('cancel-lv-1'));
  const buttons = alertSpy.mock.calls[0][2];
  act(() => {
    buttons?.find((b) => b.text === 'Yes, cancel leave')?.onPress?.();
  });

  expect(await findByText('This application has nothing to cancel')).toBeTruthy();
  expect(await findByTestId('request-row-leave-lv-1')).toBeTruthy();

  alertSpy.mockRestore();
});

// ── Partial failure (proved by deletion — see task report) ────────────────

it('one source failing still shows the other source\'s data, alongside the error', async () => {
  mockApi({
    leave: [leaveRow({ id: 'lv-ok' })],
    register: new ApiError(500, 'Could not load register-change requests.'),
  });
  const { findByTestId, findByText } = render(<Requests />);

  expect(await findByTestId('request-row-leave-lv-ok')).toBeTruthy();
  expect(await findByText('Could not load register-change requests.')).toBeTruthy();
});

it('the reverse partial failure also holds: register data survives a failed leave fetch', async () => {
  mockApi({
    leave: new ApiError(500, 'Could not load leave applications.'),
    register: [registerRow({ id: 'rc-ok' })],
  });
  const { findByTestId, findByText } = render(<Requests />);

  expect(await findByTestId('request-row-register-rc-ok')).toBeTruthy();
  expect(await findByText('Could not load leave applications.')).toBeTruthy();
});

// ── Apply-for-leave form ─────────────────────────────────────────────────

it('end-before-start is blocked client-side and no request is fired', async () => {
  mockApi({ leave: [], register: [] });
  const { findByTestId, findByText } = render(<Requests />);

  await findByTestId('apply-submit');

  // Both default to today; pushing "to" one day earlier puts it before "from".
  fireEvent.press(await findByTestId('apply-to-prev'));
  expect(await findByText(/end date must be on or after/i)).toBeTruthy();

  fireEvent.press(await findByTestId('apply-submit'));

  await waitFor(() =>
    expect(
      (api.request as jest.Mock).mock.calls.filter(
        ([p, o]: [string, { method?: string }?]) => p === '/manage/leave' && o?.method === 'POST',
      ),
    ).toHaveLength(0),
  );
});

it('a whitespace-only reason is sent as undefined, not an empty string', async () => {
  mockApi({ leave: [], register: [], postResult: leaveRow({ id: 'lv-new' }) });
  const { findByTestId } = render(<Requests />);

  fireEvent.changeText(await findByTestId('apply-reason'), '   ');
  fireEvent.press(await findByTestId('apply-submit'));

  await waitFor(() => {
    const postCall = (api.request as jest.Mock).mock.calls.find(
      ([p, o]: [string, { method?: string }?]) => p === '/manage/leave' && o?.method === 'POST',
    );
    expect(postCall).toBeTruthy();
  });
  const postCall = (api.request as jest.Mock).mock.calls.find(
    ([p, o]: [string, { method?: string }?]) => p === '/manage/leave' && o?.method === 'POST',
  );
  expect(postCall[1].body).toMatchObject({ type: 'SICK', startDate: TODAY, endDate: TODAY });
  expect(postCall[1].body.reason).toBeUndefined();
});

it('a trimmed non-empty reason is sent as-is', async () => {
  mockApi({ leave: [], register: [], postResult: leaveRow({ id: 'lv-new' }) });
  const { findByTestId } = render(<Requests />);

  fireEvent.changeText(await findByTestId('apply-reason'), '  Feeling unwell  ');
  fireEvent.press(await findByTestId('apply-submit'));

  await waitFor(() => {
    const postCall = (api.request as jest.Mock).mock.calls.find(
      ([p, o]: [string, { method?: string }?]) => p === '/manage/leave' && o?.method === 'POST',
    );
    expect(postCall?.[1]?.body?.reason).toBe('Feeling unwell');
  });
});

it('picking a leave type changes what is submitted', async () => {
  mockApi({ leave: [], register: [], postResult: leaveRow({ id: 'lv-new', type: 'CASUAL' }) });
  const { findByTestId } = render(<Requests />);

  fireEvent.press(await findByTestId('apply-type-CASUAL'));
  fireEvent.press(await findByTestId('apply-submit'));

  await waitFor(() => {
    const postCall = (api.request as jest.Mock).mock.calls.find(
      ([p, o]: [string, { method?: string }?]) => p === '/manage/leave' && o?.method === 'POST',
    );
    expect(postCall?.[1]?.body?.type).toBe('CASUAL');
  });
});

it('a successful apply shows a confirmation and refetches the queue', async () => {
  mockApi({
    leave: [],
    register: [],
    postResult: leaveRow({ id: 'lv-new' }),
  });
  const { findByTestId } = render(<Requests />);

  await findByTestId('apply-submit');
  const leaveCallsBefore = (api.request as jest.Mock).mock.calls.filter(([p]) => p === '/manage/leave/mine').length;

  fireEvent.press(await findByTestId('apply-submit'));

  await waitFor(() => expect(api.request).toHaveBeenCalledWith('/manage/leave', expect.objectContaining({ method: 'POST' })));
  await waitFor(async () => expect(await findByTestId('apply-success')).toBeTruthy());

  const leaveCallsAfter = (api.request as jest.Mock).mock.calls.filter(([p]) => p === '/manage/leave/mine').length;
  expect(leaveCallsAfter).toBeGreaterThan(leaveCallsBefore);
});

it('a failed apply shows the server message verbatim', async () => {
  mockApi({ leave: [], register: [], postResult: new ApiError(400, 'endDate must be on or after startDate') });
  const { findByTestId, findByText } = render(<Requests />);

  fireEvent.press(await findByTestId('apply-submit'));

  expect(await findByText('endDate must be on or after startDate')).toBeTruthy();
});
