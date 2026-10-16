import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { STUDENT_SUBJECT } from '@/test/fixtures/syllabus';
import Page from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ subjectId: 's-mat' }), usePathname: () => '/portal/syllabus/s-mat', useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const mockApi = () => ({ get: vi.fn(async () => STUDENT_SUBJECT), post: vi.fn(), put: vi.fn(async (_p: string, b: { body: string }) => ({ chapterId: 'x', myNote: b.body || null })), patch: vi.fn(), del: vi.fn() });

describe('student subject page', () => {
  beforeEach(() => { vi.mocked(useHost).mockReturnValue('raffles.sckools.com'); });

  it("shows the teacher's note and my note, and the 'to revise' filter keeps only taught topics without a note", async () => {
    vi.mocked(useApi).mockReturnValue(mockApi() as never);
    renderWithProviders(<Page />);
    expect(await screen.findByText('Read the summary box')).toBeInTheDocument();
    expect(screen.getByText('Rational vs irrational')).toBeInTheDocument();
    expect(screen.getByText('3 topics to revise')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('syl-filter-REVISE'));
    expect(screen.queryByTestId('syl-leaf-c1')).toBeNull(); // taught, but already noted
    expect(screen.getByTestId('syl-leaf-c2a')).toBeInTheDocument(); // taught, no note
    expect(screen.queryByTestId('syl-leaf-c2b')).toBeNull(); // not taught yet
  });

  it('saves a trimmed note with PUT, and removes it with an empty body', async () => {
    const api = mockApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    fireEvent.click(await screen.findByTestId('syl-mynote-c2a-edit'));
    fireEvent.change(screen.getByTestId('syl-mynote-c2a'), { target: { value: '  Zero = where graph cuts x-axis ' } });
    fireEvent.click(screen.getByTestId('syl-mynote-c2a-save'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/me/syllabus/notes/c2a', { body: 'Zero = where graph cuts x-axis' }));
    fireEvent.click(screen.getByTestId('syl-mynote-c1-edit'));
    fireEvent.click(screen.getByTestId('syl-mynote-c1-clear'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/me/syllabus/notes/c1', { body: '' }));
  });
});
