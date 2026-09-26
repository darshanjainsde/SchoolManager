import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ClassTeacherDesk } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import ClassTeachersPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const DESK: ClassTeacherDesk = {
  academicYear: { id: 'y1', name: '2026-27' },
  rows: [
    { classSectionId: 's1', label: 'Nursery A', gradeName: 'Nursery', sectionName: 'A', gradeOrder: 0, students: 28, teacher: null, alsoHolds: [] },
    { classSectionId: 's2', label: 'LKG A', gradeName: 'LKG', sectionName: 'A', gradeOrder: 1, students: 30, teacher: { id: 't1', name: 'Priya Nair' }, alsoHolds: ['LKG B'] },
    { classSectionId: 's3', label: 'LKG B', gradeName: 'LKG', sectionName: 'B', gradeOrder: 1, students: 29, teacher: { id: 't1', name: 'Priya Nair' }, alsoHolds: ['LKG A'] },
  ],
  teachers: [
    { id: 't1', name: 'Priya Nair', sections: ['LKG A', 'LKG B'] },
    { id: 't2', name: 'Mohammed Irfan Qureshi', sections: [] },
  ],
  counts: { sections: 3, assigned: 2, unassigned: 1, holdingMoreThanOne: 1 },
  previousYear: { id: 'y0', name: '2025-26', assigned: 3 },
};

function api(over: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(async () => DESK), post: vi.fn(async () => ({ copied: 2, skippedLeft: 1, skippedNoMatch: 0 })), put: vi.fn(async () => DESK.rows[0]), patch: vi.fn(), del: vi.fn(), ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api());
});

describe('the class-teacher desk', () => {
  it('counts what is assigned and what is not, with nobody-yet in red', async () => {
    renderWithProviders(<ClassTeachersPage />);
    const tile = (await screen.findByText('Nobody yet', { selector: '.lab' })).closest('.sk-kpi')!;
    expect(tile).toHaveAttribute('data-tone', 'bad');
    expect(tile).toHaveTextContent('1');
    expect(screen.getByText('Holding two or more', { selector: '.lab' }).closest('.sk-kpi')).toHaveTextContent('allowed — shown on the row');
  });

  it('says out loud when a teacher holds another class, instead of refusing it', async () => {
    renderWithProviders(<ClassTeachersPage />);
    await screen.findByLabelText('Class teacher for Nursery A');
    const lkgA = screen.getByLabelText('Class teacher for LKG A');
    expect(lkgA).toHaveValue('t1');
    expect(within(lkgA.closest('.sk-rowcell')!).getByText(/also holds LKG B/)).toBeInTheDocument();
  });

  it('an unassigned class reads as unassigned — in the picker and on the row', async () => {
    renderWithProviders(<ClassTeachersPage />);
    await screen.findByLabelText('Class teacher for Nursery A');
    const nursery = screen.getByLabelText('Class teacher for Nursery A');
    expect(nursery).toHaveValue('');
    expect(nursery).toHaveAttribute('data-empty');
  });

  it('assigning sends just the section and the teacher', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api();
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<ClassTeachersPage />);
    await screen.findByLabelText('Class teacher for Nursery A');
    await user.selectOptions(screen.getByLabelText('Class teacher for Nursery A'), 't2');
    await waitFor(() => expect(stub.put).toHaveBeenCalledWith('/manage/class-teachers/s1', { teacherId: 't2' }));
  });

  it('clearing one sends null, not an empty string', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api();
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<ClassTeachersPage />);
    await screen.findByLabelText('Class teacher for Nursery A');
    await user.selectOptions(screen.getByLabelText('Class teacher for LKG A'), '');
    await waitFor(() => expect(stub.put).toHaveBeenCalledWith('/manage/class-teachers/s2', { teacherId: null }));
  });

  it('offers to carry last session forward, and names the session', async () => {
    const user = userEvent.setup({ delay: null });
    const stub = api();
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(stub);
    renderWithProviders(<ClassTeachersPage />);
    await user.click(await screen.findByRole('button', { name: /Copy from 2025-26/ }));
    await waitFor(() => expect(stub.post).toHaveBeenCalledWith('/manage/class-teachers/copy', { fromYearId: 'y0' }));
  });

  it('the Nobody-yet filter shows only the classes with nobody', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<ClassTeachersPage />);
    await user.click(await screen.findByRole('button', { name: /Nobody yet · 1/ }));
    expect(screen.getByLabelText('Class teacher for Nursery A')).toBeInTheDocument();
    expect(screen.queryByLabelText('Class teacher for LKG A')).toBeNull();
  });

  it('says what to do when the school has no current session, instead of an empty table', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api({
      get: vi.fn(async () => ({ ...DESK, academicYear: null, rows: [], counts: { sections: 0, assigned: 0, unassigned: 0, holdingMoreThanOne: 0 } })),
    }));
    renderWithProviders(<ClassTeachersPage />);
    expect(await screen.findByText(/No session is current yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sessions' })).toHaveAttribute('href', '/app/sessions');
  });
});
