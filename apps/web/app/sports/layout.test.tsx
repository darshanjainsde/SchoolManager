import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { useAuthStore } from '@/lib/auth-store';
import SportsLayout from './layout';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
// The classifier reads NEXT_PUBLIC_* env that vitest does not set; decide it here.
vi.mock('@/lib/hosts', () => ({ isSchoolHost: (h: string | null) => !!h && h !== 'sckools.com', exampleSchoolHost: () => 'raffles.sckools.com' }));

const replaceMock = vi.fn();
let pathname = '/sports';
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceMock }), usePathname: () => pathname }));

function mockApi(me: { role: string; staffRole?: string | null } | null): ApiStub {
  return {
    get: vi.fn(() => (me === null ? new Promise(() => {}) : Promise.resolve({ name: 'Green Valley', ...me }))),
    post: vi.fn().mockResolvedValue({}), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
}

function render(me: { role: string; staffRole?: string | null } | null) {
  useAuthStore.setState({ status: 'authed', audience: 'school' });
  vi.mocked(useApi).mockReturnValue(mockApi(me) as never);
  renderWithProviders(<SportsLayout><div>desk content</div></SportsLayout>);
}

beforeEach(() => {
  replaceMock.mockClear();
  pathname = '/sports';
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});
afterEach(() => {
  useAuthStore.setState({ status: 'unknown', audience: undefined, accessToken: undefined, refreshToken: undefined, role: undefined });
});

describe('SportsLayout — who may stand at the desk', () => {
  it('sends an admin to the console tab, keeping the section', async () => {
    pathname = '/sports/records';
    render({ role: 'SCHOOL_ADMIN' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/app/sports/records'));
  });

  it('keeps a sports teacher here and shows the desk', async () => {
    render({ role: 'STAFF', staffRole: 'SPORTS' });
    expect(await screen.findByText('desk content')).toBeInTheDocument();
    expect(screen.getByText('The sports desk')).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('sends office staff, the librarian, a teacher and a student to their own portals', async () => {
    render({ role: 'STAFF', staffRole: 'OFFICE' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/staff'));
    replaceMock.mockClear();
    render({ role: 'STAFF', staffRole: 'LIBRARIAN' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/library'));
    replaceMock.mockClear();
    render({ role: 'TEACHER' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/teacher'));
    replaceMock.mockClear();
    render({ role: 'STUDENT' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/portal'));
  });

  it('off a school host, explains where the desk lives instead of rendering it', async () => {
    vi.mocked(useHost).mockReturnValue('sckools.com');
    render({ role: 'STAFF', staffRole: 'SPORTS' });
    // The layout renders nothing until the hydration effect has run.
    expect(await screen.findByText(/Open the sports desk at your school/)).toBeInTheDocument();
    expect(screen.queryByText('desk content')).toBeNull();
  });
});
