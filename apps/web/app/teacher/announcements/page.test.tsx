import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from 'sonner';
import type { AnnouncementMine, MyClassSection } from '@skoolos/types';
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

function announcement(overrides: Partial<AnnouncementMine> = {}): AnnouncementMine {
  return {
    id: 'ann-1',
    title: 'Reminder',
    body: 'Bring your workbook tomorrow.',
    classSectionId: 'sec-1',
    className: '8-A',
    createdAt: '2026-07-01T09:00:00.000Z',
    ...overrides,
  };
}

/**
 * Both `GET /manage/attendance/my-classes` and `GET /manage/announcements/mine`
 * go through the same `api.get` — a blanket `mockResolvedValue` would answer
 * both calls identically and either crash the announcements list (wrong
 * shape) or produce duplicate error text. Route by path instead, mirroring
 * the pattern the mobile `post.test.tsx` already uses.
 */
function mockGet(routes: { classes?: unknown; error?: Error; mine?: AnnouncementMine[] | Error }) {
  return vi.fn().mockImplementation((path: string) => {
    if (path === '/manage/attendance/my-classes') {
      if (routes.error) return Promise.reject(routes.error);
      return Promise.resolve(routes.classes ?? []);
    }
    if (path === '/manage/announcements/mine') {
      if (routes.mine instanceof Error) return Promise.reject(routes.mine);
      return Promise.resolve(routes.mine ?? []);
    }
    throw new Error(`unexpected path: ${path}`);
  });
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
    const api = mockApi({
      get: vi.fn().mockImplementation((path: string) => {
        if (path === '/manage/attendance/my-classes') return pending;
        return Promise.resolve([]);
      }),
    });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(screen.getByText('Loading your classes…')).toBeInTheDocument();
    resolveClasses([]);
  });

  it('renders the server error message when the class list fails to load', async () => {
    const api = mockApi({ get: mockGet({ error: new Error('Class service is unavailable') }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('Class service is unavailable')).toBeInTheDocument();
  });

  it('renders an explicit empty state when the teacher has no classes', async () => {
    const api = mockApi({ get: mockGet({ classes: [] }) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();

    expect(await screen.findByText('No classes assigned to you yet — ask your admin.')).toBeInTheDocument();
  });

  it('offers only owned classes — a covering:true section is excluded', async () => {
    const api = mockApi({
      get: mockGet({
        classes: [
          classSection({ classSectionId: 'sec-1', name: '8-A', covering: false }),
          classSection({ classSectionId: 'sec-2', name: '9-B', covering: true }),
        ],
      }),
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
    const api = mockApi({ get: mockGet({ classes: [classSection()] }) });
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
    const api = mockApi({ get: mockGet({ classes: [classSection()] }) });
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
      get: mockGet({ classes: [classSection()] }),
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
      get: mockGet({ classes: [classSection()] }),
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

  it('a successful post also refreshes the "Your recent posts" list', async () => {
    const user = userEvent.setup();
    const get = mockGet({ classes: [classSection()], mine: [] });
    const api = mockApi({ get, post: vi.fn().mockResolvedValue([{ id: 'a1' }]) });
    vi.mocked(useApi).mockReturnValue(api as never);

    renderPage();
    await screen.findByRole('button', { name: '8-A' });
    await screen.findByText("You haven't posted anything yet.");

    const callsBefore = get.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;

    await user.click(screen.getByRole('button', { name: '8-A' }));
    await user.type(screen.getByLabelText('Title'), 'Reminder');
    await user.type(screen.getByLabelText('Details'), 'Bring your workbook tomorrow.');
    await user.click(screen.getByRole('button', { name: /post to 1 class/i }));

    await screen.findByText('Posted to 1 class');

    await vi.waitFor(() => {
      const callsAfter = get.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });
  });

  it('renders the server message verbatim on a 403 CLASS_NOT_OWNED', async () => {
    const user = userEvent.setup();
    const api = mockApi({
      get: mockGet({ classes: [classSection()] }),
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
      get: mockGet({ classes: [classSection()] }),
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

  it('caps title and body at the lengths the server DTO accepts', async () => {
    // CreateAnnouncementDto declares @Length(1, 160) on title and
    // @Length(1, 4000) on body. Without maxLength here a teacher can paste a
    // long notice, press Post, and only learn it was too long from a failed
    // round-trip — with the typed text still sitting in the box.
    //
    // These numbers are duplicated from the DTO rather than imported because
    // class-validator's constraints are not reachable as values from the web
    // app. If the DTO ever changes, this test is the thing that should fail.
    const api = mockApi({ get: mockGet({ classes: [classSection()] }) });
    vi.mocked(useApi).mockReturnValue(api as never);
    renderWithProviders(<TeacherAnnouncementsPage />);

    expect(await screen.findByLabelText('Title')).toHaveAttribute('maxLength', '160');
    expect(screen.getByLabelText('Details')).toHaveAttribute('maxLength', '4000');
  });

  // ── "Your recent posts" — GET /manage/announcements/mine ─────────────────
  describe('your recent posts', () => {
    it('renders a loading state while the list is fetching', () => {
      let resolveMine!: (v: AnnouncementMine[]) => void;
      const pending = new Promise<AnnouncementMine[]>((resolve) => {
        resolveMine = resolve;
      });
      const api = mockApi({
        get: vi.fn().mockImplementation((path: string) => {
          if (path === '/manage/announcements/mine') return pending;
          return Promise.resolve([]);
        }),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();

      expect(screen.getByText('Loading your posts…')).toBeInTheDocument();
      resolveMine([]);
    });

    it('renders the server error message verbatim when the list fails to load', async () => {
      const api = mockApi({
        get: mockGet({ classes: [], mine: new Error('Announcements service is unavailable') }),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();

      expect(await screen.findByText('Announcements service is unavailable')).toBeInTheDocument();
    });

    it('renders an explicit empty state when the teacher has posted nothing', async () => {
      const api = mockApi({ get: mockGet({ classes: [], mine: [] }) });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();

      expect(await screen.findByText("You haven't posted anything yet.")).toBeInTheDocument();
    });

    it('renders each post with its class name (or "Whole school") and body', async () => {
      const api = mockApi({
        get: mockGet({
          classes: [],
          mine: [
            announcement({ id: 'ann-1', title: 'Class notice', className: '8-A' }),
            announcement({ id: 'ann-2', title: 'School notice', classSectionId: null, className: null }),
          ],
        }),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();

      expect(await screen.findByText('Class notice')).toBeInTheDocument();
      expect(screen.getByText('School notice')).toBeInTheDocument();
      expect(screen.getByText('8-A')).toBeInTheDocument();
      expect(screen.getByText('Whole school')).toBeInTheDocument();
    });

    it('editing a post pre-fills the form, saves via PATCH, and refreshes the list', async () => {
      const user = userEvent.setup();
      const get = vi.fn().mockImplementation((path: string) => {
        if (path === '/manage/announcements/mine') return Promise.resolve([announcement()]);
        return Promise.resolve([]);
      });
      const api = mockApi({ get, patch: vi.fn().mockResolvedValue({ ...announcement(), title: 'Fixed typo' }) });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Reminder');

      const callsBefore = get.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;

      await user.click(screen.getByRole('button', { name: 'Edit' }));

      const titleInput = screen.getByLabelText('Title') as HTMLInputElement;
      expect(titleInput.value).toBe('Reminder');
      await user.clear(titleInput);
      await user.type(titleInput, 'Fixed typo');
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(api.patch).toHaveBeenCalledWith('/manage/announcements/ann-1', {
        title: 'Fixed typo',
        body: 'Bring your workbook tomorrow.',
      });
      expect(await screen.findByText('Announcement updated')).toBeInTheDocument();

      await vi.waitFor(() => {
        const callsAfter = get.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;
        expect(callsAfter).toBeGreaterThan(callsBefore);
      });
    });

    it('cancelling an edit discards changes and leaves the row unchanged', async () => {
      const user = userEvent.setup();
      const api = mockApi({ get: mockGet({ classes: [], mine: [announcement()] }) });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Reminder');

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.clear(screen.getByLabelText('Title'));
      await user.type(screen.getByLabelText('Title'), 'Discarded');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.getByText('Reminder')).toBeInTheDocument();
      expect(screen.queryByText('Discarded')).not.toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
    });

    it('shows the server message verbatim when an edit is rejected', async () => {
      const user = userEvent.setup();
      const api = mockApi({
        get: mockGet({ classes: [], mine: [announcement()] }),
        patch: vi.fn().mockRejectedValue(new Error('You can only edit your own announcements')),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Reminder');

      await user.click(screen.getByRole('button', { name: 'Edit' }));
      await user.click(screen.getByRole('button', { name: 'Save' }));

      expect(await screen.findByText('You can only edit your own announcements')).toBeInTheDocument();
    });

    it('deleting a post opens a real confirm dialog — no request fires until confirmed', async () => {
      const user = userEvent.setup();
      const api = mockApi({ get: mockGet({ classes: [], mine: [announcement()] }) });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Reminder');

      await user.click(screen.getByRole('button', { name: 'Delete' }));

      const dialog = await screen.findByRole('dialog', { name: 'Delete this announcement?' });
      expect(within(dialog).getByText(/"Reminder" will be removed/)).toBeInTheDocument();
      expect(api.del).not.toHaveBeenCalled();
    });

    it('confirming the delete dialog calls DELETE and refreshes the list', async () => {
      const user = userEvent.setup();
      const get = vi.fn().mockImplementation((path: string) => {
        if (path === '/manage/announcements/mine') return Promise.resolve([announcement()]);
        return Promise.resolve([]);
      });
      const api = mockApi({ get, del: vi.fn().mockResolvedValue({ ok: true }) });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Reminder');

      const callsBefore = get.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this announcement?' });
      await user.click(within(dialog).getByRole('button', { name: 'Yes, delete' }));

      expect(api.del).toHaveBeenCalledWith('/manage/announcements/ann-1');
      expect(await screen.findByText('Announcement deleted')).toBeInTheDocument();

      await vi.waitFor(() => {
        const callsAfter = get.mock.calls.filter((c: unknown[]) => c[0] === '/manage/announcements/mine').length;
        expect(callsAfter).toBeGreaterThan(callsBefore);
      });
    });

    it('cancelling the delete dialog fires no request', async () => {
      const user = userEvent.setup();
      const api = mockApi({ get: mockGet({ classes: [], mine: [announcement()] }) });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Reminder');

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this announcement?' });
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(api.del).not.toHaveBeenCalled();
    });

    it('shows the server message verbatim when a delete is rejected', async () => {
      const user = userEvent.setup();
      const api = mockApi({
        get: mockGet({ classes: [], mine: [announcement()] }),
        del: vi.fn().mockRejectedValue(new Error('You can only delete your own announcements')),
      });
      vi.mocked(useApi).mockReturnValue(api as never);

      renderPage();
      await screen.findByText('Reminder');

      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete this announcement?' });
      await user.click(within(dialog).getByRole('button', { name: 'Yes, delete' }));

      expect(await screen.findByText('You can only delete your own announcements')).toBeInTheDocument();
    });
  });
});
