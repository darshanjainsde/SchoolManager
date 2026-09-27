import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { SwitchProfile } from './switch-profile';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }), usePathname: () => '/portal' }));
vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const setTokens = vi.fn(); const setMe = vi.fn();
vi.mock('@/lib/auth-store', () => ({ useAuthStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ setTokens, setMe, refreshToken: null }) }));

const ravi = { userId: 'u-ravi', kind: 'FAMILY', role: 'STUDENT', label: 'Ravi Sharma', sub: 'Class 5-B', schoolName: 'Raffles', host: 'raffles.sckools.com' };
const priya = { userId: 'u-priya', kind: 'TEACHER', role: 'TEACHER', label: 'Priya Nair', sub: 'Teacher', schoolName: 'Raffles', host: 'raffles.sckools.com' };
const arjun = { userId: 'u-arjun', kind: 'FAMILY', role: 'STUDENT', label: 'Arjun Sharma', sub: 'Class 3-A', schoolName: 'Beacon High', host: 'beacon.sckools.com' };

function stub(profiles: unknown[], current = 'u-ravi') {
  const api = {
    get: vi.fn(async (path: string) => (path === '/auth/profiles' ? { current, profiles } : { userId: 'u-priya', role: 'TEACHER', staffRole: null })),
    post: vi.fn().mockResolvedValue({ accessToken: 'a2', refreshToken: 'r2' }), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  vi.mocked(useApi).mockReturnValue(api as unknown as ApiStub as never);
  return api;
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(useHost).mockReturnValue('raffles.sckools.com'); });

describe('SwitchProfile', () => {
  it('renders nothing when the number opens only this profile', async () => {
    stub([ravi]);
    renderWithProviders(<SwitchProfile />);
    await waitFor(() => expect(vi.mocked(useApi)).toHaveBeenCalled());
    expect(screen.queryByTestId('switch-profile')).toBeNull();
  });

  it('lists the other profiles; a same-host pick swaps the session and lands on that role\'s home', async () => {
    const api = stub([ravi, priya, arjun]);
    renderWithProviders(<SwitchProfile />);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch profile' }));
    const items = screen.getAllByRole('option').map((o) => o.textContent);
    expect(items[0]).toContain('Priya Nair');
    expect(items[1]).toContain('Arjun Sharma');
    expect(items[1]).toContain('opens that school');
    fireEvent.click(screen.getByText('Priya Nair'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/switch', { userId: 'u-priya' }));
    await waitFor(() => expect(setTokens).toHaveBeenCalledWith({ accessToken: 'a2', refreshToken: 'r2', audience: 'school' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/teacher'));
  });
});
