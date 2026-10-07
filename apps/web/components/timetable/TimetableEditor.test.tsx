import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { TimetableEditor } from './TimetableEditor';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * The editor's wiring for "change a period / give the subject to someone".
 * Today is pinned to Wed 7 Oct 2026 so "this week" is Mon 5 – Sun 11 Oct.
 */
const CLASSES = [{ id: 'vb', name: 'B', academicYearId: 'y1', grade: { name: 'V' } }];
const PERIODS = [{ id: 'p1', label: 'I', order: 1, startTime: '08:00', endTime: '08:45', kind: 'CLASS' }];
const SLOT = {
  id: 's1', classSectionId: 'vb', dayOfWeek: 1, periodId: 'p1', subjectId: 'eng', teacherId: 'krishna', academicYearId: 'y1',
  period: { order: 1, label: 'I', startTime: '08:00', endTime: '08:45' }, subject: { name: 'English', code: 'ENG' }, teacher: { firstName: 'Krishna', lastName: 'Shah' },
};
const PREVIEW = {
  teacher: { id: 'rishika', name: 'Rishika Agarwal', active: true }, subject: { id: 'eng', name: 'English' }, from: '2026-10-07', until: null,
  rows: [{ dayOfWeek: 1, periodId: 'p1', periodLabel: 'I', periodOrder: 1, clicked: true, current: { subjectId: 'eng', teacherId: 'krishna', teacherName: 'Krishna Shah' }, clash: null, warnings: [] }],
  alreadyTheirs: 0, load: { now: 18 },
};

let api: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; del: ReturnType<typeof vi.fn> };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TimetableEditor classes={CLASSES} classSectionId="vb" onClassSectionChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 10, 0));
  api = {
    get: vi.fn(async (p: string) => {
      if (p.startsWith('/manage/periods')) return PERIODS;
      if (p.startsWith('/manage/school/working-days')) return { workingDays: [1, 2, 3, 4, 5, 6] };
      if (p.startsWith('/manage/subjects')) return [{ id: 'eng', name: 'English', code: 'ENG' }];
      if (p.startsWith('/manage/teachers')) return [
        { id: 'krishna', firstName: 'Krishna', lastName: 'Shah', isActive: true },
        { id: 'rishika', firstName: 'Rishika', lastName: 'Agarwal', isActive: true },
        { id: 'gone', firstName: 'Former', lastName: 'Teacher', isActive: false },
      ];
      if (p.startsWith('/manage/timetable')) return [SLOT];
      return [];
    }),
    post: vi.fn(async (p: string) => (p.endsWith('/preview') ? PREVIEW : { changed: 1, skipped: [] })),
    del: vi.fn(async () => ({ ok: true })),
  };
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
  vi.mocked(useApi).mockReturnValue(api as never);
});
afterEach(() => vi.useRealTimers());

describe('the timetable editor: changing a period', () => {
  it('a filled period opens "Change period" with its own subject and teacher — no remove-then-assign', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole('button', { name: /^Change English with Krishna Shah, Mon I/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Change period — Mon Oct 5, I');
    expect(screen.getByLabelText('Teacher')).toHaveValue('krishna');
  });

  it('never offers a teacher who has left', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole('button', { name: /^Change English/ }));
    const options = [...(screen.getByLabelText('Teacher') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toContain('Rishika Agarwal');
    expect(options).not.toContain('Former Teacher');
  });

  it('saves from today on the current week, through one call carrying the cells and no end date', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole('button', { name: /^Change English/ }));
    await user.selectOptions(screen.getByLabelText('Teacher'), 'rishika');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/timetable/subject-teacher/preview', expect.objectContaining({ from: '2026-10-07', cell: { dayOfWeek: 1, periodId: 'p1' } })));
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('until');
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/timetable/subject-teacher', {
      classSectionId: 'vb', academicYearId: 'y1', subjectId: 'eng', teacherId: 'rishika', from: '2026-10-07', cells: [{ dayOfWeek: 1, periodId: 'p1' }],
    }));
  });

  it('"this week only" sends the next Monday as the end', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole('button', { name: /^Change English/ }));
    await user.selectOptions(screen.getByLabelText('Teacher'), 'rishika');
    await user.click(screen.getByRole('checkbox', { name: /Keep this change for the coming weeks/ }));
    // Save is held while the drawer re-checks for the shorter window.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/timetable/subject-teacher', expect.objectContaining({ from: '2026-10-07', until: '2026-10-12' })));
  });

  it('on a future week the change starts that Monday — the current week is not touched', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Next week' }));
    await user.click(await screen.findByRole('button', { name: /^Change English/ }));
    await user.selectOptions(screen.getByLabelText('Teacher'), 'rishika');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/timetable/subject-teacher/preview', expect.objectContaining({ from: '2026-10-12' })));
  });

  it('a past week is read-only: its periods are not buttons', async () => {
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Previous week' }));
    expect(await screen.findByText('Krishna Shah')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change English/ })).not.toBeInTheDocument();
  });

  it('removing a period on a future week removes it from that week on', async () => {
    const user = userEvent.setup({ delay: null });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mount();
    await user.click(await screen.findByRole('button', { name: 'Next week' }));
    await user.click(await screen.findByRole('button', { name: /^Remove English from Mon I/ }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringMatching(/from Mon Oct 12 on\? Earlier weeks keep it\./));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/manage/timetable/s1?from=2026-10-12'));
  });
});
