import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useAuthStore } from '@/lib/auth-store';
import StaffLayout from './layout';
import { NAV_ITEMS } from './nav-items';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceMock }),
  usePathname: () => '/staff',
}));

const STAFF_DIR = dirname(fileURLToPath(import.meta.url));

function realStaffRoutes(): Set<string> {
  return new Set(
    readdirSync(STAFF_DIR).filter((name) => statSync(join(STAFF_DIR, name)).isDirectory()),
  );
}

function mockApi(role: string | null): ApiStub {
  return {
    get: vi.fn(() => (role === null ? new Promise(() => {}) : Promise.resolve({ role }))),
    post: vi.fn().mockResolvedValue({}),
    put: vi.fn(),
    patch: vi.fn(),
    del: vi.fn(),
  };
}

describe('staff nav honesty', () => {
  it('every NAV_ITEMS href points at a route that exists as a directory under apps/web/app/staff, or is the layout\'s own index', () => {
    const routes = realStaffRoutes();
    for (const { href } of NAV_ITEMS) {
      if (href === '/staff') continue; // the layout's own index page
      const segment = href.replace(/^\/staff\//, '');
      expect(routes.has(segment)).toBe(true);
    }
  });
});

describe('StaffLayout — role guard', () => {
  beforeEach(() => {
    replaceMock.mockClear();
    vi.mocked(useHost).mockReturnValue('school.sckools.com');
  });

  afterEach(() => {
    useAuthStore.setState({ status: 'unknown', audience: undefined, accessToken: undefined, refreshToken: undefined, role: undefined });
  });

  it('redirects an unauthenticated session to /login', async () => {
    useAuthStore.setState({ status: 'anon', audience: undefined });
    vi.mocked(useApi).mockReturnValue(mockApi(null) as never);

    renderWithProviders(
      <StaffLayout>
        <div>content</div>
      </StaffLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/login'));
  });

  it('redirects a TEACHER session to /teacher — an admin/teacher session must never sit inside the staff portal', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('TEACHER') as never);

    renderWithProviders(
      <StaffLayout>
        <div>content</div>
      </StaffLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/teacher'));
  });

  it('redirects a STUDENT session to /portal', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('STUDENT') as never);

    renderWithProviders(
      <StaffLayout>
        <div>content</div>
      </StaffLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/portal'));
  });

  it('redirects a SCHOOL_ADMIN session to /app', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('SCHOOL_ADMIN') as never);

    renderWithProviders(
      <StaffLayout>
        <div>content</div>
      </StaffLayout>,
    );

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app'));
  });

  it('does NOT redirect a STAFF session — it belongs here', async () => {
    useAuthStore.setState({ status: 'authed', audience: 'school' });
    vi.mocked(useApi).mockReturnValue(mockApi('STAFF') as never);

    renderWithProviders(
      <StaffLayout>
        <div>staff home content</div>
      </StaffLayout>,
    );

    // Once the `me` query resolves STAFF, the shell renders its child
    // (proving the layout actually settled, not just that no redirect fired
    // yet) and no redirect ever happens.
    await waitFor(() => expect(screen.getByText('staff home content')).toBeInTheDocument());
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
