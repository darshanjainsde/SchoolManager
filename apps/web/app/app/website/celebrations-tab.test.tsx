import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CelebrationsTab from './celebrations-tab';
import type { CelebrationsConfig } from '@/components/public/celebrations-config';

const get = vi.fn();
const put = vi.fn();
vi.mock('@/lib/use-api', () => ({
  useApi: () => ({
    get: (...args: unknown[]) => get(...args),
    put: (...args: unknown[]) => put(...args),
  }),
}));
vi.mock('@/components/use-host', () => ({ useHost: () => 'raffles.test.sckools.com' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const DEFAULTS: CelebrationsConfig = {
  source: 'STUDENTS',
  window: 'WEEK',
  nameFormat: 'FIRST_INITIAL',
  showClass: true,
  showPhotos: false,
  audience: 'FAMILIES',
  placement: 'TEASER_AND_PAGE',
  teaser: 'CAKE_BADGE',
  page: 'PARTY_WALL',
  wishLine: 'Happy birthday, {first name}! From all of us at {school}.',
  consentConfirmed: false,
  manual: [],
};
const PREVIEW = {
  generatedFor: '2026-09-09',
  missingDob: 38,
  week: [
    { studentId: 's1', name: 'Aarav Mehta', classLabel: '5 B', day: 9, month: 9, showOnWebsite: true, photoConsent: false, hasPhoto: true },
    { studentId: 's2', name: 'Meera Iyer', classLabel: '2 A', day: 11, month: 9, showOnWebsite: false, photoConsent: true, hasPhoto: false },
  ],
};

function mockApi({ features = ['MANAGEMENT'], showBirthdays = true, config = DEFAULTS } = {}) {
  get.mockImplementation((url: string) => {
    if (url === '/site/celebrations/preview') return Promise.resolve(PREVIEW);
    if (url === '/site/celebrations') return Promise.resolve(config);
    if (url === '/site/content') return Promise.resolve({ homepage: { showBirthdays } });
    if (url === '/auth/me') return Promise.resolve({ features });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CelebrationsTab onGoToHomepage={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  get.mockReset();
  put.mockReset();
  put.mockResolvedValue({});
});

/**
 * THE TAB REFUSES WHAT THE API REFUSES, IN WORDS, AND SHOWS REAL NAMES.
 * The rules live in the API (CONSENT_REQUIRED, normalizeCelebrationsConfig);
 * what matters here is that an admin meets them before pressing Save, and
 * that hiding a child is one switch beside the child's name.
 */
describe('Celebrations tab', () => {
  it('lists this week from records, with a switch per child, and counts the children who can never appear', async () => {
    mockApi();
    mount();
    expect(await screen.findByText('Aarav Mehta')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Show Aarav Mehta on the wall' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Show Meera Iyer on the wall' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText(/38 active students have no date of birth/)).toBeInTheDocument();
    expect(screen.getByText(/no photo on file/)).toBeInTheDocument();
  });

  it('hides a child from the wall with the switch, without touching the config', async () => {
    mockApi();
    const user = userEvent.setup({ delay: null });
    mount();
    await user.click(await screen.findByRole('switch', { name: 'Show Aarav Mehta on the wall' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/manage/students/s1', { showOnWebsite: false }));
    expect(put).not.toHaveBeenCalledWith('/site/celebrations', expect.anything());
  });

  it('going public needs the consent tick before Save opens, then saves the whole config in one PUT', async () => {
    mockApi();
    const user = userEvent.setup({ delay: null });
    mount();
    await screen.findByText('Aarav Mehta');
    expect(screen.queryByLabelText(/Our school holds parental consent/)).toBeNull();

    await user.click(screen.getByRole('button', { name: /Public website/ }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('Tick the consent box');

    await user.click(screen.getByLabelText(/Our school holds parental consent/));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/site/celebrations',
        expect.objectContaining({ audience: 'PUBLIC', consentConfirmed: true, source: 'STUDENTS', page: 'PARTY_WALL' }),
      ),
    );
  });

  it('without the Management plan the wall is a typed list, and records are not an option', async () => {
    mockApi({ features: [] });
    const user = userEvent.setup({ delay: null });
    mount();
    expect(await screen.findByRole('heading', { name: 'Your list' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Active students' })).toBeDisabled();
    expect(screen.queryByText('Aarav Mehta')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Add a name' }));
    await user.type(screen.getByLabelText('Name 1'), 'Zoya K.');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith(
        '/site/celebrations',
        expect.objectContaining({ source: 'MANUAL', manual: [expect.objectContaining({ name: 'Zoya K.' })] }),
      ),
    );
  });

  it('refuses a day that does not exist in its month, and re-picking the saved chip is not a change', async () => {
    mockApi({ features: [], config: { ...DEFAULTS, source: 'MANUAL', manual: [{ name: 'Zoya', day: 31, month: 4, classLabel: null }] } });
    const user = userEvent.setup({ delay: null });
    mount();
    await screen.findByRole('heading', { name: 'Your list' });
    await user.click(screen.getByRole('button', { name: 'This week' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'This month' }));
    expect(screen.getByRole('alert')).toHaveTextContent('real day for its month');
    await user.clear(screen.getByLabelText('Day 1'));
    await user.type(screen.getByLabelText('Day 1'), '30');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('says when the homepage section is off, and previews the wish line with the school as a token, not a guess', async () => {
    mockApi({ showBirthdays: false });
    mount();
    expect(await screen.findByText('The Birthdays section is switched off')).toBeInTheDocument();
    expect(screen.getByText(/Happy birthday, Aarav! From all of us at/)).toBeInTheDocument();
    expect(screen.getByText('school name')).toBeInTheDocument();
  });
});
