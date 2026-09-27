import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import { EmailSettingsCard } from './email-card';

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

describe('the email card: deliveries', () => {
  it('shows the month, each receipt with the reason for a bounce, and the addresses to fix', async () => {
    stub();
    renderWithProviders(<EmailSettingsCard />);
    const box = await screen.findByTestId('email-deliveries');
    expect(box).toHaveTextContent('8'); // 2 + 5 + 1 this month
    expect(box).toHaveTextContent('63% of sent');
    expect(screen.getByTestId('email-recent')).toHaveTextContent('mailbox does not exist (Permanent/General)');
    expect(screen.getByTestId('email-suppressed')).toHaveTextContent('old@gmial.com');
  });

  it('"Fixed — send again" clears the address', async () => {
    const api = stub();
    renderWithProviders(<EmailSettingsCard />);
    await screen.findByTestId('email-suppressed');
    fireEvent.click(screen.getByRole('button', { name: 'Fixed — send again' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/manage/email-settings/unsuppress', { to: 'old@gmial.com' }));
  });
});
