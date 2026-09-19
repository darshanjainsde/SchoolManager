import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { PhoneCard } from './phone-card';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const NONE = { phone: null, verified: false, verifiedAt: null, pending: null, pendingUntil: null, platformReady: true };
const PENDING = { ...NONE, pending: '+91 98••• •3210', pendingUntil: '2026-09-20T10:00:00Z' };
const DONE = { ...NONE, phone: '+91 98••• •3210', verified: true, verifiedAt: '2026-09-20T09:55:00Z' };

function stub(get: unknown) {
  const api = { get: vi.fn().mockResolvedValue(get), post: vi.fn().mockResolvedValue({ ok: true, pending: '+91 98••• •3210' }), put: vi.fn(), patch: vi.fn(), del: vi.fn().mockResolvedValue(NONE) };
  vi.mocked(useApi).mockReturnValue(api as unknown as ApiStub as never);
  return api;
}
beforeEach(() => vi.mocked(useHost).mockReturnValue('raffles.sckools.com'));

describe('PhoneCard', () => {
  it('nothing set → type a number and send the code', async () => {
    const api = stub(NONE);
    renderWithProviders(<PhoneCard role="admin" />);
    expect(await screen.findByTestId('phone-state')).toHaveTextContent('Not set');
    expect(screen.getByText(/Approve \/ Reject buttons that act/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '98765 43210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/phone/request', { phone: '98765 43210' }));
  });

  it('code sent → the verify form, digits only, six of them', async () => {
    const api = stub(PENDING);
    api.post.mockResolvedValueOnce(DONE);
    renderWithProviders(<PhoneCard role="teacher" />);
    expect(await screen.findByTestId('phone-state')).toHaveTextContent('Code sent to +91 98••• •3210');
    const input = screen.getByLabelText('The 6-digit code from WhatsApp');
    fireEvent.change(input, { target: { value: '48a29b11' } });
    expect(input).toHaveValue('482911');
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/me/phone/verify', { code: '482911' }));
    expect(await screen.findByText('Verified · +91 98••• •3210')).toBeInTheDocument();
  });

  it('verified → change or remove', async () => {
    const api = stub(DONE);
    renderWithProviders(<PhoneCard role="admin" />);
    expect(await screen.findByTestId('phone-state')).toHaveTextContent('Verified');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/me/phone'));
  });

  it('says so when the platform has no WhatsApp yet, and disables sending', async () => {
    stub({ ...NONE, platformReady: false });
    renderWithProviders(<PhoneCard role="staff" />);
    expect(await screen.findByTestId('phone-platform-off')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send code' })).toBeDisabled();
  });
});
