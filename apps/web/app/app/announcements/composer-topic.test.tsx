// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import AnnouncementsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const CLASSES = [{ id: 'cs-1', name: 'B', grade: { name: '5' }, academicYear: { isCurrent: true }, _count: { students: 30 } }];
const NOTICE = { id: 'n1', title: 'Old notice', body: 'Words', classSectionId: null, classSection: null, createdAt: new Date().toISOString() };
let post: ReturnType<typeof vi.fn>;

beforeEach(() => {
  post = vi.fn().mockResolvedValue({});
  (useHost as ReturnType<typeof vi.fn>).mockReturnValue('raffles.test');
  (useApi as ReturnType<typeof vi.fn>).mockReturnValue({
    get: vi.fn(async (p: string) => (p.startsWith('/manage/announcements') ? [NOTICE] : p.startsWith('/manage/classes') ? CLASSES : [])),
    post, put: vi.fn(), patch: vi.fn().mockResolvedValue({}), del: vi.fn(), download: vi.fn(), postForm: vi.fn(),
  });
});

const page = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AnnouncementsPage /></QueryClientProvider>);
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const openNew = async () => { page(); fireEvent.click(await screen.findByRole('button', { name: /new announcement/i })); };

describe('the kind of notice', () => {
  it('posts a PTM with its date and time, and prefills the title', async () => {
    await openNew();
    fireEvent.click(screen.getByRole('button', { name: "Parents' meeting" }));
    set('Date', '2099-10-11');
    set('Time', '10:00');
    expect(screen.getByLabelText('Title')).toHaveValue("Parents' meeting on 11 Oct");
    set('Message', 'Please come with your ward.');
    fireEvent.click(screen.getByRole('button', { name: /post announcement/i }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/manage/announcements', expect.objectContaining({ topic: { kind: 'PTM', on: '2099-10-11', at: '10:00' } })));
  });

  it('a general notice sends no topic', async () => {
    await openNew();
    set('Title', 'Sports day kit');
    set('Message', 'White shoes, please.');
    fireEvent.click(screen.getByRole('button', { name: /post announcement/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).not.toHaveProperty('topic');
  });

  it('a title the admin typed is never overwritten by the prefill', async () => {
    await openNew();
    set('Title', 'Diwali break');
    fireEvent.click(screen.getByRole('button', { name: 'Holiday' }));
    set('Closed on', '2099-10-20');
    set('For', 'Diwali');
    set('Classes resume', '2099-10-23');
    expect(screen.getByLabelText('Title')).toHaveValue('Diwali break');
  });

  it('Post stays disabled until the chosen kind has every field', async () => {
    await openNew();
    fireEvent.click(screen.getByRole('button', { name: 'Timing change' }));
    set('Title', 't'); set('Message', 'm'); set('Date', '2099-10-13'); set('From', '08:00');
    fireEvent.click(screen.getByRole('button', { name: /post announcement/i }));
    expect(post).not.toHaveBeenCalled();
    set('To', '12:30');
    fireEvent.click(screen.getByRole('button', { name: /post announcement/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
  });

  it('editing an existing notice shows no kind chooser', async () => {
    page();
    fireEvent.click((await screen.findByText('Old notice')).closest('[data-clickable]') as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit wording' }));
    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).queryByRole('group', { name: 'What is it?' })).toBeNull();
  });
});
