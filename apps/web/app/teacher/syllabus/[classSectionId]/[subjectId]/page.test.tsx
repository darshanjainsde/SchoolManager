import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { CHAPTERS, TRACK } from '@/test/fixtures/syllabus';
import Page from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ classSectionId: 'cs-9a', subjectId: 's-mat' }), usePathname: () => '/teacher/syllabus/cs-9a/s-mat', useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const BASE = '/manage/syllabus/tracks/cs-9a/s-mat';
const mockApi = (trackData = TRACK) => ({
  get: vi.fn(async (p: string) => (p === BASE ? trackData : CHAPTERS)),
  post: vi.fn(async () => ({ ...trackData, summary: { ...trackData.summary, pct: 50 } })),
  put: vi.fn(async () => ({ ...trackData, summary: { ...trackData.summary, pct: 50 } })),
  patch: vi.fn(), del: vi.fn(),
});

describe('teacher track page', () => {
  beforeEach(() => { vi.mocked(useHost).mockReturnValue('raffles.sckools.com'); });

  it('shows the rings, the verdict in points, and every chapter with its derived status', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi() as never);
    renderWithProviders(<Page />);
    expect(await screen.findByText('13 pts behind')).toBeInTheDocument();
    expect(screen.getByTestId('syl-hero')).toHaveTextContent('Now: Coordinate geometry');
    const poly = screen.getByTestId('syl-ch-c2');
    expect(within(poly).getByText('1 of 2 sub-topics done')).toBeInTheDocument();
    expect(within(poly).getAllByText('Teaching').length).toBeGreaterThan(0);
    expect(within(poly).getByText('Revise Q4 before the test')).toBeInTheDocument();
    // A parent with sub-topics has no status buttons of its own; its sub-topics do.
    expect(screen.queryByTestId('syl-status-c2-DONE')).toBeNull();
    expect(screen.getByTestId('syl-status-c2b-DONE')).toBeInTheDocument();
  });

  it('a status button PUTs the leaf; "Reached here" POSTs; the answer replaces the track', async () => {
    const api = mockApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    fireEvent.click(await screen.findByTestId('syl-status-c2b-DONE'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/progress/c2b`, { status: 'DONE' }));
    // Pressing the already-pressed status does nothing.
    fireEvent.click(screen.getByTestId('syl-status-c1-DONE'));
    expect(api.put).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('syl-reach-c3'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith(`${BASE}/reach/c3`, {}));
    await waitFor(() => expect(screen.getByText('5 pts behind')).toBeInTheDocument());
  });

  it('a note is saved on its own, trimmed', async () => {
    const api = mockApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    fireEvent.click(await screen.findByTestId('syl-note-edit-c1'));
    fireEvent.change(screen.getByTestId('syl-note-c1'), { target: { value: '  Skipped exercise 1.3  ' } });
    fireEvent.click(screen.getByTestId('syl-note-save-c1'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(`${BASE}/progress/c1`, { note: 'Skipped exercise 1.3' }));
  });

  it("today's substitute sees the chapters and the notes, but no buttons and no editor", async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({ ...TRACK, canEdit: false }) as never);
    renderWithProviders(<Page />);
    expect(await screen.findByText(/covering this class today/)).toBeInTheDocument();
    expect(screen.getByText('Revise Q4 before the test')).toBeInTheDocument();
    expect(screen.queryByTestId('syl-status-c2b-DONE')).toBeNull();
    expect(screen.queryByTestId('syl-reach-c3')).toBeNull();
    expect(screen.queryByTestId('syl-editor')).toBeNull();
  });

  it('the chapter editor adds for the whole class', async () => {
    const api = mockApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    fireEvent.click(await screen.findByTestId('syl-add-chapter-open'));
    fireEvent.change(screen.getByTestId('syl-add-chapter'), { target: { value: 'Triangles' } });
    fireEvent.click(screen.getByTestId('syl-add-chapter-save'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/syllabus/chapters', { gradeId: 'g9', subjectId: 's-mat', title: 'Triangles', parentId: undefined }));
  });
});
