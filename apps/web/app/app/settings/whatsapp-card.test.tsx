import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { WhatsAppCard } from './whatsapp-card';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BASE = {
  settings: { enabled: false, phoneNumberId: null },
  platform: { configured: true, senderPhoneNumberId: '1357286177463978' },
  templates: [{ kind: 'ABSENCE_NOTICE', name: 'sckools_absence_notice', body: '{{1}}: {{2}} was marked absent on {{3}}.' }],
  thisMonth: { SENT: 3, READ: 2, FAILED: 1 },
  recent: [
    { id: 'a', phone: '+91 98••• •3210', kind: 'ABSENCE_NOTICE', status: 'READ', error: null, createdAt: '2026-09-20T05:00:00Z', deliveredAt: null, readAt: '2026-09-20T05:30:00Z' },
    { id: 'b', phone: '+91 91••• •6789', kind: 'TEST', status: 'FAILED', error: 'Message undeliverable (code 131026)', createdAt: '2026-09-20T04:00:00Z', deliveredAt: null, readAt: null },
  ],
};

function stub(payload: Record<string, unknown>) {
  const api = { get: vi.fn().mockResolvedValue(payload), put: vi.fn().mockResolvedValue({ ...payload, settings: { ...(payload.settings as object), enabled: true } }), post: vi.fn().mockResolvedValue({ ok: true, phone: '+91 98••• •3210' }), patch: vi.fn(), del: vi.fn() };
  vi.mocked(useApi).mockReturnValue(api as unknown as ApiStub as never);
  return api;
}
beforeEach(() => vi.mocked(useHost).mockReturnValue('raffles.sckools.com'));

describe('WhatsAppCard', () => {
  it('shows the switch, the month, receipts with the reason for a failure, and turns on with one tick', async () => {
    const api = stub(BASE);
    renderWithProviders(<WhatsAppCard />);
    expect(await screen.findByTestId('whatsapp-state')).toHaveTextContent('Off');
    expect(screen.getByTestId('whatsapp-month')).toHaveTextContent('6');
    expect(screen.getByTestId('whatsapp-recent')).toHaveTextContent('Message undeliverable (code 131026)');
    expect(screen.getByTestId('whatsapp-recent')).toHaveTextContent('+91 98••• •3210');
    fireEvent.click(screen.getByTestId('whatsapp-toggle'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manage/whatsapp-settings', { enabled: true }));
    expect(await screen.findByText('On — families receive WhatsApp')).toBeInTheDocument();
  });

  it('says plainly when the platform number is not connected, and disables the test send', async () => {
    stub({ ...BASE, settings: { enabled: true, phoneNumberId: null }, platform: { configured: false, senderPhoneNumberId: null }, recent: [], thisMonth: {} });
    renderWithProviders(<WhatsAppCard />);
    expect(await screen.findByTestId('whatsapp-state')).toHaveTextContent('waiting for the platform number');
    expect(screen.getByText(/not connected yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send test' })).toBeDisabled();
    expect(screen.getByTestId('whatsapp-empty')).toBeInTheDocument();
  });

  it('sends a test to the number typed', async () => {
    const api = stub(BASE);
    renderWithProviders(<WhatsAppCard />);
    await screen.findByTestId('whatsapp-state');
    fireEvent.change(screen.getByLabelText('Send a test to'), { target: { value: '98765 43210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send test' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/whatsapp-settings/test', { to: '98765 43210' }));
  });
});
