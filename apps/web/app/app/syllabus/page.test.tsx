import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import { OVERVIEW, TRACK } from '@/test/fixtures/syllabus';
import Page from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app/syllabus', useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const mockApi = (get: (p: string) => Promise<unknown>) => ({ get: vi.fn(get), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() });

describe('admin syllabus overview', () => {
  beforeEach(() => { vi.mocked(useHost).mockReturnValue('raffles.sckools.com'); });

  it('lists every track worst first, with the teacher, where the class is, and the verdict', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async (p) => (p === '/manage/syllabus/overview' ? OVERVIEW : TRACK)) as never);
    renderWithProviders(<Page />);
    const rows = await screen.findAllByTestId(/^syl-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual(['syl-row-cs-9b-s-mat', 'syl-row-cs-9a-s-mat', 'syl-row-cs-9a-s-sci', 'syl-row-cs-10a-s-mat']);
    expect(within(rows[0]!).getByText('Mohammed Irfan Qureshi')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Number systems')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Behind')).toBeInTheDocument();
    expect(within(rows[3]!).getByText('No teacher on the timetable')).toBeInTheDocument();
    // The hero counts what is behind, and "needs attention" names the two laggards with the gap in points.
    expect(screen.getByText('2 of 3 tracks are behind')).toBeInTheDocument();
    expect(screen.getByTestId('syl-att-cs-9b-s-mat')).toHaveTextContent('38 pts behind');
    expect(screen.getByTestId('syl-att-cs-9a-s-mat')).toHaveTextContent('13 pts behind');
    expect(screen.queryByTestId('syl-att-cs-9a-s-sci')).toBeNull();
  });

  it('class narrows section; section, subject, teacher and status narrow the table', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async () => OVERVIEW) as never);
    renderWithProviders(<Page />);
    await screen.findAllByTestId(/^syl-row-/);
    fireEvent.change(screen.getByTestId('syl-f-grade'), { target: { value: 'g9' } });
    const sectionOptions = within(screen.getByTestId('syl-f-section')).getAllByRole('option').map((o) => o.textContent);
    expect(sectionOptions).toEqual(['Every section', 'Class 9-A', 'Class 9-B']);
    expect(screen.getAllByTestId(/^syl-row-/)).toHaveLength(3);
    fireEvent.change(screen.getByTestId('syl-f-teacher'), { target: { value: 't2' } });
    expect(screen.getAllByTestId(/^syl-row-/).map((r) => r.getAttribute('data-testid'))).toEqual(['syl-row-cs-9b-s-mat', 'syl-row-cs-9a-s-sci']);
    fireEvent.change(screen.getByTestId('syl-f-pace'), { target: { value: 'ok' } });
    expect(screen.getAllByTestId(/^syl-row-/).map((r) => r.getAttribute('data-testid'))).toEqual(['syl-row-cs-9a-s-sci']);
    fireEvent.change(screen.getByTestId('syl-f-subject'), { target: { value: 's-mat' } });
    expect(screen.getByTestId('syl-empty')).toHaveTextContent('Nothing matches these filters.');
  });

  it('a row opens the track in a drawer, read-only, with a door to the chapter list', async () => {
    const api = mockApi(async (p) => (p === '/manage/syllabus/overview' ? OVERVIEW : TRACK));
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    fireEvent.click(await screen.findByTestId('syl-row-cs-9a-s-mat'));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/manage/syllabus/tracks/cs-9a/s-mat'));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Polynomials', { exact: false })).toBeInTheDocument();
    expect(within(dialog).getByText('Revise Q4 before the test')).toBeInTheDocument();
    // Read-only: no status buttons for the admin.
    expect(within(dialog).queryByTestId('syl-status-c1-DONE')).toBeNull();
    expect(within(dialog).getByRole('link', { name: 'Edit the chapter list' })).toHaveAttribute('href', '/app/syllabus/chapters?gradeId=g9&subjectId=s-mat');
  });

  it('says so when there is no current session, and when the feature is off', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi(async () => ({ ...OVERVIEW, year: null, tracks: [], sections: [] })) as never);
    const { unmount } = renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-no-year')).toBeInTheDocument();
    unmount();
    vi.mocked(useApi).mockReturnValue(mockApi(async () => { throw new ApiError(403, 'Feature COURSE_MANAGEMENT not enabled', {}); }) as never);
    renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-not-in-plan')).toBeInTheDocument();
  });
});
