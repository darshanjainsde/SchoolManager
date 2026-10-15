import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import AdminLeavePage from './page';

/**
 * COVER A LEAVE WITH ONE TEACHER, from the console.
 *
 * After the first pick on a leave the desk is asked once whether to give the
 * same teacher the rest; the drawer lists every open period with the
 * teacher's standing in each, and only the ticked FREE ones are sent. The
 * server's preview and batch answers are stubbed with the shapes
 * LeaveService returns (leave-cover-batch.e2e-spec.ts proves those).
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const LEAVE = 'leave-priya';
const gap = (id: string, date: string, cls: string, period: string, extra: Record<string, unknown> = {}) => ({
  id, date, classSectionId: `c-${cls}`, classSectionName: cls, periodId: `p-${period}`, periodLabel: period, originalTeacherName: 'Priya Nair',
  substituteTeacherId: null, substituteTeacherName: null, acknowledgedAt: null, leaveApplicationId: LEAVE, ...extra,
});
const GAPS = [
  gap('g1', '2030-01-07', '9-A', 'Period 1'),
  gap('g2', '2030-01-07', '9-B', 'Period 2'),
  gap('g3', '2030-01-08', '9-A', 'Period 1', { substituteTeacherId: 't-anita', substituteTeacherName: 'Anita Rao' }),
  gap('g4', '2030-01-08', '9-C', 'Period 3'),
  gap('g5', '2030-01-09', '9-A', 'Period 1'),
  // A gap made by hand, not by a leave: its own group, no offer, no fit.
  gap('h1', '2030-01-07', '6-D', 'Period 4', { originalTeacherName: 'Mohan Das', leaveApplicationId: null }),
];

const row = (gapId: string, date: string, className: string, periodLabel: string, state: string, reason: string | null = null) => ({ gapId, date, periodLabel, time: '09:00–09:45', className, state, reason });
const PREVIEW = {
  leave: { id: LEAVE, teacherName: 'Priya Nair', dates: 'Mon 7 – Wed 9 Jan 2030' },
  teacher: { id: 't-rahul', name: 'Rahul Verma' },
  busyDayAt: 4,
  days: [
    { date: '2030-01-07', label: 'Mon 7 Jan', coversBefore: 2 },
    { date: '2030-01-08', label: 'Tue 8 Jan', coversBefore: 0 },
    { date: '2030-01-09', label: 'Wed 9 Jan', coversBefore: 0 },
  ],
  rows: [
    row('g1', '2030-01-07', '9-A', 'Period 1', 'THEIRS', 'Already Rahul Verma\'s.'),
    row('g2', '2030-01-07', '9-B', 'Period 2', 'FREE'),
    row('g3', '2030-01-08', '9-A', 'Period 1', 'TAKEN', 'Anita Rao already covers it.'),
    row('g4', '2030-01-08', '9-C', 'Period 3', 'TEACHING', 'Rahul Verma teaches 10-B then.'),
    row('g5', '2030-01-09', '9-A', 'Period 1', 'FREE'),
    row('g6', '2030-01-09', '9-B', 'Period 2', 'FREE'),
  ],
};
const FIT = { open: 4, teachers: [{ id: 't-rahul', name: 'Rahul Verma', free: 3 }, { id: 't-lata', name: 'Lata Iyer', free: 1 }] };

let api: ApiStub;
let preview: () => Promise<unknown>;
let batch: () => Promise<unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  preview = () => Promise.resolve(PREVIEW);
  batch = () => Promise.resolve({ given: 3, alreadyTheirs: 0, skipped: [], stillOpen: 1 });
  api = {
    get: vi.fn((path: string) => {
      if (path.startsWith('/manage/leave/coverage')) return Promise.resolve(GAPS);
      if (path.startsWith(`/manage/leave/${LEAVE}/cover-preview`)) return preview();
      if (path === `/manage/leave/${LEAVE}/cover-fit`) return Promise.resolve(FIT);
      if (path.endsWith('/candidates')) return Promise.resolve([{ id: 't-rahul', name: 'Rahul Verma', teachesSubject: true, coversThatDay: 0 }, { id: 't-lata', name: 'Lata Iyer', teachesSubject: false, coversThatDay: 0 }]);
      return Promise.resolve([]);
    }),
    post: vi.fn((path: string) => (path.endsWith('/cover-batch') ? batch() : Promise.resolve({}))),
    put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
});

const gets = (prefix: string) => (api.get as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith(prefix)).length;

async function openCoverage() {
  renderWithProviders(<AdminLeavePage />);
  fireEvent.click(await screen.findByRole('tab', { name: /coverage/i }));
  await screen.findByTestId('cover-g1');
}
async function pickRahulFor(gapClass: string) {
  const select = screen.getAllByLabelText(new RegExp(`Substitute for ${gapClass}`))[0];
  fireEvent.focus(select);
  await within(select).findByRole('option', { name: /Rahul Verma/ });
  fireEvent.change(select, { target: { value: 't-rahul' } });
}
async function openDrawerFromOffer() {
  await openCoverage();
  await pickRahulFor('9-A, Period 1, ');
  fireEvent.click(await screen.findByRole('button', { name: /See the 4 periods/ }));
  return screen.findByRole('dialog', { name: "Cover Priya Nair's leave with Rahul Verma" });
}

describe('the coverage list, grouped by leave', () => {
  it('groups gaps under the leave that opened them, with a way to cover the whole leave at once', async () => {
    await openCoverage();
    const group = screen.getByTestId(`cover-group-${LEAVE}`);
    expect(group.textContent).toContain("Priya Nair's leave");
    expect(group.textContent).toContain('4 of 5 need cover');
    expect(within(group).getByRole('button', { name: 'Cover with one teacher' })).toBeTruthy();
    // A gap made by hand is in its own group, after the leaves, with no such button.
    const other = screen.getByTestId('cover-group-none');
    expect(other.textContent).toContain('Other classes to cover');
    expect(within(other).queryByRole('button')).toBeNull();
    const order = [...document.querySelectorAll('[data-testid^="cover-group-"]')].map((e) => e.getAttribute('data-testid'));
    expect(order).toEqual([`cover-group-${LEAVE}`, 'cover-group-none']);
  });

  it('the picker says how much of the leave each teacher could take', async () => {
    await openCoverage();
    const select = screen.getAllByLabelText(/Substitute for 9-A, Period 1/)[0];
    fireEvent.focus(select);
    expect(await within(select).findByRole('option', { name: 'Rahul Verma · teaches this subject · free for 3 of 4 in this leave' })).toBeTruthy();
    expect(within(select).getByRole('option', { name: 'Lata Iyer · free for 1 of 4 in this leave' })).toBeTruthy();
  });

  it('a hand-made gap never asks how much of a leave anyone could take', async () => {
    await openCoverage();
    const select = screen.getByLabelText(/Substitute for 6-D/);
    fireEvent.focus(select);
    await within(select).findByRole('option', { name: /Rahul Verma/ });
    expect(gets(`/manage/leave/${LEAVE}/cover-fit`)).toBe(0);
  });
});

describe('after a pick: "give them the rest?"', () => {
  it('asks right under the row just picked, with the real counts', async () => {
    await openCoverage();
    await pickRahulFor('9-A, Period 1, ');
    const offer = await screen.findByTestId('cover-offer');
    expect(offer.textContent).toContain("Give Rahul Verma the rest of Priya Nair's leave?");
    expect(offer.textContent).toContain('Rahul Verma is free for 3 of the 4 open periods. 1 clashes with their own day and stays open.');
    // Directly after the picked row — not at the top of the group, where a long list would hide it.
    expect(screen.getByTestId('cover-g1').nextElementSibling).toBe(offer);
  });

  it('says nothing when the teacher is free for nothing else', async () => {
    preview = () => Promise.resolve({ ...PREVIEW, rows: PREVIEW.rows.map((r) => (r.state === 'FREE' ? { ...r, state: 'TEACHING', reason: 'x' } : r)) });
    await openCoverage();
    await pickRahulFor('9-A, Period 1, ');
    await waitFor(() => expect(gets(`/manage/leave/${LEAVE}/cover-preview`)).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('cover-offer')).toBeNull();
  });

  it('"No thanks" puts it away, and it is not asked again for that leave', async () => {
    await openCoverage();
    await pickRahulFor('9-A, Period 1, ');
    fireEvent.click(await screen.findByRole('button', { name: 'No thanks' }));
    expect(screen.queryByTestId('cover-offer')).toBeNull();
    await pickRahulFor('9-B, Period 2, ');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/substitution/g2/assign', { substituteTeacherId: 't-rahul' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('cover-offer')).toBeNull();
  });

  it('a pick on a hand-made gap asks nothing', async () => {
    await openCoverage();
    await pickRahulFor('6-D');
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/substitution/h1/assign', { substituteTeacherId: 't-rahul' }));
    expect(gets(`/manage/leave/${LEAVE}/cover-preview`)).toBe(0);
    expect(screen.queryByTestId('cover-offer')).toBeNull();
  });
});

describe('the drawer', () => {
  it('ticks every free period, names every clash, folds what others already cover', async () => {
    const dialog = await openDrawerFromOffer();
    const box = (id: string) => within(dialog).getByTestId(`cvd-${id}`).querySelector('input') as HTMLInputElement;
    expect([box('g2').checked, box('g2').disabled]).toEqual([true, false]);
    expect([box('g5').checked, box('g6').checked]).toEqual([true, true]);
    // Already theirs: shown ticked, cannot be unticked here.
    expect([box('g1').checked, box('g1').disabled]).toEqual([true, true]);
    // A clash: cannot be ticked, and says why in words.
    expect([box('g4').checked, box('g4').disabled]).toEqual([false, true]);
    expect(within(dialog).getByTestId('cvd-g4').textContent).toContain('Rahul Verma teaches 10-B then.');
    // Covered by someone else: not a row to tick, but named in the fold.
    expect(within(dialog).queryByTestId('cvd-g3')).toBeNull();
    expect(within(dialog).getByText(/1 period already covered by someone else/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Give Rahul Verma 3 periods' })).toBeTruthy();
    expect(within(dialog).getByText('1 period stays open — pick someone else for it.')).toBeTruthy();
  });

  it('a day can be unticked whole, and the count and Save follow', async () => {
    const dialog = await openDrawerFromOffer();
    fireEvent.click(within(dialog).getByLabelText('All free periods on Wed 9 Jan'));
    expect(within(dialog).getByRole('button', { name: 'Give Rahul Verma 1 period' })).toBeTruthy();
    // The day can be ticked back, whole.
    fireEvent.click(within(dialog).getByLabelText('All free periods on Wed 9 Jan'));
    expect(within(dialog).getByRole('button', { name: 'Give Rahul Verma 3 periods' })).toBeTruthy();
    // Untick Wednesday again and save: only what is still ticked goes.
    fireEvent.click(within(dialog).getByLabelText('All free periods on Wed 9 Jan'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give Rahul Verma 1 period' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/manage/leave/${LEAVE}/cover-batch`, { substituteTeacherId: 't-rahul', substitutionIds: ['g2'] }));
  });

  it('nothing ticked: nothing to save', async () => {
    const dialog = await openDrawerFromOffer();
    fireEvent.click(within(dialog).getByLabelText('All free periods on Wed 9 Jan'));
    fireEvent.click(within(dialog).getByTestId('cvd-g2').querySelector('input')!);
    expect((within(dialog).getByTestId('cover-batch-save') as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog).getByTestId('cover-batch-save').textContent).toBe('Give Rahul Verma 0 periods');
  });

  it('flags a day that would reach the busy line, and drops the flag when unticked', async () => {
    // Monday: 2 covers before + Period 2 ticked = 3, which meets a line of 3.
    preview = () => Promise.resolve({ ...PREVIEW, busyDayAt: 3 });
    const dialog = await openDrawerFromOffer();
    expect(within(dialog).getByTestId('busy-2030-01-07').textContent).toBe('Rahul Verma would have 3 covers that day.');
    expect(within(dialog).getByLabelText("Rahul Verma's covers each day").textContent).toContain('Mon 7 Jan: 2 → 3');
    fireEvent.click(within(dialog).getByTestId('cvd-g2').querySelector('input')!);
    expect(within(dialog).queryByTestId('busy-2030-01-07')).toBeNull();
    // Wednesday has no covers before, so two ticks stay under it.
    expect(within(dialog).queryByTestId('busy-2030-01-09')).toBeNull();
  });

  it('Save sends exactly the ticked free periods, then shows what was given and what was not', async () => {
    batch = () => Promise.resolve({ given: 2, alreadyTheirs: 0, skipped: [{ gapId: 'g6', when: 'Wed 9 Jan, Period 2', className: '9-B', why: 'TAKEN', reason: 'Someone else covered it a moment ago.' }], stillOpen: 2 });
    const dialog = await openDrawerFromOffer();
    const coverageBefore = gets('/manage/leave/coverage');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give Rahul Verma 3 periods' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`/manage/leave/${LEAVE}/cover-batch`, { substituteTeacherId: 't-rahul', substitutionIds: ['g2', 'g5', 'g6'] }));
    const result = await within(dialog).findByTestId('cover-batch-result');
    expect(result.textContent).toContain('Rahul Verma now covers 3 periods of this leave.');
    expect(result.textContent).toContain('They have been told in one message.');
    expect(result.textContent).toContain('Wed 9 Jan, Period 2, 9-B: Someone else covered it a moment ago.');
    expect(result.textContent).toContain('2 periods of this leave still need a teacher.');
    await waitFor(() => expect(gets('/manage/leave/coverage')).toBeGreaterThan(coverageBefore));
  });

  it('a refused save shows the server\'s sentence and keeps the ticks', async () => {
    batch = () => Promise.reject(new ApiError(409, 'This leave was withdrawn a moment ago, so its periods no longer need a teacher. Nothing was changed.', { code: 'COVER_GONE' }));
    const dialog = await openDrawerFromOffer();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give Rahul Verma 3 periods' }));
    expect(await within(dialog).findByText(/This leave was withdrawn a moment ago/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Give Rahul Verma 3 periods' })).toBeTruthy();
  });

  it('a preview that fails says so instead of an empty drawer', async () => {
    await openCoverage();
    preview = () => Promise.reject(new Error('Could not reach the school server'));
    fireEvent.click(screen.getByRole('button', { name: 'Cover with one teacher' }));
    fireEvent.click(await screen.findByText('Rahul Verma'));
    expect(await screen.findByText('Could not reach the school server')).toBeTruthy();
  });
});

describe('"Cover with one teacher" from the group header', () => {
  it('starts with who can take the most, then the same drawer for the one chosen', async () => {
    await openCoverage();
    fireEvent.click(screen.getByRole('button', { name: 'Cover with one teacher' }));
    const list = await screen.findByRole('list', { name: 'Teachers, most free first' });
    expect(within(list).getAllByRole('listitem').map((b) => b.textContent)).toEqual(['Rahul Vermafree for 3 of 4', 'Lata Iyerfree for 1 of 4']);
    fireEvent.click(within(list).getByText('Rahul Verma'));
    const dialog = await screen.findByRole('dialog', { name: "Cover Priya Nair's leave with Rahul Verma" });
    expect(api.get).toHaveBeenCalledWith(`/manage/leave/${LEAVE}/cover-preview?teacherId=t-rahul`);
    // Chosen here, so it can be changed here.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change teacher' }));
    expect(await screen.findByRole('list', { name: 'Teachers, most free first' })).toBeTruthy();
  });

  it('says so when nobody is free for any of it', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) =>
      path.startsWith('/manage/leave/coverage') ? Promise.resolve(GAPS) : path.endsWith('/cover-fit') ? Promise.resolve({ open: 4, teachers: [] }) : Promise.resolve([]),
    );
    await openCoverage();
    fireEvent.click(screen.getByRole('button', { name: 'Cover with one teacher' }));
    expect(await screen.findByText('Nobody is free for any of the 4 open periods. Each one needs someone different.')).toBeTruthy();
  });
});
