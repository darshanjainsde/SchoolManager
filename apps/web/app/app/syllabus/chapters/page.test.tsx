import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { CHAPTERS, OVERVIEW } from '@/test/fixtures/syllabus';
import Page from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const params = new URLSearchParams();
vi.mock('next/navigation', () => ({ useSearchParams: () => params, usePathname: () => '/app/syllabus/chapters', useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const mockApi = () => ({
  get: vi.fn(async (p: string) => (p === '/manage/syllabus/overview' ? OVERVIEW : CHAPTERS)),
  post: vi.fn(async () => ({ id: 'new' })), put: vi.fn(), patch: vi.fn(async () => ({ id: 'c1' })), del: vi.fn(async () => undefined),
});

describe('admin chapter lists', () => {
  beforeEach(() => { vi.mocked(useHost).mockReturnValue('raffles.sckools.com'); params.delete('gradeId'); params.delete('subjectId'); });

  it('asks for a class and a subject first, then shows the list', async () => {
    const api = mockApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    expect(await screen.findByTestId('syl-c-choose')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('syl-c-grade'), { target: { value: 'g9' } });
    fireEvent.change(screen.getByTestId('syl-c-subject'), { target: { value: 's-mat' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/manage/syllabus/chapters?gradeId=g9&subjectId=s-mat'));
    expect(await screen.findByText('1. Number systems')).toBeInTheDocument();
    expect(screen.getByText('Zeroes of a polynomial')).toBeInTheDocument();
  });

  it('adds a chapter and a sub-topic, renames, and removes only after the inline yes', async () => {
    params.set('gradeId', 'g9'); params.set('subjectId', 's-mat');
    const api = mockApi();
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    await screen.findByText('1. Number systems');
    fireEvent.click(screen.getByTestId('syl-add-chapter-open'));
    fireEvent.change(screen.getByTestId('syl-add-chapter'), { target: { value: '  Triangles ' } });
    fireEvent.click(screen.getByTestId('syl-add-chapter-save'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/syllabus/chapters', { gradeId: 'g9', subjectId: 's-mat', title: 'Triangles', parentId: undefined }));
    fireEvent.click(screen.getByTestId('syl-add-sub-c2-open'));
    fireEvent.change(screen.getByTestId('syl-add-sub-c2'), { target: { value: 'Remainder theorem' } });
    fireEvent.click(screen.getByTestId('syl-add-sub-c2-save'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/syllabus/chapters', { gradeId: 'g9', subjectId: 's-mat', title: 'Remainder theorem', parentId: 'c2' }));
    fireEvent.click(screen.getByTestId('syl-rename-btn-c1'));
    fireEvent.change(screen.getByTestId('syl-rename-c1'), { target: { value: 'Number systems (NCERT)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/manage/syllabus/chapters/c1', { title: 'Number systems (NCERT)' }));
    fireEvent.click(screen.getByTestId('syl-remove-btn-c2'));
    expect(api.del).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove this chapter and its sub-topics from every section/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('syl-remove-yes-c2'));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/manage/syllabus/chapters/c2'));
  });

  it('a teacher of another subject sees the list but no controls', async () => {
    params.set('gradeId', 'g9'); params.set('subjectId', 's-mat');
    const api = mockApi();
    api.get = vi.fn(async (p: string) => (p === '/manage/syllabus/overview' ? OVERVIEW : { ...CHAPTERS, canEdit: false }));
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<Page />);
    await screen.findByText('1. Number systems');
    expect(screen.queryByTestId('syl-add-chapter-open')).toBeNull();
    expect(screen.queryByTestId('syl-remove-btn-c1')).toBeNull();
    expect(screen.getByText(/Only the admin or a teacher of this subject/)).toBeInTheDocument();
  });
});
