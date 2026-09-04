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
let pathname = '/library';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => pathname,
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

beforeEach(() => {
  replaceMock.mockClear();
  pathname = '/library';
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
 * The bug this file has always guarded, in its current form.
 *
 * The library used to be a fourth sibling PORTAL, so the admin console's
 * Library tab swapped the entire shell — and for a while the only control that
 * led anywhere was "Sign out", which ends the session. An admin read that as
 * being thrown out of the product. That was first patched with a "Back to
 * admin" link; the library is now a TAB of the console (`/app/library`, sidebar
 * intact), so an admin has no reason to be in this portal at all and is sent to
 * the tab instead. The link is gone because the situation it apologised for is.
 */
describe('LibraryLayout — an admin belongs in the console tab', () => {
  it('sends a SCHOOL_ADMIN to the console Library tab', async () => {
    render({ role: 'SCHOOL_ADMIN' });

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/library'));
  });

  it('keeps the section when it redirects, so a deep link is not lost', async () => {
    pathname = '/library/counter';
    render({ role: 'SCHOOL_ADMIN' });

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/library/counter'));
  });

  it('no longer offers the apologetic "Back to admin" link', async () => {
    render({ role: 'SCHOOL_ADMIN' });

    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(screen.queryByRole('link', { name: /back to admin/i })).not.toBeInTheDocument();
    expect(screen.queryByText('Visiting as admin')).not.toBeInTheDocument();
  });
});

/**
 * The librarian LIVES here — `homeForRole` sends her straight to /library on
 * login, and `app/app/layout.tsx` is SCHOOL_ADMIN-only so the console tab is a
 * door she cannot walk through. She must never be redirected off her own
 * workplace, and she must get the same sections the admin sees.
 */
describe('LibraryLayout — the librarian stays', () => {
  it('renders the library for a STAFF/LIBRARIAN and redirects nowhere', async () => {
    render({ role: 'STAFF', staffRole: 'LIBRARIAN' });

    await waitFor(() => expect(screen.getByText('library content')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('gives her the same six sections, pointed at her own portal', async () => {
    render({ role: 'STAFF', staffRole: 'LIBRARIAN' });

    const nav = await screen.findByRole('navigation', { name: 'Library sections' });
    const hrefs = [...nav.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/library',
      '/library/counter',
      '/library/hall',
      '/library/books',
      '/library/fines',
      '/library/settings',
    ]);
  });

  it('keeps her own way out — the topbar sign-out, not the console', async () => {
    render({ role: 'STAFF', staffRole: 'LIBRARIAN' });

    expect(await screen.findByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});

describe('LibraryLayout — role guard', () => {
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
