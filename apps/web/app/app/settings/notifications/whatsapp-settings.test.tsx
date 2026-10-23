import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { ApiError } from '@/lib/api';
import { useHost } from '@/components/use-host';
import { WhatsAppSettings as WhatsAppCard } from './whatsapp-settings';

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

describe('WhatsApp settings', () => {
  it('shows the switch and the month, keeps the log behind a button, and turns on with one tick', async () => {
    const api = stub(BASE);
    renderWithProviders(<WhatsAppCard />);
    expect(await screen.findByTestId('whatsapp-state')).toHaveTextContent('Off');
    expect(screen.getByTestId('whatsapp-month')).toHaveTextContent('6');
    // The log is never on the page until asked for (settings audit, 11 Oct 2026).
    expect(screen.queryByTestId('whatsapp-recent')).toBeNull();
    fireEvent.click(screen.getByTestId('whatsapp-open-log'));
    expect(await screen.findByTestId('whatsapp-recent')).toHaveTextContent('Message undeliverable (code 131026)');
    expect(screen.getByTestId('whatsapp-recent')).toHaveTextContent('+91 98••• •3210');
    fireEvent.click(screen.getByTestId('whatsapp-toggle'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manage/whatsapp-settings', { enabled: true }));
    expect(await screen.findByText('On — families receive WhatsApp')).toBeInTheDocument();
  });

  it('says WhatsApp is part of Pro when the plan refuses the settings, instead of an error box', async () => {
    const api = stub(BASE);
    api.get.mockRejectedValue(new ApiError(403, 'Feature not enabled', null));
    renderWithProviders(<WhatsAppCard />);
    expect(await screen.findByTestId('whatsapp-plan-notice')).toHaveTextContent('part of the Pro plan');
    expect(screen.queryByTestId('whatsapp-toggle')).toBeNull();
  });

  it('says plainly when the platform number is not connected, and disables the test send', async () => {
    stub({ ...BASE, settings: { enabled: true, phoneNumberId: null }, platform: { configured: false, senderPhoneNumberId: null }, recent: [], thisMonth: {} });
    renderWithProviders(<WhatsAppCard />);
    expect(await screen.findByTestId('whatsapp-state')).toHaveTextContent('waiting for the platform number');
    expect(screen.getByText(/not connected yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send test' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('whatsapp-open-log'));
    expect(await screen.findByTestId('whatsapp-empty')).toBeInTheDocument();
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

/**
 * "WhatsApp is not working" was true for days on staging because the phone
 * number id held the WABA id. Nothing said so: the switch looked fine and
 * every send died at Meta with a permissions-shaped error.
 */
describe('why WhatsApp is idle', () => {
  it('tells the school WHICH id is wrong, not just that it is off', async () => {
    stub({
      ...BASE,
      platform: {
        configured: false, senderPhoneNumberId: '1615192556803051',
        problem: 'WHATSAPP_PHONE_NUMBER_ID is the same as WHATSAPP_WABA_ID. The sending number is not the business account.',
      },
    });
    renderWithProviders(<WhatsAppCard />);
    expect(await screen.findByTestId('wa-problem')).toHaveTextContent(/same as WHATSAPP_WABA_ID/);
  });

  it('says nothing when the platform is healthy', async () => {
    stub({ ...BASE, platform: { configured: true, senderPhoneNumberId: '1415040705015934', problem: null } });
    renderWithProviders(<WhatsAppCard />);
    await screen.findByTestId('whatsapp-toggle');
    expect(screen.queryByTestId('wa-problem')).toBeNull();
  });
});


describe('plain words, not codes', () => {
  it('names every kind in the log and the wording, never the raw code', async () => {
    stub({ ...BASE, recent: [{ ...BASE.recent[0], kind: 'COVER_UNFILLED' }], templates: [{ kind: 'LEAVE_DECIDED', name: 'x', body: 'Your leave was decided.' }] });
    renderWithProviders(<WhatsAppCard />);
    fireEvent.click(await screen.findByTestId('whatsapp-open-log'));
    expect(await screen.findByText('Cover still needed')).toBeInTheDocument();
    expect(screen.queryByText('COVER_UNFILLED')).toBeNull();
  });

  it('says SMS is sign-in codes only', async () => {
    stub(BASE);
    renderWithProviders(<WhatsAppCard />);
    expect(await screen.findByTestId('sms-section')).toHaveTextContent('Sign-in codes only');
  });
});
