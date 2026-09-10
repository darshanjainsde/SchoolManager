import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApi } from '@/lib/use-api';
import { ApiError } from '@/lib/api';
import RecordsTab from './records-tab';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: () => 'raffles.test.sckools.com' }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const cfg = { enabled: false, consentConfirmed: false, nameFormat: 'FIRST_INITIAL', pageLayout: 'CABINET', homeScope: 'RECENT', homeCount: 4, pinned: [], showTopFive: true, groups: [] };
const lines = [
  { key: 'ath-100m|sen|Boys', label: '100 m sprint · Senior Boys', groupKey: 'sen', hasRecord: true, marks: 0 },
  { key: 'ath-long-jump|jun|Girls', label: 'Long jump · Junior Girls', groupKey: 'jun', hasRecord: false, marks: 3 },
];
function mockApi(features: string[], putImpl?: (body: unknown) => Promise<unknown>) {
  const api = {
    get: vi.fn((url: string) => url === '/site/records' ? Promise.resolve(cfg) : url === '/site/records/lines' ? Promise.resolve(lines) : url === '/auth/me' ? Promise.resolve({ features }) : Promise.reject(new Error(url))),
    put: vi.fn(putImpl ?? ((_u: string, body: unknown) => Promise.resolve(body))),
    post: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  vi.mocked(useApi).mockReturnValue(api as never);
  return api;
}
const renderTab = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><RecordsTab onGoToStudio={vi.fn()} /></QueryClientProvider>);

beforeEach(() => vi.clearAllMocks());

describe('RecordsTab', () => {
  it('switches the book on with consent and saves the page room and the homepage scope', async () => {
    const api = mockApi(['SPORTS']);
    const u = userEvent.setup();
    renderTab();
    expect(await screen.findByText('Show the Book of Records on the website')).toBeInTheDocument();
    await u.click(screen.getByRole('switch'));
    await u.click(screen.getByText(/The school may name its record holders/));
    await u.click(screen.getByRole('button', { name: /Scoreboard/ }));
    await u.click(screen.getByRole('button', { name: 'Lines I pick' }));
    await u.click(screen.getByLabelText('100 m sprint · Senior Boys'));
    expect(screen.queryByLabelText('Long jump · Junior Girls')).toBeNull(); // no record → cannot be pinned
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0][1]).toMatchObject({ enabled: true, consentConfirmed: true, pageLayout: 'SCOREBOARD', homeScope: 'PINNED', pinned: ['ath-100m|sen|Boys'] });
  });

  it('a consent refusal from the API is shown as the API said it', async () => {
    const { toast } = await import('sonner');
    mockApi(['SPORTS'], () => Promise.reject(new ApiError(400, 'Confirm that the school may name its record holders on the public website', { code: 'CONSENT_REQUIRED' })));
    const u = userEvent.setup();
    renderTab();
    await u.click(await screen.findByRole('switch'));
    await u.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Confirm that the school may name its record holders on the public website'));
  });

  it('without the Sports wing everything is read-only and says why', async () => {
    mockApi(['MANAGEMENT']);
    renderTab();
    expect(await screen.findByText(/needs the Sports wing/)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
