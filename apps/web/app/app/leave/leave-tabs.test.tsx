import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import AdminLeavePage from './page';

/**
 * COVERAGE IS A TAB, NOT THE BOTTOM OF THE PAGE.
 *
 * The owner's words, 2026-10-02: "jab leaves jada hote h to coverage section
 * at last me chala jaata h". Coverage sat under BOTH leave lists, so a school
 * in exam week — thirty approved leaves — had to scroll past all of them to
 * reach the one screen that says which classes have nobody in front of them.
 * The thing you came to do was the furthest thing from the top.
 *
 * Tabs put the three at the same height, and the uncovered count rides the
 * Coverage tab so it is legible without opening it.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const leave = (id: string, name: string, status: 'PENDING' | 'APPROVED') => ({
  id, teacherId: `t-${id}`, teacherName: name, type: 'SICK' as const,
  startDate: '2026-10-05', endDate: '2026-10-06', reason: null, status,
  createdAt: '2026-10-01T00:00:00.000Z',
});

/** A week a real school would recognise: many leaves, a few classes uncovered. */
const PENDING = Array.from({ length: 12 }, (_, i) => leave(`p${i}`, `Pending Teacher ${i}`, 'PENDING'));
const APPROVED = Array.from({ length: 18 }, (_, i) => leave(`a${i}`, `Approved Teacher ${i}`, 'APPROVED'));
/** The shape is the page's own CoverageGap — read, not remembered. */
interface CoverageGapFixture {
  id: string; date: string; classSectionId: string; classSectionName: string;
  periodId: string; periodLabel: string; originalTeacherName: string;
  substituteTeacherId: string | null; substituteTeacherName: string | null;
}
const GAPS: CoverageGapFixture[] = [
  { id: 'g1', date: '2026-10-05', classSectionId: 'c1', classSectionName: 'VII-B', periodId: 'per1',
    periodLabel: 'Period I', originalTeacherName: 'Approved Teacher 0', substituteTeacherId: null, substituteTeacherName: null },
  { id: 'g2', date: '2026-10-05', classSectionId: 'c2', classSectionName: 'VIII-A', periodId: 'per2',
    periodLabel: 'Period II', originalTeacherName: 'Approved Teacher 1', substituteTeacherId: 't9', substituteTeacherName: 'Cover Teacher' },
  { id: 'g3', date: '2026-10-06', classSectionId: 'c3', classSectionName: 'IX-C', periodId: 'per1',
    periodLabel: 'Period I', originalTeacherName: 'Approved Teacher 2', substituteTeacherId: null, substituteTeacherName: null },
];

function mockApi(): ApiStub {
  const get = vi.fn((path: string) => {
    if (path.includes('status=PENDING')) return Promise.resolve(PENDING);
    if (path.includes('status=APPROVED')) return Promise.resolve(APPROVED);
    if (path.startsWith('/manage/leave/coverage')) return Promise.resolve(GAPS);
    if (path.startsWith('/manage/availability')) return Promise.resolve({ teachers: [], busy: [], periods: [] });
    if (path.startsWith('/manage/leave-policy/pending-context')) return Promise.resolve({});
    return Promise.resolve([]);
  });
  return { get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi());
});

describe('the Leave desk', () => {
  it('offers Coverage as a tab beside the leave lists', async () => {
    renderWithProviders(<AdminLeavePage />);
    const tabs = await screen.findByRole('tablist', { name: /leave desk/i });
    const names = Array.from(tabs.querySelectorAll('[role="tab"]')).map((t) => t.textContent ?? '');
    expect(names.some((n) => /pending/i.test(n))).toBe(true);
    expect(names.some((n) => /approved/i.test(n))).toBe(true);
    expect(names.some((n) => /coverage/i.test(n))).toBe(true);
  });

  it('says how many classes have nobody, on the tab itself', async () => {
    renderWithProviders(<AdminLeavePage />);
    const tab = await screen.findByRole('tab', { name: /coverage/i });
    // Two of the three gaps have no substitute.
    await waitFor(() => expect(tab.textContent).toMatch(/2/));
  });

  it('shows one tab at a time, so thirty leaves cannot bury the gaps', async () => {
    renderWithProviders(<AdminLeavePage />);
    // Pending opens first: that is the decision waiting on the admin.
    expect(await screen.findByText('Pending Teacher 0')).toBeTruthy();
    expect(screen.queryByText('Approved Teacher 0')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /coverage/i }));
    await waitFor(() => expect(screen.getByText(/VII-B/)).toBeTruthy());
    // The lists are out of the way while the gaps are on screen.
    expect(screen.queryByText('Pending Teacher 0')).toBeNull();
    expect(screen.queryByText('Approved Teacher 0')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: /approved/i }));
    await waitFor(() => expect(screen.getByText('Approved Teacher 0')).toBeTruthy());
    expect(screen.queryByText(/VII-B/)).toBeNull();
  });

  it('counts each list on its own tab, so the shape of the week reads at a glance', async () => {
    renderWithProviders(<AdminLeavePage />);
    const pendingTab = await screen.findByRole('tab', { name: /pending/i });
    await waitFor(() => expect(pendingTab.textContent).toMatch(/12/));
    expect(screen.getByRole('tab', { name: /approved/i }).textContent).toMatch(/18/);
  });
});
