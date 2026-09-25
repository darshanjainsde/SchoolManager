import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import StaffProfilePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));

function mockApi(overrides: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.mocked(useHost).mockReturnValue('school.sckools.com');
});

/**
 * Every STAFF kind — driver, guard, librarian, sports teacher — needs one
 * page where they can change their WhatsApp number and their password. The
 * app's worker Profile has had it since the 2026-09-22 audit; this is the
 * same three cards on the web.
 */
describe('StaffProfilePage', () => {
  it('names the person and their job in words, not a code', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({
      get: vi.fn(async (path: string) => (path === '/auth/me' ? { role: 'STAFF', name: 'Sam Kumar', staffRole: 'DRIVER' } : { verified: false, phone: null })),
    }) as never);
    renderWithProviders(<StaffProfilePage />);
    expect(await screen.findByText('Sam Kumar')).toBeInTheDocument();
    expect(screen.getByTestId('staff-profile-name')).toHaveTextContent('Sam Kumar');
    expect(screen.getByText('Driver')).toBeInTheDocument();
  });

  it('names a sports teacher properly rather than falling through to "Staff"', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({
      get: vi.fn(async (path: string) => (path === '/auth/me' ? { role: 'STAFF', name: 'Ravi Menon', staffRole: 'SPORTS' } : { verified: false, phone: null })),
    }) as never);
    renderWithProviders(<StaffProfilePage />);
    expect(await screen.findByText('Sports teacher')).toBeInTheDocument();
  });

  it('carries the WhatsApp number card and the password form', async () => {
    vi.mocked(useApi).mockReturnValue(mockApi({
      get: vi.fn(async (path: string) => (path === '/auth/me' ? { role: 'STAFF', name: 'Sam Kumar', staffRole: 'OFFICE' } : { verified: false, phone: null })),
    }) as never);
    renderWithProviders(<StaffProfilePage />);
    expect(await screen.findByTestId('phone-card')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
  });

  it('refuses a short new password locally instead of spending a round trip on it', async () => {
    const post = vi.fn();
    vi.mocked(useApi).mockReturnValue(mockApi({
      get: vi.fn(async (path: string) => (path === '/auth/me' ? { role: 'STAFF', name: 'Sam', staffRole: 'OFFICE' } : { verified: false, phone: null })),
      post,
    }) as never);
    const user = userEvent.setup();
    renderWithProviders(<StaffProfilePage />);
    await user.type(await screen.findByLabelText('Current password'), 'oldpassword');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(/at least 8 characters/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
