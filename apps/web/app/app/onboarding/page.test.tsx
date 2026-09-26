import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OnboardingPage from './page';

const download = vi.fn();
const postForm = vi.fn();
vi.mock('@/lib/use-api', () => ({
  useApi: () => ({
    get: vi.fn().mockResolvedValue({ years: [{ id: 'y1', name: '2026-27', isCurrent: true }, { id: 'y0', name: '2025-26', isCurrent: false }] }),
    download: (...a: unknown[]) => download(...a),
    postForm: (...a: unknown[]) => postForm(...a),
  }),
}));
vi.mock('@/components/use-host', () => ({ useHost: () => 'raffles.test.sckools.com' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const saveBlob = vi.fn();
vi.mock('@/lib/save-blob', () => ({ saveBlob: (...a: unknown[]) => saveBlob(...a) }));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><OnboardingPage /></QueryClientProvider>);
}
const card = (title: string) => within(screen.getByRole('heading', { name: title }).closest('section')!);
const file = () => new File([new Uint8Array([80, 75, 3, 4])], 'students.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

beforeEach(() => {
  download.mockReset().mockResolvedValue({ blob: new Blob(['x']), filename: 'sckools-students-template.xlsx' });
  postForm.mockReset();
  saveBlob.mockReset();
});

describe('the Onboarding tab', () => {
  it('offers the three sheets in the order a school needs them: classes, then teachers, then students', async () => {
    renderPage();
    const titles = (await screen.findAllByRole('heading', { level: 3 })).map((h) => h.textContent);
    expect(titles).toEqual(['Classes & sections', 'Teachers', 'Students']);
  });

  it('downloads a blank template and an export through the authenticated client, and hands the file to the browser under the server’s name', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Students' });
    await user.click(card('Students').getByRole('button', { name: /Blank template/ }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('/manage/onboarding/template/students'));
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'sckools-students-template.xlsx');
    await user.click(card('Teachers').getByRole('button', { name: /Export what we have/ }));
    await waitFor(() => expect(download).toHaveBeenCalledWith('/manage/onboarding/export/teachers'));
  });

  it('students need a session; the current one is picked and travels with the check', async () => {
    postForm.mockResolvedValue({ kind: 'students', total: 2, ok: 2, issues: [], sample: [{ row: 2, admissionNo: 'A1', firstName: 'Aarav' }] });
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Students' });
    const c = card('Students');
    expect((await c.findByLabelText('Session')) as HTMLSelectElement).toHaveValue('y1');
    expect(c.getByRole('button', { name: /Check the file/ })).toBeDisabled();
    await user.upload(c.getByLabelText(/Filled-in file/), file());
    await user.click(c.getByRole('button', { name: /Check the file/ }));
    await waitFor(() => expect(postForm).toHaveBeenCalled());
    expect(postForm.mock.calls[0][0]).toBe('/manage/onboarding/preview/students?academicYearId=y1');
    expect(postForm.mock.calls[0][1]).toBeInstanceOf(FormData);
    expect(await c.findByText('2 rows ready')).toBeInTheDocument();
    expect(c.getByRole('button', { name: 'Import 2' })).toBeEnabled();
  });

  it('teachers need no session, and import stays shut until the check is clean', async () => {
    postForm.mockResolvedValue({ kind: 'teachers', total: 3, ok: 1, issues: [
      { row: 2, column: 'First name', message: 'First name is required.' },
      { row: 4, column: 'Post', message: '"HEADMASTER" is not one of: PRT, TGT, PGT.' },
    ], sample: [] });
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Teachers' });
    const c = card('Teachers');
    expect(c.queryByLabelText('Session')).toBeNull();
    await user.upload(c.getByLabelText(/Filled-in file/), file());
    await user.click(c.getByRole('button', { name: /Check the file/ }));
    expect(await c.findByText(/2 problems in 2 of 3 rows — nothing was imported/)).toBeInTheDocument();
    const rows = c.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('2First nameFirst name is required.');
    expect(rows[1]).toHaveTextContent('4Post"HEADMASTER" is not one of');
    expect(c.getByRole('button', { name: /^Import/ })).toBeDisabled();
    expect(postForm.mock.calls[0][0]).toBe('/manage/onboarding/preview/teachers');
  });

  it('a clean check, then Import, reports what was created and what the service refused', async () => {
    postForm
      .mockResolvedValueOnce({ kind: 'classes', total: 3, ok: 3, issues: [], skipped: 1, sample: [{ row: 2, gradeName: '5', sectionName: 'B' }] })
      .mockResolvedValueOnce({ created: 2, skipped: 1, failed: [] });
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByRole('heading', { name: 'Classes & sections' });
    const c = card('Classes & sections');
    await user.upload(c.getByLabelText(/Filled-in file/), file());
    await user.click(c.getByRole('button', { name: /Check the file/ }));
    expect(await c.findByText(/3 rows ready · 1 already exist and will be skipped/)).toBeInTheDocument();
    await user.click(c.getByRole('button', { name: 'Import 3' }));
    expect(await c.findByText('Imported 2 · 1 skipped')).toBeInTheDocument();
    expect(postForm.mock.calls[1][0]).toBe('/manage/onboarding/import/classes?academicYearId=y1');
  });
});
