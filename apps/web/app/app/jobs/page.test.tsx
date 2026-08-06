import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JobsPage from './page';

const post = vi.fn();
vi.mock('@/lib/use-api', () => ({
  useApi: () => ({ get: vi.fn().mockResolvedValue([]), post: (...a: unknown[]) => post(...a), patch: vi.fn() }),
}));
vi.mock('@/components/use-host', () => ({ useHost: () => 'raffles.test.sckools.com' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * A BLANK FORM ASKS THE WRONG THING OF A SCHOOL OFFICE.
 *
 * They can write a job description. What they cannot easily do is invent four
 * screening questions inside a budget they have never met, where every question
 * has to become a filter or it is one somebody reads sixty times and acts on
 * none of. So the form opens on roles, and each role arrives with its questions
 * already set up.
 */
function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <JobsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  post.mockReset();
  post.mockResolvedValue({});
});

describe('posting a vacancy', () => {
  it('opens on roles rather than an empty form', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /Subject teacher/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start blank/ })).toBeInTheDocument();
    // The form itself has not appeared yet.
    expect(screen.queryByLabelText('Full description')).not.toBeInTheDocument();
  });

  it('says how many questions a role brings before you commit to it', async () => {
    renderPage();
    const card = await screen.findByRole('button', { name: /Subject teacher/ });
    expect(card.textContent).toMatch(/4 questions ready/);
  });

  it('fills the form and its questions from the role chosen', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Primary class teacher/ }));

    expect(screen.getByLabelText('Job title')).toHaveValue('Primary Class Teacher');
    expect(screen.getByLabelText('Question 1')).toHaveValue('Years of teaching experience');
    expect(screen.getByText('4 of 4 used')).toBeInTheDocument();
  });

  it('refuses a fifth question in the form, not on save', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Primary class teacher/ }));
    expect(screen.getByRole('button', { name: /Four is the maximum/ })).toBeDisabled();
  });

  it('starts blank truly blank, with room for all four', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Start blank/ }));
    expect(screen.getByLabelText('Job title')).toHaveValue('');
    expect(screen.getByText('0 of 4 used')).toBeInTheDocument();
  });

  it('warns that free text cannot be filtered, where the choice is made', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Start blank/ }));
    await user.click(screen.getByRole('button', { name: 'Add a question' }));
    await user.selectOptions(screen.getByLabelText('Answer type for question 1'), 'TEXT');
    expect(screen.getByText(/cannot be filtered/i)).toBeInTheDocument();
  });

  it('sends the edited template, not the template', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Early years teacher/ }));
    const title = screen.getByLabelText('Job title');
    await user.clear(title);
    await user.type(title, 'Nursery Teacher (Mornings)');
    await user.click(screen.getByRole('button', { name: /Save as draft/ }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const [, body] = post.mock.calls[0];
    expect(body.title).toBe('Nursery Teacher (Mornings)');
    expect(body.questions.length).toBeGreaterThan(0);
  });

  it('lets you back out to a different role without reloading', async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole('button', { name: /Sports coach/ }));
    await user.click(screen.getByRole('button', { name: 'Change role' }));
    expect(screen.getByRole('button', { name: /Office \/ admin/ })).toBeInTheDocument();
  });
});
