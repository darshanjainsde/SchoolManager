import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import AdminLayout from './layout';

/**
 * No admin chrome before /auth/me answers: an officer must not glimpse the full
 * admin menu, and a deep link must not mount an admin page (admin queries 403)
 * before the bounce runs.
 */
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/lib/use-session-probe', () => ({ useSessionProbe: () => undefined }));
vi.mock('@/components/use-host', () => ({ useHost: () => 'raffles.test' }));
vi.mock('@/lib/use-hydrated', () => ({ useHydrated: () => true }));
vi.mock('@/components/use-school-mark', () => ({ useSchoolMark: () => undefined }));
vi.mock('@/lib/hosts', async (orig) => ({ ...(await orig<typeof import('@/lib/hosts')>()), isSchoolHost: () => true }));
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/app/students',
}));
vi.mock('@/lib/auth-store', async (orig) => {
  const mod = await orig<typeof import('@/lib/auth-store')>();
  const state = { status: 'authed', accessToken: 'tok', audience: 'school', clear: vi.fn() };
  const useAuthStore = ((sel: (s: typeof state) => unknown) => sel(state)) as unknown as typeof mod.useAuthStore;
  return { ...mod, useAuthStore };
});

function mockApi(me: Promise<unknown>): ApiStub {
  return { get: vi.fn(() => me), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('/app layout before /auth/me resolves', () => {
  it('shows the skeleton, not the menu or the page, until the role is known', async () => {
    let release!: (v: unknown) => void;
    const pending = new Promise((r) => { release = r; });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(pending));
    renderWithProviders(<AdminLayout><p>ADMIN PAGE BODY</p></AdminLayout>);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('ADMIN PAGE BODY')).toBeNull();
    expect(screen.queryByTestId('profile-door')).toBeNull();
    release({ role: 'SCHOOL_ADMIN', features: [], name: 'Asha' });
    await waitFor(() => expect(screen.getByText('ADMIN PAGE BODY')).toBeTruthy());
  });

  it('an admissions officer then sees only the enquiries door and is sent to the desk', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(Promise.resolve({ role: 'STAFF', staffRole: 'ADMISSIONS', features: ['ENQUIRY'], name: 'Ira' })));
    renderWithProviders(<AdminLayout><p>ADMIN PAGE BODY</p></AdminLayout>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/enquiries'));
    expect(screen.getAllByRole('link', { name: /Enquiries/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /^Students/ })).toBeNull();
    expect(screen.getAllByTestId('profile-door')[0]!.getAttribute('href')).toBe('/staff/profile');
  });
});
