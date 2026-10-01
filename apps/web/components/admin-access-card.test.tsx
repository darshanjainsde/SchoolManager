import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminAccessCard, handoverMessage, adminLoginUrl } from './admin-access-card';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/use-api', () => ({
  useApi: () => ({ get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) }),
}));
// The real signed-in shape after a page load: the refresh token is in an
// HttpOnly cookie, so the store's copy is EMPTY and only `status` says
// signed in. Mocking `refreshToken: 'rt'` here is what hid the blank card.
const authState: { status: string; refreshToken?: string } = { status: 'authed', refreshToken: undefined };
vi.mock('@/lib/auth-store', () => ({
  useAuthStore: (pick: (s: typeof authState) => unknown) => pick(authState),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const SCHOOL = { id: 'school-1', name: 'Raffles Public School', slug: 'raffles', primaryDomain: 'raffles.test.sckools.com' };
const ADMIN = { userId: 'u-1', email: 'admin@raffles.test', isActive: true, lastLoginAt: null, lockedUntil: null };

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AdminAccessCard school={SCHOOL} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset().mockResolvedValue([ADMIN]);
  post.mockReset();
  authState.status = 'authed';
});

describe('Admin access — resetting a school admin from the owner console', () => {
  it('lists the admins with a reset on each', async () => {
    renderCard();
    expect(await screen.findByText('admin@raffles.test')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/owner/schools/school-1/admins');
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument();
  });

  it('generates by default, then shows the password once with a message to send', async () => {
    post.mockResolvedValue({ password: 'Gen3rated-Pass16', generated: true });
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));

    expect(post).toHaveBeenCalledWith('/owner/schools/school-1/admins/u-1/reset-password', {});
    expect(await screen.findByTestId('new-password')).toHaveTextContent('Gen3rated-Pass16');
    // The message carries everything the admin needs, and nothing else.
    expect(screen.getByText(/Sign in: https?:\/\/raffles\.test\.sckools\.com(:3000)?\/login/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy message for admin' })).toBeInTheDocument();
  });

  it('sends the password the owner typed, only once both entries match and reach 8', async () => {
    post.mockResolvedValue({ password: 'Chosen-2026', generated: false });
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /I'll type one/i }));

    const submit = within(dialog).getByRole('button', { name: 'Reset password' });
    await user.type(within(dialog).getByLabelText('New password'), 'short');
    expect(submit).toBeDisabled();

    await user.clear(within(dialog).getByLabelText('New password'));
    await user.type(within(dialog).getByLabelText('New password'), 'Chosen-2026');
    await user.type(within(dialog).getByLabelText('Type it again'), 'Chosen-2025');
    expect(within(dialog).getByText(/don.t match/i)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.clear(within(dialog).getByLabelText('Type it again'));
    await user.type(within(dialog).getByLabelText('Type it again'), 'Chosen-2026');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(post).toHaveBeenCalledWith('/owner/schools/school-1/admins/u-1/reset-password', { password: 'Chosen-2026' });
    expect(await screen.findByTestId('new-password')).toHaveTextContent('Chosen-2026');
  });

  it('loads for a signed-in owner whose refresh token is cookie-only', async () => {
    // The staging defect: the card rendered its title and nothing else.
    renderCard();
    expect(await screen.findByRole('button', { name: 'Reset password' })).toBeInTheDocument();
  });

  it('says it is loading while the session is still being checked', () => {
    authState.status = 'unknown';
    renderCard();
    expect(screen.getByText('Loading admins…')).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('cancel resets nothing', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('the handover message', () => {
  it('names the sign-in address, the login, the password and where to change it', () => {
    const msg = handoverMessage(SCHOOL, 'admin@raffles.test', 'Temp-Pass-1');
    // https in production; the test env is local, so http and :3000.
    expect(msg).toMatch(/Sign in: https?:\/\/raffles\.test\.sckools\.com(:3000)?\/login/);
    expect(msg).toContain('Email: admin@raffles.test');
    expect(msg).toContain('Temporary password: Temp-Pass-1');
    expect(msg).toMatch(/raffles\.test\.sckools\.com(:3000)?\/app\/profile/);
  });

  it('falls back to the school subdomain when it has no primary domain', () => {
    expect(adminLoginUrl({ ...SCHOOL, primaryDomain: null })).toMatch(/raffles\..+\/login$/);
  });
});
