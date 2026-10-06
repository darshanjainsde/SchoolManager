import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import AdminLayout from './layout';

/**
 * The menu stays empty until /auth/me answers, so an officer never glimpses the
 * admin menu — but the PAGE renders at once, so admin cold loads do not wait on
 * /auth/me before their own queries start.
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
const state = vi.hoisted(() => ({ status: 'authed', accessToken: 'tok' as string | null, audience: 'school' as string | null, clear: () => undefined }));
vi.mock('@/lib/auth-store', async (orig) => {
  const mod = await orig<typeof import('@/lib/auth-store')>();
  const useAuthStore = ((sel: (s: typeof state) => unknown) => sel(state)) as unknown as typeof mod.useAuthStore;
  return { ...mod, useAuthStore };
});

function mockApi(me: Promise<unknown>): ApiStub {
  return { get: vi.fn(() => me), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() };
}

function setSession(s: { status: string; accessToken: string | null; audience: string | null }) {
  Object.assign(state, s);
}

beforeEach(() => {
  vi.clearAllMocks();
  setSession({ status: 'authed', accessToken: 'tok', audience: 'school' });
});

// Top-level admin links (group members sit inside closed accordions).
const adminLinks = () => screen.queryAllByRole('link', { name: /^(Dashboard|Fees|Announcements)/ });

describe('/app layout and /auth/me', () => {
  it('while /auth/me is in flight: no admin menu, but the page IS rendered (its queries run in parallel)', async () => {
    let release!: (v: unknown) => void;
    const pending = new Promise((r) => { release = r; });
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(pending));
    renderWithProviders(<AdminLayout><p>ADMIN PAGE BODY</p></AdminLayout>);
    expect(screen.getByText('ADMIN PAGE BODY')).toBeTruthy();
    expect(adminLinks()).toEqual([]);
    release({ role: 'SCHOOL_ADMIN', features: [], name: 'Asha' });
    await waitFor(() => expect(adminLinks().length).toBeGreaterThan(0));
  });

  it('with no session the query is disabled and the layout does not sit on a skeleton', () => {
    setSession({ status: 'anon', accessToken: null, audience: null });
    const api = mockApi(new Promise(() => undefined));
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(api);
    renderWithProviders(<AdminLayout><p>ADMIN PAGE BODY</p></AdminLayout>);
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a school admin gets the full menu once me arrives, and is never bounced', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(Promise.resolve({ role: 'SCHOOL_ADMIN', features: ['FEES', 'ENQUIRY'], name: 'Asha' })));
    renderWithProviders(<AdminLayout><p>ADMIN PAGE BODY</p></AdminLayout>);
    await waitFor(() => expect(adminLinks().length).toBeGreaterThan(0));
    expect(screen.getAllByRole('link', { name: /^Fees/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('profile-door')[0]!.getAttribute('href')).toBe('/app/profile');
    expect(replace).not.toHaveBeenCalled();
  });

  it('an admissions officer gets only the enquiries door and is sent to the desk', async () => {
    (useApi as ReturnType<typeof vi.fn>).mockReturnValue(mockApi(Promise.resolve({ role: 'STAFF', staffRole: 'ADMISSIONS', features: ['ENQUIRY'], name: 'Ira' })));
    renderWithProviders(<AdminLayout><p>ADMIN PAGE BODY</p></AdminLayout>);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/enquiries'));
    await waitFor(() => expect(screen.getAllByRole('link', { name: /Enquiries/ }).length).toBeGreaterThan(0));
    expect(adminLinks()).toEqual([]);
    expect(screen.getAllByTestId('profile-door')[0]!.getAttribute('href')).toBe('/staff/profile');
  });
});
