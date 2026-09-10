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
