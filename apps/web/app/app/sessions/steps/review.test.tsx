import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import ReviewStep from './review';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * "Adding it up…" must mean it is adding it up.
 *
 * The step rendered that line for `isLoading || !data`, which also catches
 * every FAILURE: on a 404, a 500, a dropped connection or an expired session,
 * `data` is undefined and `isLoading` is false, so the screen sat there
 * claiming to be working while nothing was happening and nothing would. A
 * school reported it as "very very slow"; it was not slow, it was finished and
 * broken. Every other step in this wizard already showed its error.
 */
const PLAN = {
  id: 'p1', status: 'DRAFT', version: 2, fromYearId: 'y1', toYearId: 'y2',
  passMarkPct: 33, countExamIds: [], sectionMap: {}, rollPolicy: 'KEEP',
  copyTimetable: true, carryLeave: true, scheduledFor: null,
  fromYear: { id: 'y1', name: '2025-26', startDate: '2025-04-01', endDate: '2026-03-31', isCurrent: true },
  toYear: { id: 'y2', name: '2026-27', startDate: '2026-04-01', endDate: '2027-03-31', isCurrent: false },
} as never;

const REVIEW = {
  counts: { promote: 380, stay: 4, passOut: 42, leave: 1, newAdmissions: 0, unplaced: 0, undecided: 0 },
  alumniWithoutEmail: 0, libraryIssuesOut: 0, sectionsWithoutClassTeacher: [],
  version: 2, status: 'DRAFT', scheduledFor: null, copyTimetable: true,
  carryLeave: true, rollPolicy: 'KEEP',
  fromYear: { id: 'y1', name: '2025-26', endDate: '2026-03-31' },
  toYear: { id: 'y2', name: '2026-27', startDate: '2026-04-01' },
};

function stub(get: (path: string) => Promise<unknown>): ApiStub {
  return { get: vi.fn(get), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } as unknown as ApiStub;
}

const render = () =>
  renderWithProviders(<ReviewStep plan={PLAN} features={[]} onCancel={() => {}} onStarted={() => {}} />);

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
});

describe('the review step when the request fails', () => {
  it('says what went wrong instead of claiming to still be adding up', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub((p) =>
        p.startsWith('/manage/sessions/plan/review')
          ? Promise.reject(new ApiError(500, 'Transaction already closed', null))
          : Promise.resolve({}),
      ) as never,
    );
    render();

    expect(await screen.findByText(/Transaction already closed/)).toBeInTheDocument();
    expect(screen.queryByText(/Adding it up/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('a 404 — no open plan — is shown too, not swallowed', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub((p) =>
        p.startsWith('/manage/sessions/plan/review')
          ? Promise.reject(new ApiError(404, 'No open plan', null))
          : Promise.resolve({}),
      ) as never,
    );
    render();

    expect(await screen.findByText(/No open plan/)).toBeInTheDocument();
    expect(screen.queryByText(/Adding it up/)).not.toBeInTheDocument();
  });

  it('still adds up when the request succeeds', async () => {
    vi.mocked(useApi).mockReturnValue(
      stub((p) =>
        p.startsWith('/manage/sessions/plan/review')
          ? Promise.resolve(REVIEW)
          : Promise.resolve({ rows: [] }),
      ) as never,
    );
    render();

    // 380 promoted, rendered in Indian digit grouping.
    expect(await screen.findByText('380')).toBeInTheDocument();
    expect(screen.queryByText(/Adding it up/)).not.toBeInTheDocument();
  });
});
