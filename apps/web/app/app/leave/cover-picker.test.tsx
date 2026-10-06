import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { ApiError } from '@/lib/api';
import AdminLeavePage from './page';

/**
 * WHO IS FREE IS THE SERVER'S ANSWER, NOT THE PAGE'S.
 *
 * The page used to build its own busySet from the whole week's timetable and
 * offered teachers who were on leave that day. It now asks
 * /manage/substitution/:id/candidates — freeTeachersFor, the same answer the
 * WhatsApp list and assign() use — and only for the gap being picked.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const GAPS = [
  { id: 'g1', date: '2026-10-05', classSectionId: 'c1', classSectionName: 'VII-B', periodId: 'per1', periodLabel: 'Period I', originalTeacherName: 'Asha Rao', substituteTeacherId: null, substituteTeacherName: null, acknowledgedAt: null },
  { id: 'g2', date: '2026-10-05', classSectionId: 'c2', classSectionName: 'VIII-A', periodId: 'per2', periodLabel: 'Period II', originalTeacherName: 'Asha Rao', substituteTeacherId: 't9', substituteTeacherName: 'Kavya Rao', acknowledgedAt: '2026-10-05T02:40:00.000Z' },
  { id: 'g3', date: '2026-10-05', classSectionId: 'c3', classSectionName: 'IX-C', periodId: 'per3', periodLabel: 'Period III', originalTeacherName: 'Asha Rao', substituteTeacherId: 't8', substituteTeacherName: 'Mohan Das', acknowledgedAt: null },
];

const CANDIDATES = [
  { id: 'ta', name: 'Arun Mehta', teachesSubject: true, coversThatDay: 0 },
  { id: 'tb', name: 'Lata Iyer', teachesSubject: false, coversThatDay: 2 },
];

let api: ApiStub;
let candidates: () => Promise<unknown>;
beforeEach(() => {
  vi.clearAllMocks();
  candidates = () => Promise.resolve(CANDIDATES);
  api = {
    get: vi.fn((path: string) => {
      if (path.startsWith('/manage/leave/coverage')) return Promise.resolve(GAPS);
      if (path === '/manage/substitution/g1/candidates') return candidates();
      return Promise.resolve([]);
    }),
    post: vi.fn().mockResolvedValue({}), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
});

const openCoverage = async () => {
  renderWithProviders(<AdminLeavePage />);
  fireEvent.click(await screen.findByRole('tab', { name: /coverage/i }));
  return screen.findByLabelText(/Substitute for VII-B/);
};
const asked = (path: string) => (api.get as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === path).length;
const coverageAsks = () => (api.get as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).startsWith('/manage/leave/coverage')).length;

describe('the coverage picker', () => {
  it('asks the server who is free for THIS gap, only once someone opens it', async () => {
    const select = await openCoverage();
    expect(api.get).not.toHaveBeenCalledWith('/manage/substitution/g1/candidates');
    fireEvent.focus(select);
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/manage/substitution/g1/candidates'));
    expect(await screen.findByRole('option', { name: 'Arun Mehta · teaches this subject' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Lata Iyer · 2 covers that day' })).toBeTruthy();
    expect(api.get).not.toHaveBeenCalledWith('/manage/availability');
  });

  it('says it is looking while the answer is on its way', async () => {
    candidates = () => new Promise(() => {});
    const select = await openCoverage();
    expect(within(select).getByRole('option', { name: 'Pick a free teacher…' })).toBeTruthy();
    fireEvent.focus(select);
    expect(await within(select).findByRole('option', { name: 'Finding who is free…' })).toBeTruthy();
  });

  it('says so when nobody is free, instead of an empty list', async () => {
    candidates = () => Promise.resolve([]);
    const select = await openCoverage();
    fireEvent.focus(select);
    expect(await screen.findByRole('option', { name: 'Nobody is free that period' })).toBeTruthy();
    expect((select as HTMLSelectElement).options).toHaveLength(1);
  });

  it('says it could not load, and asks again when opened again', async () => {
    candidates = () => Promise.reject(new Error('boom'));
    const select = await openCoverage();
    fireEvent.focus(select);
    expect(await screen.findByRole('option', { name: 'Could not load who is free — open again' })).toBeTruthy();
    candidates = () => Promise.resolve(CANDIDATES);
    fireEvent.blur(select);
    fireEvent.focus(select);
    expect(await screen.findByRole('option', { name: 'Arun Mehta · teaches this subject' })).toBeTruthy();
  });

  it('picking a teacher assigns them, and asks again who is free', async () => {
    const select = await openCoverage();
    fireEvent.focus(select);
    await screen.findByRole('option', { name: /Arun Mehta/ });
    const before = asked('/manage/substitution/g1/candidates');
    fireEvent.change(select, { target: { value: 'ta' } });
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/substitution/g1/assign', { substituteTeacherId: 'ta' }));
    await waitFor(() => expect(asked('/manage/substitution/g1/candidates')).toBeGreaterThan(before));
  });

  it('a 409 shows the API sentence as it is, and refetches the gaps and who is free', async () => {
    const sentence = 'Someone changed this cover a moment ago — it is now with Mr Rao. Nothing was changed; look again and pick.';
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, sentence, { code: 'TEACHER_CONFLICT' }));
    const select = await openCoverage();
    fireEvent.focus(select);
    await screen.findByRole('option', { name: /Arun Mehta/ });
    const gapsBefore = coverageAsks();
    const candsBefore = asked('/manage/substitution/g1/candidates');
    fireEvent.change(select, { target: { value: 'ta' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(sentence));
    await waitFor(() => expect(coverageAsks()).toBeGreaterThan(gapsBefore));
    await waitFor(() => expect(asked('/manage/substitution/g1/candidates')).toBeGreaterThan(candsBefore));
  });

  it('any other failure shows its words but does not refetch', async () => {
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(500, 'Server error', null));
    const select = await openCoverage();
    fireEvent.focus(select);
    await screen.findByRole('option', { name: /Arun Mehta/ });
    const gapsBefore = coverageAsks();
    fireEvent.change(select, { target: { value: 'ta' } });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Server error'));
    expect(coverageAsks()).toBe(gapsBefore);
  });

  it('a 409 on Clear shows the sentence and refetches the gaps too', async () => {
    const sentence = 'That cover has already changed.';
    (api.post as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError(409, sentence, { code: 'TEACHER_CONFLICT' }));
    await openCoverage();
    const gapsBefore = coverageAsks();
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear' })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(sentence));
    await waitFor(() => expect(coverageAsks()).toBeGreaterThan(gapsBefore));
  });

  it('a covered class says whether the substitute has seen it', async () => {
    await openCoverage();
    expect(await screen.findByText(/Kavya Rao · seen 8:10\sam/i)).toBeTruthy();
    expect(screen.getByText('Mohan Das · not yet seen')).toBeTruthy();
  });

  it('a class with nobody has no seen line', async () => {
    await openCoverage();
    const row = screen.getByTestId('cover-g1');
    expect(row.textContent).not.toMatch(/seen/);
  });

  it('the current substitute stays in their own picker', async () => {
    await openCoverage();
    const select = screen.getByLabelText(/Substitute for VIII-A/) as HTMLSelectElement;
    expect(select.value).toBe('t9');
    expect(screen.getByRole('option', { name: 'Kavya Rao' })).toBeTruthy();
  });

  it('the list declares the columns, not each row', async () => {
    await openCoverage();
    const list = screen.getByRole('list', { name: 'Classes to cover' });
    expect(list.style.getPropertyValue('--sk-row-cols')).toMatch(/minmax\(0, 1\.3fr\)/);
    for (const row of list.querySelectorAll('.sk-rowline')) expect((row as HTMLElement).style.gridTemplateColumns).toBe('');
  });

  it('the page has no free-teacher logic of its own', () => {
    const page = readFileSync(resolve(process.cwd(), 'app/app/leave/page.tsx'), 'utf8');
    expect(page).not.toMatch(/busySet/);
    expect(page).not.toMatch(/\/manage\/availability/);
  });
});

describe('a half day on the leave desk', () => {
  const app = (id: string, name: string, halfDayPart: 'AM' | 'PM' | null) => ({
    id, teacherId: `t-${id}`, teacherName: name, personUserId: null, type: 'CASUAL', startDate: '2026-10-07', endDate: '2026-10-07',
    halfDay: true, halfDayPart, reason: null, status: 'PENDING', createdAt: '2026-10-01T00:00:00.000Z',
  });

  it('names its half on Pending and Approved; an old one says just "Half day"', async () => {
    (api.get as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
      if (path.includes('status=PENDING')) return Promise.resolve([app('a', 'Asha Verma', 'AM'), app('o', 'Mohan Das', null)]);
      if (path.includes('status=APPROVED')) return Promise.resolve([{ ...app('p', 'Kavya Rao', 'PM'), status: 'APPROVED' }]);
      return Promise.resolve([]);
    });
    renderWithProviders(<AdminLeavePage />);
    const rowOf = async (name: string) => (await screen.findByText(name)).closest('.sk-row')?.textContent ?? '';
    expect(await rowOf('Asha Verma')).toMatch(/Half day · morning/);
    const old = await rowOf('Mohan Das');
    expect(old).toMatch(/Half day/);
    expect(old).not.toMatch(/morning|afternoon|–/);
    fireEvent.click(screen.getByRole('tab', { name: /approved/i }));
    expect(await rowOf('Kavya Rao')).toMatch(/Half day · afternoon/);
  });
});
