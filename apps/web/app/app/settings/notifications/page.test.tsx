import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import NotificationsSettingsPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const EMAIL = {
  settings: { template: 'CLASSIC', senderName: null, replyTo: null, accentColor: null, logoAssetId: null, footerLines: [] },
  effective: { schoolName: 'Raffles', senderName: 'Raffles', fromAddress: 'notify@notify.sckools.com', replyTo: null, accent: '#4F46E5', logoUrl: null, template: 'CLASSIC', footerLines: [], usingCustomSender: false, showPlatformCredit: true },
  sender: { mode: 'DEFAULT', status: 'UNVERIFIED', fromAddress: null, smtpHost: null, smtpPort: null, smtpUser: null, hasPassword: false, verifiedAt: null, lastError: null, lastErrorAt: null, canConfigure: true },
  previews: [{ template: 'CLASSIC', html: '<p>x</p>' }],
  deliveries: { thisMonth: { DELIVERED: 40, BOUNCED: 2 }, recent: [], suppressed: [] },
};
const WA = {
  settings: { enabled: true, phoneNumberId: null },
  platform: { configured: true, senderPhoneNumberId: '1' },
  templates: [],
  thisMonth: { READ: 30, FAILED: 3 },
  recent: [],
};

beforeEach(() => {
  // A test that opens a part leaves its #hash behind; each test starts clean.
  window.history.replaceState(null, '', '/app/settings/notifications');
  vi.mocked(useHost).mockReturnValue('raffles.sckools.com');
  const get = vi.fn((path: string) =>
    path === '/manage/email-settings' ? Promise.resolve(EMAIL)
      : path === '/manage/whatsapp-settings' ? Promise.resolve(WA)
        : Promise.reject(new Error(`Unexpected GET ${path}`)));
  vi.mocked(useApi).mockReturnValue({ get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() } as never);
});

describe('Settings → Notifications', () => {
  it('a link with #whatsapp opens that part directly', async () => {
    window.history.replaceState(null, '', '/app/settings/notifications#whatsapp');
    renderWithProviders(<NotificationsSettingsPage />);
    expect(await screen.findByTestId('whatsapp-card')).toBeInTheDocument();
  });

  it('opens on an overview of the four channels with this month, and no log on the page', async () => {
    renderWithProviders(<NotificationsSettingsPage />);
    await waitFor(() => expect(screen.getByTestId('chan-email')).toHaveTextContent('42'));
    expect(screen.getByTestId('chan-email')).toHaveTextContent('2 not delivered');
    await waitFor(() => expect(screen.getByTestId('chan-whatsapp')).toHaveTextContent('33'));
    expect(screen.getByTestId('chan-whatsapp')).toHaveTextContent('On');
    expect(screen.getByTestId('chan-sms')).toHaveTextContent('Codes only');
    expect(screen.getByTestId('chan-app')).toHaveTextContent('Always on');
    expect(screen.queryByTestId('email-recent')).toBeNull();
    expect(screen.queryByTestId('whatsapp-recent')).toBeNull();
  });

  it('Manage on a tile opens that channel', async () => {
    renderWithProviders(<NotificationsSettingsPage />);
    const tile = await screen.findByTestId('chan-email');
    fireEvent.click(tile.querySelector('button')!);
    expect(await screen.findByTestId('email-letterhead')).toBeInTheDocument();
    expect(screen.getByTestId('notif-part-email')).toHaveAttribute('aria-selected', 'true');
  });

  it('links to My profile for the admin\'s own alerts', async () => {
    renderWithProviders(<NotificationsSettingsPage />);
    const link = (await screen.findByText('Open My profile')).closest('a');
    expect(link).toHaveAttribute('href', '/app/profile');
  });
});
