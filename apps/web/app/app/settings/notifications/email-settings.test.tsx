import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { EmailSettings as EmailSettingsCard } from './email-settings';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BASE = {
  settings: { template: 'CLASSIC', senderName: null, replyTo: null, accentColor: null, logoAssetId: null, footerLines: [] },
  effective: { schoolName: 'Raffles', senderName: 'Raffles', fromAddress: 'notify@notify.sckools.com', replyTo: null, accent: '#4F46E5', logoUrl: null, template: 'CLASSIC', footerLines: [], usingCustomSender: false, showPlatformCredit: true },
  sender: { mode: 'DEFAULT', status: 'UNVERIFIED', fromAddress: null, smtpHost: null, smtpPort: null, smtpUser: null, hasPassword: false, verifiedAt: null, lastError: null, lastErrorAt: null, canConfigure: true },
  previews: [{ template: 'CLASSIC', html: '<p>x</p>' }, { template: 'BANNER', html: '' }, { template: 'MINIMAL', html: '' }],
  deliveries: {
    thisMonth: { SENT: 2, DELIVERED: 5, BOUNCED: 1 },
    recent: [
      { id: 'a', to: 'sunita@gmail.com', kind: 'ABSENCE_NOTICE', provider: 'resend', status: 'DELIVERED', error: null, createdAt: '2026-09-20T05:00:00Z', deliveredAt: '2026-09-20T05:00:20Z', bouncedAt: null },
      { id: 'b', to: 'old@gmial.com', kind: 'TEST', provider: 'resend', status: 'BOUNCED', error: 'mailbox does not exist (Permanent/General)', createdAt: '2026-09-20T04:00:00Z', deliveredAt: null, bouncedAt: '2026-09-20T04:00:05Z' },
    ],
    suppressed: [{ email: 'old@gmial.com', reason: 'BOUNCE', detail: 'mailbox does not exist', createdAt: '2026-09-20T04:00:05Z' }],
  },
};

function stub() {
  const api = { get: vi.fn().mockResolvedValue(BASE), put: vi.fn(), post: vi.fn().mockResolvedValue({ ok: true }), patch: vi.fn(), del: vi.fn() };
  vi.mocked(useApi).mockReturnValue(api as unknown as ApiStub as never);
  return api;
}
beforeEach(() => vi.mocked(useHost).mockReturnValue('raffles.sckools.com'));

describe('email settings: deliveries', () => {
  it('keeps the log behind a button; it shows the month, each receipt with the reason for a bounce, and the addresses to fix', async () => {
    stub();
    renderWithProviders(<EmailSettingsCard />);
    // The section names the problem without opening anything…
    expect(await screen.findByTestId('email-month-line')).toHaveTextContent('1 address bounces');
    expect(screen.queryByTestId('email-recent')).toBeNull();
    // …and the receipts open only when asked for.
    fireEvent.click(screen.getByTestId('email-open-log'));
    const box = await screen.findByTestId('email-deliveries');
    expect(box).toHaveTextContent('8'); // 2 + 5 + 1 this month
    expect(box).toHaveTextContent('63% of sent');
    expect(screen.getByTestId('email-recent')).toHaveTextContent('mailbox does not exist (Permanent/General)');
    expect(screen.getByTestId('email-suppressed')).toHaveTextContent('old@gmial.com');
  });

  it('"Fixed — send again" clears the address', async () => {
    const api = stub();
    renderWithProviders(<EmailSettingsCard />);
    fireEvent.click(await screen.findByTestId('email-open-log'));
    await screen.findByTestId('email-suppressed');
    fireEvent.click(screen.getByRole('button', { name: 'Fixed — send again' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/email-settings/unsuppress', { to: 'old@gmial.com' }));
  });
});

describe('email settings: letterhead and own mailbox', () => {
  it('saves the letterhead with the fields typed', async () => {
    const api = stub();
    api.put.mockResolvedValue(BASE);
    renderWithProviders(<EmailSettingsCard />);
    fireEvent.change(await screen.findByLabelText('Replies go to'), { target: { value: 'office@raffles.in' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save letterhead' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manage/email-settings', expect.objectContaining({ replyTo: 'office@raffles.in', template: 'CLASSIC' })));
  });

  it('opens the mailbox set-up in a panel, not on the page', async () => {
    stub();
    renderWithProviders(<EmailSettingsCard />);
    expect(await screen.findByTestId('email-sender')).toHaveTextContent('Not set up');
    expect(screen.queryByLabelText('Mail server')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(await screen.findByLabelText('Mail server')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('email settings: the master switch', () => {
  it('a school that never touched it is On, with the hint for practice schools', async () => {
    stub();
    renderWithProviders(<EmailSettingsCard />);
    expect(await screen.findByTestId('email-state')).toHaveTextContent('On');
    expect(screen.getByTestId('email-toggle')).toBeChecked();
    expect(screen.getByTestId('email-switch')).toHaveTextContent('practice school');
    expect(screen.queryByTestId('email-off-note')).toBeNull();
  });

  it('turning it off sends ONLY the switch (never the letterhead form), and the page shows Off with what still goes', async () => {
    const api = stub();
    api.put.mockResolvedValue({ ...BASE, settings: { ...BASE.settings, enabled: false } });
    renderWithProviders(<EmailSettingsCard />);
    fireEvent.click(await screen.findByTestId('email-toggle'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manage/email-settings', { enabled: false }));
    expect(await screen.findByTestId('email-state')).toHaveTextContent('Off');
    expect(screen.getByTestId('email-toggle')).not.toBeChecked();
    expect(screen.getByTestId('email-off-note')).toHaveTextContent('still get every message in the Sckools app');
    expect(screen.getByTestId('email-off-note')).toHaveTextContent('password reset');
  });

  it('turning it back on sends enabled: true', async () => {
    const api = stub();
    api.get.mockResolvedValue({ ...BASE, settings: { ...BASE.settings, enabled: false } });
    api.put.mockResolvedValue({ ...BASE, settings: { ...BASE.settings, enabled: true } });
    renderWithProviders(<EmailSettingsCard />);
    expect(await screen.findByTestId('email-state')).toHaveTextContent('Off');
    fireEvent.click(screen.getByTestId('email-toggle'));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/manage/email-settings', { enabled: true }));
    expect(await screen.findByTestId('email-state')).toHaveTextContent('On');
  });

  it('a failed save leaves the switch where it was', async () => {
    const api = stub();
    api.put.mockRejectedValue(new Error('Network down'));
    renderWithProviders(<EmailSettingsCard />);
    fireEvent.click(await screen.findByTestId('email-toggle'));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(screen.getByTestId('email-state')).toHaveTextContent('On');
    expect(screen.getByTestId('email-toggle')).toBeChecked();
  });

  it('saving the letterhead never sends the switch, so it cannot flip it back', async () => {
    const api = stub();
    api.put.mockResolvedValue(BASE);
    renderWithProviders(<EmailSettingsCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Save letterhead' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1]).not.toHaveProperty('enabled');
  });
});
