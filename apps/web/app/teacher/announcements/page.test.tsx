import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { MyClassSection } from '@skoolos/types';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TeacherAnnouncementsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

function classSection(overrides: Partial<MyClassSection> = {}): MyClassSection {
  return { classSectionId: 'sec-1', name: '8-A', studentCount: 30, covering: false, ...overrides };
}

function renderPage() {
  return renderWithProviders(
    <>
      <TeacherAnnouncementsPage />
      <Toaster />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

describe('TeacherAnnouncementsPage', () => {
  it('renders a loading state while the class list is fetching', () => {
    let resolveClasses!: (v: MyClassSection[]) => void;
    const pending = new Promise<MyClassSection[]>((resolve) => {
      resolveClasses = resolve;
    });
    const api = mockApi({ get: vi.fn().mockReturnValue(pending) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(screen.getByText('Loading your classes…')).toBeInTheDocument();
    resolveClasses([]);
  });

  it('renders the server error message when the class list fails to load', async () => {
    const api = mockApi({ get: vi.fn().mockRejectedValue(new Error('Class service is unavailable')) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Class service is unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state when the teacher has no classes', async () => {
    const api = mockApi({ get: vi.fn().mockResolvedValue([]) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('No classes assigned to you yet — ask your admin.')).toBeInTheDocument();
  });

  it('offers only owned classes — a covering:true section is excluded', async () => {
    const api = mockApi({
      get: vi.fn().mockResolvedValue([
        classSection({ classSectionId: 'sec-1', name: '8-A', covering: false }),
        classSection({ classSectionId: 'sec-2', name: '9-B', covering: true }),
      ]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByRole('button', { name: '8-A' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '9-B' })).not.toBeInTheDocument();
    expect(
      screen.getByText(/1 class you're only covering today isn't shown/),
    ).toBeInTheDocument();
  });

  it('submit is disabled with nothing selected, and enabled once a class, a title and a body are present', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: vi.fn().mockResolvedValue([classSection()]) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: '8-A' });

    const submit = screen.getByRole('button', { name: /post to 0 classes/i });
    expect(submit).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '8-A' }));
    await user.type(screen.getByLabelText('Title'), 'Reminder');
    await user.type(screen.getByLabelText('Details'), 'Bring your workbook tomorrow.');

    expect(screen.getByRole('button', { name: /post to 1 class/i })).toBeEnabled();
  });

  it('a whitespace-only title keeps submit disabled and fires no request', async () => {
    const user = userEvent.setup();
    const api = mockApi({ get: vi.fn().mockResolvedValue([classSection()]) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: '8-A' });

    await user.click(screen.getByRole('button', { name: '8-A' }));
    await user.type(screen.getByLabelText('Title'), '   ');
    await user.type(screen.getByLabelText('Details'), 'Bring your workbook tomorrow.');

    expect(screen.getByRole('button', { name: /post to 1 class/i })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits to /manage/announcements exactly once with trimmed title/body and classSectionIds', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue([classSection()]),
      post: vi.fn().mockResolvedValue([{ id: 'a1' }]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: '8-A' });

    await user.click(screen.getByRole('button', { name: '8-A' }));
    await user.type(screen.getByLabelText('Title'), '  Reminder  ');
    await user.type(screen.getByLabelText('Details'), '  Bring your workbook tomorrow.  ');
    await user.click(screen.getByRole('button', { name: /post to 1 class/i }));

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/manage/announcements', {
      title: 'Reminder',
      body: 'Bring your workbook tomorrow.',
      classSectionIds: ['sec-1'],
    });
  });

  it('on success the form clears and a confirmation naming the class count appears', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue([classSection()]),
      post: vi.fn().mockResolvedValue([{ id: 'a1' }]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: '8-A' });

    await user.click(screen.getByRole('button', { name: '8-A' }));
    await user.type(screen.getByLabelText('Title'), 'Reminder');
    await user.type(screen.getByLabelText('Details'), 'Bring your workbook tomorrow.');
    await user.click(screen.getByRole('button', { name: /post to 1 class/i }));

    expect(await screen.findByText('Posted to 1 class')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.getByLabelText('Details')).toHaveValue('');
    expect(screen.getByRole('button', { name: '8-A' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the server message verbatim on a 403 CLASS_NOT_OWNED', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue([classSection()]),
      post: vi.fn().mockRejectedValue(new Error('You can only announce to your own class sections')),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: '8-A' });

    await user.click(screen.getByRole('button', { name: '8-A' }));
    await user.type(screen.getByLabelText('Title'), 'Reminder');
    await user.type(screen.getByLabelText('Details'), 'Bring your workbook tomorrow.');
    await user.click(screen.getByRole('button', { name: /post to 1 class/i }));

    expect(await screen.findByText('You can only announce to your own class sections')).toBeInTheDocument();
  });

  it('never issues a request to the nonexistent /announcements or /classes endpoints', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: vi.fn().mockResolvedValue([classSection()]),
      post: vi.fn().mockResolvedValue([{ id: 'a1' }]),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: '8-A' });

    await user.click(screen.getByRole('button', { name: '8-A' }));
    await user.type(screen.getByLabelText('Title'), 'Reminder');
    await user.type(screen.getByLabelText('Details'), 'Bring your workbook tomorrow.');
    await user.click(screen.getByRole('button', { name: /post to 1 class/i }));

    await screen.findByText('Posted to 1 class');

    const getPaths = vi.mocked(api.get).mock.calls.map(([path]) => path);
    const postPaths = vi.mocked(api.post).mock.calls.map(([path]) => path);
    expect(getPaths).not.toContain('/classes');
    expect(postPaths).not.toContain('/announcements');
  });
});
