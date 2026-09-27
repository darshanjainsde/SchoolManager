import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import OnboardPage from './page';
import { useWizardStore } from '@/lib/wizard-store';

const post = vi.fn();
vi.mock('@/lib/use-api', () => ({ useApi: () => ({ post: (...a: unknown[]) => post(...a) }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * THE COUNTRY IS SET AT BIRTH.
 *
 * Every per-country behaviour — festivals, timezone, locale, later the
 * academic year — hangs off School.countryCode. It is chosen here, on the
 * first step, from the full ISO list, and it defaults to India, the only
 * country fully built out.
 */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><OnboardPage /></QueryClientProvider>);
}

beforeEach(() => {
  post.mockReset().mockResolvedValue({ id: 's1', slug: 'maple-leaf', tempPassword: 'x' });
  useWizardStore.getState().reset();
});

describe('creating a school', () => {
  it('asks for the country on the first step, defaulting to India', () => {
    renderPage();
    const select = screen.getByLabelText(/Country/) as HTMLSelectElement;
    expect(select.value).toBe('IN');
    expect(select.options.length).toBeGreaterThan(240);
    expect(screen.queryByText(/is not set up on its own yet/)).not.toBeInTheDocument();
  });

  it('says plainly when a country inherits India’s setup for now', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.selectOptions(screen.getByLabelText(/Country/), 'AE');
    expect(screen.getByText(/United Arab Emirates is not set up on its own yet/)).toBeInTheDocument();
  });

  it('sends the chosen country with the rest of the school', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.type(screen.getByLabelText(/School name/), 'Maple Leaf Academy');
    await user.type(screen.getByLabelText(/Domain hostname/), 'maple.test');
    await user.type(screen.getByLabelText(/Admin email/), 'admin@maple.test');
    await user.selectOptions(screen.getByLabelText(/Country/), 'AE');
    await user.click(screen.getByRole('button', { name: /Next/i }));
    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(screen.getByText('United Arab Emirates')).toBeInTheDocument(); // the confirm row
    await user.click(screen.getByRole('button', { name: /Create school/i }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][1]).toMatchObject({ slug: 'maple-leaf-academy', countryCode: 'AE' });
  });
});
