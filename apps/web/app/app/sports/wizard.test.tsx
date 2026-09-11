import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import Wizard from './wizard';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => '/app/sports' }));

const settings = { grouping: 'BANDS', bands: [{ id: 'jun', label: 'Junior', stds: [7, 8] }, { id: 'sen', label: 'Senior', stds: [9, 10, 11] }], pointsPlacing: [10], pointsMatchWin: 5, pointsClassWin: 3, publishNeedsAdmin: false };
const kid = (id: string, name: string, std: number, section: string, gender: string) => ({ id, name, std, section, gender, dob: '2011-06-01', houseId: null });
const roster = [kid('a', 'Aarav Mehta', 9, 'A', 'M'), kid('b', 'Chirag Rao', 9, 'B', 'M'), kid('c', 'Nikhil Jain', 10, 'A', 'M'), kid('d', 'Kabir Bhat', 11, 'A', 'M'), kid('e', 'Meera Iyer', 9, 'A', 'F')];
function mockApi() {
  const api = {
    get: vi.fn((url: string) => url === '/sports/settings' ? Promise.resolve(settings) : url === '/sports/roster' ? Promise.resolve(roster) : url === '/sports/me' ? Promise.resolve({ perms: ['CREATE'], isAdmin: true }) : Promise.reject(new Error(url))),
    post: vi.fn().mockResolvedValue({ id: 't-new', days: 1, daysNeeded: 1, warnings: [] }), put: vi.fn(), patch: vi.fn(), del: vi.fn(),
  };
  vi.mocked(useApi).mockReturnValue(api as unknown as ApiStub as never);
  return api;
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(useHost).mockReturnValue('raffles.test.sckools.com'); });

describe('Wizard — the clicks taken out', () => {
  it('pressing a sport makes its lines with venues bound from the sport; chess in a school with courts has no venue', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<Wizard base="/app/sports" onClose={() => {}} />);
    await u.type(screen.getByPlaceholderText('Annual Sports Meet 2026'), 'Meet');
    await u.click(screen.getByRole('button', { name: '+ Court 1' }));
    await u.type(screen.getByLabelText('New venue'), 'Badminton court 3{Enter}');
    expect(screen.getByLabelText(/Badminton court 3: Court/)).toBeInTheDocument();
    await u.click(screen.getByRole('tab', { name: /Sports & events/ }));
    await u.click(await screen.findByRole('button', { name: 'Senior' }));
    await u.click(screen.getByRole('button', { name: 'Badminton' }));
    await u.click(screen.getByRole('button', { name: 'Chess' }));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4); // Boys + Girls for each
    expect(within(rows[0]).getByText('Badminton court 3')).toBeInTheDocument();
    expect(within(rows[0]).getByText('named')).toBeInTheDocument();
    expect(within(rows[2]).getByText('no venue')).toBeInTheDocument();
    expect(screen.getByText(/2 without a venue/)).toBeInTheDocument();
  });

  it('the no-venue cell opens the editor under its own row and adds the missing venue in one press', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<Wizard base="/app/sports" onClose={() => {}} />);
    await u.type(screen.getByPlaceholderText('Annual Sports Meet 2026'), 'Meet');
    await u.click(screen.getByRole('button', { name: '+ Court 1' }));
    await u.click(screen.getByRole('tab', { name: /Sports & events/ }));
    await u.click(await screen.findByRole('button', { name: 'Senior' }));
    await u.click(screen.getByRole('button', { name: 'Girls' })); // Boys only
    await u.click(screen.getByRole('button', { name: '50 m freestyle' }));
    const cell = screen.getByRole('button', { name: /no venue add a pool/i });
    expect(cell).toHaveAttribute('aria-expanded', 'false');
    await u.click(cell);
    // the editor is a row of the same table, immediately under its line
    const editor = screen.getByRole('region', { name: /Edit 50 m freestyle Boys/ });
    const row = editor.closest('tr')!;
    expect(row.previousElementSibling?.textContent).toContain('50 m freestyle');
    expect(within(editor).getByText(/The meet has no pool/)).toBeInTheDocument();
    await u.click(within(editor).getByRole('button', { name: 'Add a pool' }));
    expect(screen.queryByRole('button', { name: /no venue/i })).toBeNull();
    expect(within(screen.getAllByRole('row')[1]).getByText('Pool')).toBeInTheDocument();
    // and the remove control reads as words, not a clipped icon box
    expect(within(editor).getByRole('button', { name: 'Remove this line' })).toBeVisible();
    await u.click(within(editor).getByRole('button', { name: 'Remove this line' }));
    expect(screen.getByText(/Press a sport above/)).toBeInTheDocument();
  });

  it('a team sport with a single-section class suggests classes, names the problem when sections are forced, and creates with the resolved body', async () => {
    const api = mockApi();
    const u = userEvent.setup();
    renderWithProviders(<Wizard base="/app/sports" onClose={() => {}} />);
    await u.type(screen.getByPlaceholderText('Annual Sports Meet 2026'), 'Meet');
    await u.click(screen.getByRole('button', { name: '+ Field' }));
    await u.click(screen.getByRole('tab', { name: /Sports & events/ }));
    await u.click(await screen.findByRole('button', { name: 'Senior' }));
    await u.click(screen.getByRole('button', { name: 'Girls' })); // Boys only
    await u.click(screen.getByRole('button', { name: 'Football' }));
    await u.click(screen.getByRole('tab', { name: /Players/ }));
    await u.click(await screen.findByRole('button', { name: 'Enter class 9' }));
    await u.click(screen.getByRole('button', { name: 'Enter class 10' }));
    await u.click(screen.getByRole('button', { name: 'Enter class 11' }));
    expect(screen.getByRole('button', { name: /Classes \(9 v 10\) · suggested · 3/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('3 teams from 4 players')).toBeInTheDocument();
    // force the one-team case the office hit: only class 10, whichever basis
    await u.click(screen.getByRole('button', { name: 'Enter class 9' })); // untick? no — clear by unticking the two class-9 boxes
    await u.click(screen.getByRole('checkbox', { name: /Aarav Mehta in Football/ }));
    await u.click(screen.getByRole('checkbox', { name: /Chirag Rao in Football/ }));
    await u.click(screen.getByRole('checkbox', { name: /Kabir Bhat in Football/ }));
    expect(screen.getByText('Only 1 team under classes')).toBeInTheDocument();
    expect(screen.getByText(/Tick children from another class or section/)).toBeInTheDocument();
    // put class 9 back: two sections there, so sections would work and the fix says so
    await u.click(screen.getByRole('checkbox', { name: /Aarav Mehta in Football/ }));
    await u.click(screen.getByRole('checkbox', { name: /Chirag Rao in Football/ }));
    await u.click(screen.getByRole('button', { name: /Classes \(9 v 10\)/ }));
    await u.click(screen.getByRole('checkbox', { name: /Nikhil Jain in Football/ }));
    expect(screen.getByText('Only 1 team under classes')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Make the teams sections' }));
    expect(screen.getByText('2 teams from 2 players')).toBeInTheDocument();
    await u.click(screen.getByRole('checkbox', { name: /Nikhil Jain in Football/ }));
    await u.click(screen.getByRole('checkbox', { name: /Kabir Bhat in Football/ }));
    await u.click(screen.getByRole('tab', { name: /Review/ }));
    await u.click(screen.getByRole('button', { name: 'Create tournament' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0][1] as { restMin: number; events: { sportKey: string; teamBasis?: string; venueIdx: number[]; studentIds: string[]; category: string; groupKey: string }[] };
    expect(body.restMin).toBe(15);
    expect(body.events).toEqual([{ sportKey: 'football', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venueIdx: [0], studentIds: ['a', 'b', 'c', 'd'], teamBasis: 'SECTIONS' }]);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/sports/tournaments/t-new'));
  });
});
