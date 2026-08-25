import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useAuthStore } from '@/lib/auth-store';
import LibraryLayout from './layout';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/library',
}));

function mockApi(me: { role: string; staffRole?: string | null } | null): ApiStub {
  return {
    get: vi.fn(() =>
      me === null ? new Promise(() => {}) : Promise.resolve({ name: 'Green Valley', ...me }),
    ),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
}

function render(me: { role: string; staffRole?: string | null } | null) {
  useAuthStore.setState({ status: 'authed', audience: 'school' });
  vi.mocked(useApi).mockReturnValue(mockApi(me) as never);
  renderWithProviders(
    <LibraryLayout>
      <div>library content</div>
    </LibraryLayout>,
  );
}

describe('LibraryLayout — the way back out', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    vi.mocked(useHost).mockReturnValue('school.sckools.com');
  });

  afterEach(() => {
    useAuthStore.setState({
      status: 'unknown',
      audience: undefined,
      accessToken: undefined,
      refreshToken: undefined,
      role: undefined,
    });
  });

  /**
   * The bug this guards. The admin console's Library tab is the only one that
   * leaves the /app segment, so clicking it swaps the entire shell. Before
   * this, the only control that led anywhere was "Sign out" — so an admin
   * wanting to go back to their console had to end their session to do it, and
   * read the whole thing as being thrown out of the product.
   */
  it('offers a SCHOOL_ADMIN a link back to the console', async () => {
    render({ role: 'SCHOOL_ADMIN' });

    const back = await screen.findByRole('link', { name: /back to admin/i });
    expect(back).toHaveAttribute('href', '/app');
  });

  it('tells a visiting admin whose desk they are standing at', async () => {
    render({ role: 'SCHOOL_ADMIN' });

    expect(await screen.findByText('Visiting as admin')).toBeInTheDocument();
  });

  /**
   * The librarian LIVES here — `homeForRole` sends her straight to /library on
   * login and there is no console for her to return to, so the way back would
   * be a door onto a wall.
   */
  it('does not offer the librarian a way "back" to a console she has no access to', async () => {
    render({ role: 'STAFF', staffRole: 'LIBRARIAN' });

    await waitFor(() => expect(screen.getByText('library content')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /back to admin/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Visiting as admin')).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});

describe('LibraryLayout — role guard', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    vi.mocked(useHost).mockReturnValue('school.sckools.com');
  });

  afterEach(() => {
    useAuthStore.setState({ status: 'unknown', audience: undefined, role: undefined });
  });

  it('redirects an unauthenticated session to /login', async () => {
    useAuthStore.setState({ status: 'anon', audience: undefined });
    vi.mocked(useApi).mockReturnValue(mockApi(null) as never);

    renderWithProviders(
      <LibraryLayout>
        <div>library content</div>
      </LibraryLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  it('bounces a non-librarian STAFF login to its own portal', async () => {
    render({ role: 'STAFF', staffRole: 'OFFICE' });

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/staff'));
  });

  it('bounces a TEACHER to /teacher', async () => {
    render({ role: 'TEACHER' });

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/teacher'));
  });

  it('bounces a STUDENT to /portal', async () => {
    render({ role: 'STUDENT' });

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/portal'));
  });
});
