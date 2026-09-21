import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import AdminProfilePage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const ME = { userId: 'u1', role: 'SCHOOL_ADMIN', email: 'admin@raffles.test', name: null, notifyPrefs: { leave: true, register: true, fees: false, enquiry: true, summary: true } };
const PHONE = { phone: null, verified: false, verifiedAt: null, pending: null, pendingUntil: null, platformReady: true };

function stub() {
  const api = {
    get: vi.fn((path: string) => (path === '/me/profile' ? Promise.resolve(ME) : path === '/me/phone' ? Promise.resolve(PHONE) : Promise.reject(new Error(`Unexpected GET ${path}`)))),
    post: vi.fn().mockResolvedValue({}), put: vi.fn(),
    patch: vi.fn().mockImplementation((_p: string, body: Record<string, unknown>) => Promise.resolve({ ...ME, ...(body.name !== undefined ? { name: body.name } : {}), notifyPrefs: { ...ME.notifyPrefs, ...((body.notifyPrefs as object) ?? {}) } })),
    del: vi.fn(),
  };
  vi.mocked(useApi).mockReturnValue(api as unknown as ApiStub as never);
  return api;
}
beforeEach(() => vi.mocked(useHost).mockReturnValue('raffles.sckools.com'));

describe('AdminProfilePage', () => {
  it('shows the login, saves a name, and mounts the WhatsApp number card here (not in Settings)', async () => {
    const api = stub();
    renderWithProviders(<AdminProfilePage />);
    const you = await screen.findByTestId('profile-you');
    expect(await within(you).findByText('admin@raffles.test')).toBeInTheDocument();
    expect(within(you).getByText('No name yet')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Darshan Jain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/me/profile', { name: 'Darshan Jain' }));
    expect(await within(you).findByText('Darshan Jain')).toBeInTheDocument();
    expect(await screen.findByTestId('phone-card')).toBeInTheDocument();
  });

  it('each WhatsApp switch reflects the stored value and patches only its own key', async () => {
    const api = stub();
    renderWithProviders(<AdminProfilePage />);
    const prefs = await screen.findByTestId('profile-prefs');
    const fees = within(prefs).getByRole('switch', { name: 'Fee payment proofs' });
    await waitFor(() => expect(fees).not.toBeDisabled());
    expect(fees).not.toBeChecked();
    expect(within(prefs).getByRole('switch', { name: 'Leave requests' })).toBeChecked();
    fireEvent.click(fees);
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/me/profile', { notifyPrefs: { fees: true } }));
  });

  it('the password form posts to the same route the teacher page uses and needs 8+ characters', async () => {
    const api = stub();
    renderWithProviders(<AdminProfilePage />);
    await screen.findByTestId('profile-you');
    const pw = screen.getByTestId('profile-password');
    fireEvent.change(within(pw).getByLabelText('Current password'), { target: { value: 'old-pass-1' } });
    fireEvent.change(within(pw).getByLabelText('New password'), { target: { value: 'short' } });
    expect(within(pw).getByRole('button', { name: 'Change password' })).toBeDisabled();
    fireEvent.change(within(pw).getByLabelText('New password'), { target: { value: 'long-enough-1' } });
    fireEvent.click(within(pw).getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-pass-1', newPassword: 'long-enough-1' }));
  });
});
