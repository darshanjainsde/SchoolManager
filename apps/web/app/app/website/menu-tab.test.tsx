import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MenuTab from './menu-tab';

const put = vi.fn();
vi.mock('@/lib/use-api', () => ({
  useApi: () => ({
    get: vi.fn().mockResolvedValue({
      profile: { navConfig: null },
      school: { features: ['GALLERY', 'EVENTS', 'BLOG'] },
      courses: [{ id: 'c1' }],
    }),
    put: (...args: unknown[]) => put(...args),
  }),
}));
vi.mock('@/components/use-host', () => ({ useHost: () => 'raffles.test.sckools.com' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/**
 * THE EDITOR ENFORCES WHAT THE RULES SAY, AND SAYS IT IN WORDS.
 *
 * The rules themselves live in `nav-config` and are tested there. What matters
 * here is that this screen actually applies them: that a school cannot save a
 * menu the site would render wrongly, and that when it refuses it explains
 * which page is about to go missing rather than greying a button out silently.
 */
function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MenuTab />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  put.mockReset();
  put.mockResolvedValue({});
});

describe('the menu editor', () => {
  it('opens on the standard menu a school already has', async () => {
    renderTab();
    expect(await screen.findByLabelText('Name of Our school')).toHaveValue('Our school');
    expect(screen.getByLabelText('Name of Admissions')).toHaveValue('Admissions');
  });

  it('shows the frozen address beside a heading, so renaming holds no surprise', async () => {
    renderTab();
    expect(await screen.findByText('/our-school')).toBeInTheDocument();
    expect(screen.getByText('/news-events')).toBeInTheDocument();
  });

  it('renames a heading without touching its address', async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();
    const field = await screen.findByLabelText('Name of Our school');
    await user.clear(field);
    await user.type(field, 'Discover us');

    expect(screen.getByText('/our-school')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /save menu/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [, body] = put.mock.calls[0];
    const ourSchool = body.navConfig.items.find((i: { slug: string }) => i.slug === 'our-school');
    expect(ourSchool.label).toBe('Discover us');
    expect(ourSchool.slug).toBe('our-school');
  });

  it('will not save nothing — the button waits for a real change', async () => {
    renderTab();
    await screen.findByLabelText('Name of Our school');
    expect(screen.getByRole('button', { name: /save menu/i })).toBeDisabled();
  });

  it('moves a page out of a group to top level instead of losing it', async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();
    await user.click(await screen.findByLabelText('Move Gallery out of Our school'));

    // It is still in the menu, now as its own heading.
    expect(screen.getByLabelText('Name of Gallery')).toHaveValue('Gallery');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('never loses a page, but does warn when top-level runs past six', async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();
    // Both pages come OUT of the group and become top-level — neither is lost.
    // That takes the bar to seven controls, which is exactly where a typical
    // school name starts truncating, so the editor says so instead of letting
    // the school discover it on their own site.
    await user.click(await screen.findByLabelText('Move About out of Our school'));
    await user.click(await screen.findByLabelText('Move Hall of Fame out of Our school'));

    for (const page of ['About', 'Hall of Fame']) {
      expect(screen.getByLabelText(`Name of ${page}`)).toBeInTheDocument();
    }
    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/six/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save menu/i })).toBeDisabled();
  });

  it('puts the standard menu back', async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();
    const field = await screen.findByLabelText('Name of Our school');
    await user.clear(field);
    await user.type(field, 'Zzz');
    await user.click(screen.getByRole('button', { name: /reset to the standard menu/i }));
    expect(screen.getByLabelText('Name of Our school')).toHaveValue('Our school');
  });

  it('reorders headings, and the saved order is the visitor’s order', async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();
    await user.click(await screen.findByLabelText('Move Academics up'));
    await user.click(screen.getByRole('button', { name: /save menu/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const [, body] = put.mock.calls[0];
    expect(body.navConfig.items.map((i: { label: string }) => i.label).slice(0, 2)).toEqual([
      'Academics',
      'Our school',
    ]);
  });
});

describe('what an admin is told when it is wrong', () => {
  it('names the problem in words, rather than only greying the button out', async () => {
    const user = userEvent.setup({ delay: null });
    renderTab();
    await user.click(await screen.findByLabelText('Move About out of Our school'));
    await user.click(await screen.findByLabelText('Move Hall of Fame out of Our school'));

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText(/cannot be saved yet/i)).toBeInTheDocument();
    // A disabled button with no explanation is the thing this replaces.
    expect(alert.textContent).toMatch(/Group some of them together/i);
  });
});
