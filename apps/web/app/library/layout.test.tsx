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

function mockApi(role: string | null): ApiStub {
  return {
    get: vi.fn(() => (role === null ? new Promise(() => {}) : Promise.resolve({ role }))),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
}

/**
 * The counter's gate. Chrome, not authorization — the API's
 * `RolesGuard + @Roles('SCHOOL_ADMIN','LIBRARIAN')` is what protects the data.
 * What this proves is that nobody is shown a console that would refuse
 * everything they touched, and that the two roles who belong here are not
 * bounced out of it.
 */
describe('LibraryLayout — role guard', () => {
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

  it('redirects an unauthenticated session to /login', async () => {
    useAuthStore.setState({ status: 'anon', audience: undefined });
    vi.mocked(useApi).mockReturnValue(mockApi(null) as never);

    renderWithProviders(
      <LibraryLayout>
        <div>content</div>
      </LibraryLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  it('does NOT redirect a LIBRARIAN — this is her portal', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('LIBRARIAN') as never);

    renderWithProviders(
      <LibraryLayout>
        <div>counter content</div>
      </LibraryLayout>,
    );

    // Rendering the child proves the layout settled, rather than merely that
    // no redirect had fired yet.
    await waitFor(() => expect(screen.getByText('counter content')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does NOT redirect a SCHOOL_ADMIN — she sets the library up and stands in', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('SCHOOL_ADMIN') as never);

    renderWithProviders(
      <LibraryLayout>
        <div>counter content</div>
      </LibraryLayout>,
    );

    await waitFor(() => expect(screen.getByText('counter content')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('sends a TEACHER back to /teacher', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('TEACHER') as never);

    renderWithProviders(
      <LibraryLayout>
        <div>content</div>
      </LibraryLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/teacher'));
  });

  it('sends a STUDENT back to /portal — the counter is not a borrower screen', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('STUDENT') as never);

    renderWithProviders(
      <LibraryLayout>
        <div>content</div>
      </LibraryLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/portal'));
  });

  it('sends a STAFF session to /staff', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('STAFF') as never);

    renderWithProviders(
      <LibraryLayout>
        <div>content</div>
      </LibraryLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/staff'));
  });
});
