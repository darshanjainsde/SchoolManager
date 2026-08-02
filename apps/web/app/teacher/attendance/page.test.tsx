import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { fireEvent, screen, waitForElementToBeRemoved, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { MyClassSection } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherAttendancePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

// The page reads `classSectionId` off the URL as its initial selection; tests
// that need a class pre-selected (loading/error/empty states, the taken/past
// branches) set this per-test rather than driving the <select> by hand.
let searchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

/** Routes GET calls by path prefix so one test can stub every endpoint the page calls. */
function mockGet(handlers: Array<[string, () => Promise<unknown>]>) {
  return vi.fn((path: string) => {
    const hit = handlers.find(([prefix]) => path.startsWith(prefix));
    if (!hit) return Promise.reject(new Error(`Unhandled GET ${path}`));
    return hit[1]();
  });
}

// `/manage/attendance/my-classes` already composes the display name ("8-A"),
// unlike the school-wide unscoped roster's `{id, name, grade:{name}}` shape.
const classSections: MyClassSection[] = [
  { classSectionId: 'sec-1', name: '8-A', studentCount: 2, covering: false },
];

function statusRow(overrides: Partial<{
  classSectionId: string;
  name: string;
  total: number;
  present: number;
  taken: boolean;
  markedBy: string | null;
  markedAt: string | null;
}> = {}) {
  return {
    classSectionId: 'sec-1',
    name: '8-A',
    total: 2,
    present: 0,
    taken: false,
    markedBy: null,
    markedAt: null,
    ...overrides,
  };
}

const students = [
  { id: 'stu-1', firstName: 'Asha', lastName: 'Rao', rollNo: '1' },
  { id: 'stu-2', firstName: 'Bilal', lastName: 'Khan', rollNo: '2' },
];

/** A row from `GET /manage/register-changes/mine`, defaulted to an open PENDING request. */
function registerChangeRow(overrides: Partial<{
  id: string;
  classSectionId: string;
  date: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  expiresAt: string | null;
}> = {}) {
  return {
    id: 'rc-1',
    classSectionId: 'sec-1',
    className: '8-A',
    date: '2020-01-01',
    reason: 'Late enrolment correction',
    status: 'PENDING' as const,
    requestedByTeacherId: 'teacher-1',
    requestedByName: 'Anita Rao',
    reviewedAt: null,
    expiresAt: null,
    createdAt: '2019-12-31T10:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  return renderWithProviders(
    <>
      <TeacherAttendancePage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

afterEach(() => {
  vi.useRealTimers();
});

describe('TeacherAttendancePage', () => {
  it('an untaken class for today renders the editable roster', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    // Per-student status toggles only exist on the editable roster.
    expect(screen.getAllByRole('button', { name: 'Present' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Absent' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Late' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /re-take attendance/i })).not.toBeInTheDocument();
  });

  it('the class picker is populated from /manage/attendance/my-classes and INCLUDES a covering row, labelled', async () => {
    // Unlike tests/results, a substitute covering a class for the day may
    // still take its attendance — AttendanceService.save allows
    // `covering: true` sections — so the picker must keep the row, just
    // label it so the teacher understands why an unusual class is listed.
    const withCovering: MyClassSection[] = [
      ...classSections,
      { classSectionId: 'sec-2', name: '9-B', studentCount: 5, covering: true },
    ];
    const api = mockApi({
      get: mockGet([
        // The rail is built from `status`, so it has to carry both classes.
        [
          '/manage/attendance/status',
          () =>
            Promise.resolve([
              statusRow({ classSectionId: 'sec-1', name: '8-A' }),
              statusRow({ classSectionId: 'sec-2', name: '9-B', total: 5 }),
            ]),
        ],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(withCovering)],
        ['/manage/students?', () => Promise.resolve([])],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    // The rail IS the picker now — the duplicate <select> above it was
    // removed, since it listed the same classes with strictly less
    // information (no taken/due state) and made the page look like it had two
    // separate controls.
    expect(await screen.findByRole('button', { name: /8-A/ })).toBeInTheDocument();
    // A substitute covering a class may still take its register, so the row
    // stays — labelled, so an unusual class in the list explains itself.
    expect(screen.getByRole('button', { name: /9-B · covering/ })).toBeInTheDocument();
    // Whitelist the endpoints actually stubbed above — anything outside this
    // set (in particular the old unscoped roster endpoint) is a regression.
    const allowedPrefixes = [
      '/manage/attendance/status',
      '/manage/attendance?',
      '/manage/attendance/my-classes',
      '/manage/students?',
      '/manage/register-changes/mine',
    ];
    const getPaths = vi.mocked(api.get).mock.calls.map(([path]) => path);
    expect(getPaths.every((p) => allowedPrefixes.some((prefix) => p.startsWith(prefix)))).toBe(true);
  });

  it('a taken class for today renders the summary and NO editable roster', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        [
          '/manage/attendance/status',
          () => Promise.resolve([statusRow({ taken: true, present: 1, total: 2, markedBy: 'Anita Rao' })]),
        ],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText(/1 of 2 present/)).toBeInTheDocument();
    expect(screen.getByText(/Taken by Anita Rao/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /re-take attendance/i })).toBeInTheDocument();
    // No editable roster: no per-student toggle buttons, and the roster/marks
    // endpoints for the editable view must never even be requested.
    expect(screen.queryByRole('button', { name: 'Present' })).not.toBeInTheDocument();
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/manage/students'));
  });

  it('selecting a past date renders LockedDay and never issues a PUT', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByText('Asha Rao');

    // `fireEvent.change` rather than `user.type` — a native `type="date"`
    // input parses its value from complete date parts, not individual
    // keystrokes, and userEvent's per-character typing doesn't reliably
    // drive it in jsdom.
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });

    expect(await screen.findByText(/is closed/i)).toBeInTheDocument();
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save attendance/i })).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  describe('local-vs-UTC date correctness', () => {
    const originalTZ = process.env.TZ;

    beforeAll(() => {
      // Pinning TZ ourselves (rather than deriving the expectation from the
      // frozen instant's local parts) means this test can only pass if the
      // page genuinely saves the *local* calendar day.
      process.env.TZ = 'Asia/Kolkata';
    });

    afterAll(() => {
      // `process.env.TZ = undefined` writes the literal string "undefined",
      // which Node/ICU cannot parse and silently treats as UTC — and Vitest
      // reuses a worker across files without resetting process.env, so that
      // would poison every later suite in this worker. Delete instead.
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    });

    it('saves under the local date, not the UTC one, when the two disagree', async () => {
      // IST is UTC+5:30; local -> UTC subtracts 5:30, which only rolls the UTC
      // day *backward* when the local clock reads before 05:30. 2026-07-29
      // 02:00 local is 2026-07-28T20:30:00.000Z — a `toISOString().slice(0,10)`
      // bug would save '2026-07-28'; the correct local-date save is '2026-07-29'.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(2026, 6, 29, 2, 0));

      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      searchParams = new URLSearchParams('classSectionId=sec-1');
      const api = mockApi({
        get: mockGet([
          ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false, total: 2 })])],
          ['/manage/attendance?', () => Promise.resolve([])],
          ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
          ['/manage/students?', () => Promise.resolve(students)],
          ['/manage/register-changes/mine', () => Promise.resolve([])],
        ]),
        put: vi.fn().mockResolvedValue({ saved: 2, absentees: 0 }),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Asha Rao');

      await user.click(screen.getByRole('button', { name: /save attendance/i }));

      expect(api.put).toHaveBeenCalledWith(
        '/manage/attendance',
        expect.objectContaining({ classSectionId: 'sec-1', date: '2026-07-29' }),
      );
    });
  });

  it('surfaces the server 409 message verbatim when a save fails', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false, total: 2 })])],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
      put: vi.fn().mockRejectedValue(new Error('That day is closed. Ask your admin to reopen it from Requests.')),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByText('Asha Rao');

    await user.click(screen.getByRole('button', { name: /save attendance/i }));

    expect(
      await screen.findByText('That day is closed. Ask your admin to reopen it from Requests.'),
    ).toBeInTheDocument();
  });

  it('renders a loading state for the roster', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    let resolveStudents!: (v: typeof students) => void;
    const pending = new Promise<typeof students>((resolve) => {
      resolveStudents = resolve;
    });
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => pending],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Loading roster…')).toBeInTheDocument();
    resolveStudents(students);
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
  });

  it('renders the server error message when the roster fails to load', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.reject(new Error('Roster service is unavailable'))],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Roster service is unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state when the class has no students', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false, total: 0 })])],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve([])],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(
      await screen.findByText('No students in this class yet — your admin needs to enrol them.'),
    ).toBeInTheDocument();
  });

  it('renders the status error and never shows "no students" while the status query is failed', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.reject(new Error('Status service is unavailable'))],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Status service is unavailable')).toBeInTheDocument();
    expect(
      screen.queryByText('No students in this class yet — your admin needs to enrol them.'),
    ).not.toBeInTheDocument();
    // The roster/marks queries never even fire while the status query is broken.
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/manage/students'));
  });

  it('does not offer a submittable request form while myRequests is still loading', async () => {
    searchParams = new URLSearchParams('classSectionId=sec-1');
    let resolveMyRequests!: (v: never[]) => void;
    const pending = new Promise<never[]>((resolve) => {
      resolveMyRequests = resolve;
    });
    const api = mockApi({
      get: mockGet([
        ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => pending],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByText('Asha Rao');

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });

    expect(await screen.findByText(/is closed/i)).toBeInTheDocument();
    // While we don't yet know whether a request is already open, the form
    // must not be offered — otherwise a teacher can submit a duplicate and
    // discover the server's 409 as a toast instead of being blocked by the UI.
    expect(screen.queryByLabelText('Reason for reopening')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /request a change/i })).not.toBeInTheDocument();

    resolveMyRequests([]);

    expect(await screen.findByLabelText('Reason for reopening')).toBeInTheDocument();
  });

  describe('admin-approved register unlock', () => {
    it('an APPROVED request with a future expiresAt renders the editable roster on a past date, and a PUT succeeds', async () => {
      const user = userEvent.setup();
      searchParams = new URLSearchParams('classSectionId=sec-1');
      const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const api = mockApi({
        get: mockGet([
          ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false, total: 2 })])],
          ['/manage/attendance?', () => Promise.resolve([])],
          ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
          ['/manage/students?', () => Promise.resolve(students)],
          [
            '/manage/register-changes/mine',
            () => Promise.resolve([registerChangeRow({ status: 'APPROVED', expiresAt: future })]),
          ],
        ]),
        put: vi.fn().mockResolvedValue({ saved: 2, absentees: 0 }),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Asha Rao');
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });

      // The unlocked roster, not LockedDay.
      expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
      expect(screen.queryByText(/is closed/i)).not.toBeInTheDocument();
      expect(screen.getByText(/reopened by your admin/i)).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /save attendance/i }));

      expect(api.put).toHaveBeenCalledWith(
        '/manage/attendance',
        expect.objectContaining({ classSectionId: 'sec-1', date: '2020-01-01' }),
      );
    });

    it('an APPROVED request with a past expiresAt renders LockedDay', async () => {
      searchParams = new URLSearchParams('classSectionId=sec-1');
      const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const api = mockApi({
        get: mockGet([
          ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
          ['/manage/attendance?', () => Promise.resolve([])],
          ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
          ['/manage/students?', () => Promise.resolve(students)],
          [
            '/manage/register-changes/mine',
            () => Promise.resolve([registerChangeRow({ status: 'APPROVED', expiresAt: past })]),
          ],
        ]),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Asha Rao');
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });

      // `myRequests` briefly renders LockedDay in its own "checking" loading
      // state before the mocked GET resolves — asserting on that transient
      // frame instead of the settled one would pass even if the expiry check
      // were missing entirely, so wait for the loading indicator to clear
      // (i.e. for `myRequests` to have actually settled) before asserting on
      // the final, decided state.
      await screen.findByText(/checking for an existing request/i);
      await waitForElementToBeRemoved(() => screen.queryByText(/checking for an existing request/i));

      expect(screen.getByText(/is closed/i)).toBeInTheDocument();
      expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
      expect(api.put).not.toHaveBeenCalled();
    });

    it('a PENDING request still renders LockedDay with the pending state', async () => {
      searchParams = new URLSearchParams('classSectionId=sec-1');
      const api = mockApi({
        get: mockGet([
          ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
          ['/manage/attendance?', () => Promise.resolve([])],
          ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
          ['/manage/students?', () => Promise.resolve(students)],
          [
            '/manage/register-changes/mine',
            () => Promise.resolve([registerChangeRow({ status: 'PENDING', expiresAt: null })]),
          ],
        ]),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Asha Rao');
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });

      expect(await screen.findByText(/is closed/i)).toBeInTheDocument();
      expect(await screen.findByText(/waiting on your admin/i)).toBeInTheDocument();
      expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
    });

    it('while `mine` is loading on a past date, neither the roster nor the request form renders', async () => {
      searchParams = new URLSearchParams('classSectionId=sec-1');
      let resolveMyRequests!: (v: never[]) => void;
      const pending = new Promise<never[]>((resolve) => {
        resolveMyRequests = resolve;
      });
      const api = mockApi({
        get: mockGet([
          ['/manage/attendance/status', () => Promise.resolve([statusRow({ taken: false })])],
          ['/manage/attendance?', () => Promise.resolve([])],
          ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
          ['/manage/students?', () => Promise.resolve(students)],
          ['/manage/register-changes/mine', () => pending],
        ]),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Asha Rao');
      fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2020-01-01' } });

      // Neither the editable roster nor a submittable form is shown while we
      // don't yet know if an approved, unexpired unlock exists.
      expect(await screen.findByText(/checking for an existing request/i)).toBeInTheDocument();
      expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Reason for reopening')).not.toBeInTheDocument();

      resolveMyRequests([]);

      expect(await screen.findByLabelText('Reason for reopening')).toBeInTheDocument();
    });
  });

  it('cancelling the retake dialog closes it, keeps the roster locked, and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        [
          '/manage/attendance/status',
          () => Promise.resolve([statusRow({ taken: true, present: 1, total: 2, markedBy: 'Anita Rao' })]),
        ],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    const retakeBtn = await screen.findByRole('button', { name: /re-take attendance/i });
    await user.click(retakeBtn);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Taken by Anita Rao/)).toBeInTheDocument();
    // Roster is still not editable while the dialog is only open, not confirmed.
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('Asha Rao')).not.toBeInTheDocument();
    expect(retakeBtn).toHaveFocus();
  });

  it('confirming the retake dialog closes it and unlocks the roster for editing', async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams('classSectionId=sec-1');
    const api = mockApi({
      get: mockGet([
        [
          '/manage/attendance/status',
          () => Promise.resolve([statusRow({ taken: true, present: 1, total: 2, markedBy: 'Anita Rao' })]),
        ],
        ['/manage/attendance?', () => Promise.resolve([])],
        ['/manage/attendance/my-classes', () => Promise.resolve(classSections)],
        ['/manage/students?', () => Promise.resolve(students)],
        ['/manage/register-changes/mine', () => Promise.resolve([])],
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await user.click(await screen.findByRole('button', { name: /re-take attendance/i }));
    const dialog = await screen.findByRole('dialog');

    await user.click(within(dialog).getByRole('button', { name: /yes, re-take attendance/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Present' }).length).toBeGreaterThan(0);
    // RetakeDialog's own focus-restore targets a detached node once it and its
    // trigger both unmount in this render, so the page must move focus itself
    // — otherwise a keyboard/screen-reader user is left on document.body.
    expect(document.body).not.toHaveFocus();
    expect(screen.getByRole('heading', { name: 'Roster' })).toHaveFocus();
  });
});
