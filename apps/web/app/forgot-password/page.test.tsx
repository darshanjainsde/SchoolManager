import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import ForgotPasswordPage from './page';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));

function stub(over: Partial<ApiStub> = {}): ApiStub {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn(), ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ForgotPasswordPage', () => {
  it('resets by email by default, without leaking whether the account exists', async () => {
    const post = vi.fn().mockResolvedValue({});
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderWithProviders(<ForgotPasswordPage />);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), 'head@school.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'head@school.test' });
    expect(await screen.findByText(/if an account exists/i)).toBeInTheDocument();
  });

  it('a family with only the printed student code can reset with it', async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, emailMasked: 'p•••a@gmail.com' });
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderWithProviders(<ForgotPasswordPage />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('mode-code'));
    await user.type(screen.getByTestId('code-input'), 'raf-00042');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    // Normalised to the case the school letter prints.
    expect(post).toHaveBeenCalledWith('/auth/reset-by-code', { code: 'RAF-00042' });
    expect(await screen.findByTestId('code-result')).toHaveTextContent('p•••a@gmail.com');
  });

  it('a code with no email on file says to ring the office, not "sent"', async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, emailMasked: null });
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderWithProviders(<ForgotPasswordPage />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('mode-code'));
    await user.type(screen.getByTestId('code-input'), 'RAF-00042');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByTestId('code-result')).toHaveTextContent(/ring the school office/i);
  });

  it('a refusal (rate limit) surfaces rather than reading as sent', async () => {
    const post = vi.fn().mockRejectedValue(new Error('Too many attempts.'));
    vi.mocked(useApi).mockReturnValue(stub({ post }) as never);
    renderWithProviders(<ForgotPasswordPage />);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('mode-code'));
    await user.type(screen.getByTestId('code-input'), 'RAF-00042');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));

    expect(await screen.findByText(/couldn’t send right now/i)).toBeInTheDocument();
    expect(screen.queryByTestId('code-result')).not.toBeInTheDocument();
  });
});
