import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import SessionsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const YEAR = { id: 'y1', name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31', isCurrent: true, sections: 12, students: 380 };
const PLAN = {
  id: 'p1', status: 'DRAFT', version: 2, fromYearId: 'y1', toYearId: 'y2', passMarkPct: 33, countExamIds: [], sectionMap: { f: 't' },
  rollPolicy: 'KEEP', copyTimetable: true, carryLeave: true, scheduledFor: null,
  fromYear: { id: 'y1', name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31', isCurrent: true },
  toYear: { id: 'y2', name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', isCurrent: false },
};

function mockApi(routes: Record<string, unknown>): ApiStub {
  const api: ApiStub = {
    get: vi.fn((url: string) => {
      const key = Object.keys(routes).find((k) => url === k || url.startsWith(`${k}?`));
      return key ? Promise.resolve(routes[key]) : Promise.reject(new Error(`unexpected GET ${url}`));
    }),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn().mockResolvedValue({}),
    patch: vi.fn().mockResolvedValue({}),
    del: vi.fn().mockResolvedValue({}),
  };
  vi.mocked(useApi).mockReturnValue(api as never);
  return api;
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.test.sckools.com');
});

describe('SessionsPage', () => {
  it('shows the current session and the Start a new session button when no plan is open', async () => {
    mockApi({ '/manage/sessions': { years: [YEAR], plan: null }, '/auth/me': { features: ['MANAGEMENT'] } });
    renderWithProviders(<SessionsPage />);
    expect(await screen.findByText('2025-26')).toBeInTheDocument();
    expect(screen.getByText('380 students in 12 classes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a new session' })).toBeEnabled();
  });

  it('Start a new session prefills the next name and dates from the closing year and opens the plan', async () => {
    const api = mockApi({ '/manage/sessions': { years: [YEAR], plan: null }, '/auth/me': { features: ['MANAGEMENT'] } });
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<SessionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Start a new session' }));
    expect(screen.getByDisplayValue('2026-27')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2026-04-01')).toBeInTheDocument();
    expect(screen.getByDisplayValue('2027-03-31')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open the plan' }));
    expect(api.post).toHaveBeenCalledWith('/manage/sessions/plan', { name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31' });
  });

  it('with an open plan, renders the stepper on the Decide step once classes are mapped', async () => {
    mockApi({
      '/manage/sessions': { years: [YEAR], plan: PLAN },
      '/auth/me': { features: ['MANAGEMENT'] },
      '/manage/classes': [],
    });
    renderWithProviders(<SessionsPage />);
    expect(await screen.findByRole('tab', { name: '3 Decide students', selected: true })).toBeInTheDocument();
    expect(screen.getByText('3 · Decide students')).toBeInTheDocument();
    expect(screen.getByText('2025-26 → 2026-27')).toBeInTheDocument();
  });

  it('a scheduled plan opens on Review and says when it starts', async () => {
    mockApi({
      '/manage/sessions': { years: [YEAR], plan: { ...PLAN, status: 'SCHEDULED', scheduledFor: '2026-03-31T18:30:00.000Z' } },
      '/auth/me': { features: ['MANAGEMENT', 'ALUMNI'] },
      '/manage/sessions/plan/review': {
        counts: { promote: 300, stay: 4, passOut: 60, leave: 2, newAdmissions: 14, unplaced: 0, undecided: 0 },
        alumniWithoutEmail: 3, libraryIssuesOut: 0, sectionsWithoutClassTeacher: [], version: 2, status: 'SCHEDULED',
        scheduledFor: '2026-03-31T18:30:00.000Z', copyTimetable: true, carryLeave: true, rollPolicy: 'KEEP',
        fromYear: { id: 'y1', name: '2025-26', endDate: '2026-03-31' }, toYear: { id: 'y2', name: '2026-27', startDate: '2026-04-01' },
      },
    });
    renderWithProviders(<SessionsPage />);
    expect(await screen.findByRole('tab', { name: '6 Review & start', selected: true })).toBeInTheDocument();
    expect(await screen.findByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText(/3 of the 60 passing out have no email/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start 2026-27/ })).toBeNull();
  });
});

describe('Review: the library and the master button', () => {
  const REVIEW = {
    counts: { promote: 10, stay: 0, passOut: 0, leave: 0, newAdmissions: 0, unplaced: 0, undecided: 4 },
    alumniWithoutEmail: 0, libraryIssuesOut: 3, sectionsWithoutClassTeacher: [], version: 2, status: 'DRAFT',
    scheduledFor: null, copyTimetable: true, carryLeave: true, rollPolicy: 'KEEP',
    fromYear: { id: 'y1', name: '2025-26', endDate: '2026-03-31' }, toYear: { id: 'y2', name: '2026-27', startDate: '2026-04-01' },
  };
  const LOANS = {
    today: '2026-03-25', sessionEndOn: '2026-03-31',
    rules: { finePerDayRupees: 2, graceDays: 3, fineStudents: true },
    counts: { out: 3, overdue: 1, dueAfterSession: 2, noLogin: 1, accruingRupees: 24 },
    rows: [
      { issueId: 'i1', studentId: 's1', name: 'Aarav Mehta', code: 'RAF-1', className: '5 B', hasLogin: true, title: 'Matilda', accessionNo: 'B-1', issuedOn: '2026-03-01', dueOn: '2026-03-10', daysLate: 15, fineRupees: 24, dueAfterSession: false },
      { issueId: 'i2', studentId: 's2', name: 'Dev Sharma', code: null, className: '6 A', hasLogin: false, title: 'Wonder', accessionNo: 'B-2', issuedOn: '2026-03-20', dueOn: '2026-04-05', daysLate: 0, fineRupees: 0, dueAfterSession: true },
    ],
  };
  function mountReview() {
    const api = mockApi({
      '/manage/sessions': { years: [YEAR], plan: { ...PLAN, status: 'SCHEDULED' } },
      '/auth/me': { features: ['MANAGEMENT'] },
      '/manage/sessions/plan/review': { ...REVIEW, status: 'SCHEDULED', scheduledFor: '2026-03-31T18:30:00.000Z' },
      '/manage/sessions/plan/library': LOANS,
    });
    api.post = vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/library/remind') ? { reminded: 2, noLogin: 1 }
        : url.endsWith('/library/last-due') ? { changed: 2, lastDueOn: '2026-03-31' }
        : url.endsWith('/decisions/defaults') ? { decided: 4, alreadyDecided: 10, unmapped: [], version: 3 }
        : {},
      ),
    );
    vi.mocked(useApi).mockReturnValue(api as never);
    return api;
  }

  it('shows what is out with the fine so far, reminds every family, and brings the after-session due dates forward to one day', async () => {
    const api = mountReview();
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<SessionsPage />);
    expect(await screen.findByText('3 library books are still out')).toBeInTheDocument();
    expect(screen.getByText(/₹24 in fines so far/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'See the list' }));
    expect(screen.getByText('Matilda')).toBeInTheDocument();
    expect(screen.getByText('No login')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remind all families' }));
    expect(api.post).toHaveBeenCalledWith('/manage/sessions/plan/library/remind', {});
    expect(screen.getByLabelText('Last due date for books due after the session')).toHaveValue('2026-03-31');
    await user.click(screen.getByRole('button', { name: 'Set for 2 books' }));
    expect(api.post).toHaveBeenCalledWith('/manage/sessions/plan/library/last-due', { lastDueOn: '2026-03-31' });
  });

  it('offers to promote the undecided by the class map from the review warning', async () => {
    const api = mountReview();
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<SessionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Promote the 4 undecided by the class map' }));
    expect(api.post).toHaveBeenCalledWith('/manage/sessions/plan/decisions/defaults', {});
  });
});

describe('Decide: the master button', () => {
  it('promotes everyone not yet decided, in one click, after a confirmation', async () => {
    const api = mockApi({
      '/manage/sessions': { years: [YEAR], plan: PLAN },
      '/auth/me': { features: ['MANAGEMENT'] },
      '/manage/classes': [{ id: 'f5b', name: 'B', grade: { name: '5' } }],
      '/manage/sessions/plan/students': { section: { id: 'f5b', label: '5 B', gradeId: 'g5' }, targets: [], exams: [], rows: [] },
    });
    api.post = vi.fn().mockResolvedValue({ decided: 40, alreadyDecided: 0, unmapped: ['7 C'], version: 3 });
    vi.mocked(useApi).mockReturnValue(api as never);
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderWithProviders(<SessionsPage />);
    await user.click(await screen.findByRole('button', { name: 'Promote everyone not yet decided' }));
    expect(api.post).toHaveBeenCalledWith('/manage/sessions/plan/decisions/defaults', {});
  });
});
