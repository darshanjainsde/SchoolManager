import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PeriodDialog, type SubjectTeacherPreview, type PreviewRow } from './PeriodDialog';

const row = (over: Partial<PreviewRow>): PreviewRow => ({
  dayOfWeek: 1, periodId: 'p1', periodLabel: 'I', periodOrder: 1, clicked: false,
  current: { subjectId: 'eng', teacherId: 'krishna', teacherName: 'Krishna Shah' }, clash: null, warnings: [], ...over,
});
const plan = (rows: PreviewRow[], over: Partial<SubjectTeacherPreview> = {}): SubjectTeacherPreview => ({
  teacher: { id: 'rishika', name: 'Rishika Agarwal', active: true }, subject: { id: 'eng', name: 'English' },
  from: '2026-10-07', until: null, rows, alreadyTheirs: 0, load: { now: 18 }, ...over,
});
/** Clicked Thu IV (empty), plus Krishna's English on Mon I, Tue I (clash with VII-A) and Wed II. */
const SWAP = plan([
  row({ dayOfWeek: 4, periodId: 'p4', periodLabel: 'IV', clicked: true, current: null }),
  row({ dayOfWeek: 1, periodId: 'p1', periodLabel: 'I' }),
  row({ dayOfWeek: 2, periodId: 'p1', periodLabel: 'I', clash: { classLabel: 'VII-A', from: null } }),
  row({ dayOfWeek: 3, periodId: 'p2', periodLabel: 'II', warnings: ['On leave Wed 14 Oct — this period will need cover.'] }),
]);

const base = {
  mode: 'assign' as const, dayLabel: 'Thu Oct 8', dayOfWeek: 4, periodId: 'p4', periodLabel: 'IV', classLabel: 'V-B',
  weekLabel: 'Oct 5–11, 2026', fromLabel: 'today', nextWeekLabel: 'Mon Oct 12',
  subjects: [{ id: 'eng', label: 'English (ENG)' }, { id: 'hin', label: 'Hindi (HIN)' }],
  teachers: [{ id: 'krishna', label: 'Krishna Shah' }, { id: 'rishika', label: 'Rishika Agarwal' }],
  isSaving: false, onClose: vi.fn(),
};

async function chooseRishika(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText('Teacher'), 'rishika');
}

describe('the period drawer', () => {
  it('picks no teacher for you: Save waits until one is chosen', () => {
    render(<PeriodDialog {...base} preview={vi.fn()} onSave={vi.fn()} />);
    expect(screen.getByLabelText('Teacher')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('lists every other English period of the class with who has it now; a clash is named and cannot be ticked', async () => {
    const user = userEvent.setup({ delay: null });
    render(<PeriodDialog {...base} preview={vi.fn().mockResolvedValue(SWAP)} onSave={vi.fn()} />);
    await chooseRishika(user);
    const box = await screen.findByRole('checkbox', { name: /Also give Rishika Agarwal the other 3 English periods of V-B/ });
    expect(box).not.toBeChecked();
    expect(screen.getByText('2 free · 1 busy with another class')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Tue I, now Krishna Shah' })).toBeDisabled();
    expect(screen.getByText(/Rishika Agarwal teaches VII-A then — stays as it is/)).toBeInTheDocument();
    expect(screen.getByText('On leave Wed 14 Oct — this period will need cover.')).toBeInTheDocument();
  });

  it('unticked: only the clicked period is saved, from now on', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<PeriodDialog {...base} preview={vi.fn().mockResolvedValue(SWAP)} onSave={onSave} />);
    await chooseRishika(user);
    await screen.findByText(/periods a week/);
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'eng', teacherId: 'rishika', keep: true, cells: [{ dayOfWeek: 4, periodId: 'p4' }] }));
  });

  it('ticked: the clicked period and every free one in one save, the clash left as it is and said so', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<PeriodDialog {...base} preview={vi.fn().mockResolvedValue(SWAP)} onSave={onSave} />);
    await chooseRishika(user);
    await user.click(await screen.findByRole('checkbox', { name: /Also give/ }));
    expect(screen.getByText(/Rishika Agarwal: 18 periods a week →/)).toHaveTextContent('→ 21');
    await user.click(screen.getByRole('button', { name: 'Save 3 periods' }));
    const s = onSave.mock.calls[0][0];
    expect(s.cells).toEqual([{ dayOfWeek: 4, periodId: 'p4' }, { dayOfWeek: 1, periodId: 'p1' }, { dayOfWeek: 3, periodId: 'p2' }]);
    expect(s.leftAsIs).toEqual([{ label: 'Tue I', reason: 'Rishika Agarwal teaches VII-A then' }]);
  });

  it('a free period can be unticked and is then left out', async () => {
    const user = userEvent.setup({ delay: null });
    const onSave = vi.fn();
    render(<PeriodDialog {...base} preview={vi.fn().mockResolvedValue(SWAP)} onSave={onSave} />);
    await chooseRishika(user);
    await user.click(await screen.findByRole('checkbox', { name: /Also give/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Wed II, now Krishna Shah' }));
    await user.click(screen.getByRole('button', { name: 'Save 2 periods' }));
    expect(onSave.mock.calls[0][0].cells).toEqual([{ dayOfWeek: 4, periodId: 'p4' }, { dayOfWeek: 1, periodId: 'p1' }]);
  });

  it('when the clicked period itself clashes, it says where she is and Save is blocked', async () => {
    const user = userEvent.setup({ delay: null });
    const clashed = plan([row({ dayOfWeek: 4, periodId: 'p4', periodLabel: 'IV', clicked: true, current: null, clash: { classLabel: 'VI-C', from: 'Mon 2 Nov 2026' } })]);
    render(<PeriodDialog {...base} preview={vi.fn().mockResolvedValue(clashed)} onSave={vi.fn()} />);
    await chooseRishika(user);
    expect(await screen.findByText(/Rishika Agarwal teaches VI-C in this period from Mon 2 Nov 2026/)).toBeInTheDocument();
    expect(screen.getByLabelText('Teacher')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('"Keep this change for the coming weeks" is on by default; off, it asks again for this week only and says when it goes back', async () => {
    const user = userEvent.setup({ delay: null });
    const preview = vi.fn().mockResolvedValue(SWAP);
    const onSave = vi.fn();
    render(<PeriodDialog {...base} preview={preview} onSave={onSave} />);
    const keep = screen.getByRole('checkbox', { name: /Keep this change for the coming weeks/ });
    expect(keep).toBeChecked();
    expect(screen.getByText('From today on. Earlier weeks keep the teacher they had.')).toBeInTheDocument();
    await chooseRishika(user);
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ subjectId: 'eng', teacherId: 'rishika', keep: true }));
    await user.click(keep);
    expect(screen.getByText('Only the week of Oct 5–11, 2026, from today. From Mon Oct 12 it goes back to how it was.')).toBeInTheDocument();
    await waitFor(() => expect(preview).toHaveBeenLastCalledWith({ subjectId: 'eng', teacherId: 'rishika', keep: false }));
    await screen.findByText(/periods a week/);
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(onSave.mock.calls[0][0].keep).toBe(false);
  });

  it('change mode opens on the period’s own subject and teacher, and says who has it now', async () => {
    const user = userEvent.setup({ delay: null });
    render(<PeriodDialog {...base} mode="change" initial={{ subjectId: 'eng', teacherId: 'krishna', teacherName: 'Krishna Shah' }} preview={vi.fn().mockResolvedValue(plan([]))} onSave={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Change period — Thu Oct 8, IV');
    expect(screen.getByLabelText('Subject')).toHaveValue('eng');
    expect(screen.getByLabelText('Teacher')).toHaveValue('krishna');
    expect(await screen.findByText('This is what the period already has.')).toBeInTheDocument();
    await chooseRishika(user);
    expect(screen.getByText('Now Krishna Shah.')).toBeInTheDocument();
  });

  it('a preview that fails says why, and nothing can be saved', async () => {
    const user = userEvent.setup({ delay: null });
    render(<PeriodDialog {...base} preview={vi.fn().mockRejectedValue(new Error('Rishika Agarwal has left the school and cannot be given periods.'))} onSave={vi.fn()} />);
    await chooseRishika(user);
    expect(await screen.findByText('Rishika Agarwal has left the school and cannot be given periods.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assign' })).toBeDisabled();
  });

  it('the subject’s periods already with her are counted, not listed', async () => {
    const user = userEvent.setup({ delay: null });
    render(<PeriodDialog {...base} preview={vi.fn().mockResolvedValue(plan([row({ dayOfWeek: 4, periodId: 'p4', periodLabel: 'IV', clicked: true, current: null })], { alreadyTheirs: 2 }))} onSave={vi.fn()} />);
    await chooseRishika(user);
    expect(await screen.findByText('2 other English periods are already with Rishika Agarwal.')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Also give/ })).not.toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Assign' })).toBeEnabled();
  });

  it('change mode offers "Remove period" — the way to remove on a phone, where the hover cross is not', async () => {
    const user = userEvent.setup({ delay: null });
    const onRemove = vi.fn();
    const { rerender } = render(<PeriodDialog {...base} mode="change" initial={{ subjectId: 'eng', teacherId: 'krishna', teacherName: 'Krishna Shah' }} preview={vi.fn().mockResolvedValue(plan([]))} onSave={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByRole('button', { name: 'Remove period' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    rerender(<PeriodDialog {...base} preview={vi.fn().mockResolvedValue(plan([]))} onSave={vi.fn()} onRemove={onRemove} />);
    expect(screen.queryByRole('button', { name: 'Remove period' })).not.toBeInTheDocument();
  });
});
