import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

  it('a team sport enters in one press, and a basis that leaves one team says which basis would not', async () => {
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
    // the whole eligible roll, in one press
    await u.click(await screen.findByRole('button', { name: 'All 4 into Football' }));
    expect(screen.getByRole('button', { name: /Classes \(9 v 10\) · suggested · 3/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('3 teams from 4 players')).toBeInTheDocument();
    // down to one class, whichever basis: the office's "error while creating"
    const c9 = () => within(screen.getByRole('region', { name: 'Class 9' }));
    const c10 = () => within(screen.getByRole('region', { name: 'Class 10' }));
    const c11 = () => within(screen.getByRole('region', { name: 'Class 11' }));
    await u.click(c9().getByRole('button', { name: 'Football 2/2' }));
    await u.click(c11().getByRole('button', { name: 'Football 1/1' }));
    expect(screen.getByText('Only 1 team under classes')).toBeInTheDocument();
    expect(screen.getByText(/Tick children from another class or section/)).toBeInTheDocument();
    // class 9 back and the basis pinned to classes: sections WOULD work, so it offers that
    await u.click(c9().getByRole('button', { name: 'Football 0/2' }));
    await u.click(screen.getByRole('button', { name: /Classes \(9 v 10\)/ }));
    await u.click(c10().getByRole('button', { name: 'Football 1/1' }));
    expect(screen.getByText('Only 1 team under classes')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Make the teams sections' }));
    expect(screen.getByText('2 teams from 2 players')).toBeInTheDocument();
    await u.click(screen.getByRole('tab', { name: /Review/ }));
    await u.click(screen.getByRole('button', { name: 'Create tournament' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0][1] as { restMin: number; events: { sportKey: string; teamBasis?: string; venueIdx: number[]; studentIds: string[]; category: string; groupKey: string }[] };
    expect(body.restMin).toBe(15);
    expect(body.events).toEqual([{ sportKey: 'football', groupKey: 'sen', category: 'Boys', structure: 'CLASS', venueIdx: [0], studentIds: ['a', 'b'], teamBasis: 'SECTIONS' }]);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/sports/tournaments/t-new'));
  });
});

describe('Wizard — a meet the size of a school', () => {
  /** Name, one venue, Senior Boys, one sport, then the Players step. */
  async function toPlayers(u: ReturnType<typeof userEvent.setup>, venue: string, sport: string) {
    await u.type(screen.getByPlaceholderText('Annual Sports Meet 2026'), 'Meet');
    await u.click(screen.getByRole('button', { name: `+ ${venue}` }));
    await u.click(screen.getByRole('tab', { name: /Sports & events/ }));
    await u.click(await screen.findByRole('button', { name: 'Senior' }));
    await u.click(screen.getByRole('button', { name: 'Girls' })); // Boys only
    await u.click(screen.getByRole('button', { name: sport }));
    await u.click(screen.getByRole('tab', { name: /Players/ }));
  }

  it('classes arrive shut, so every class is on the screen at once; a chip enters one without opening it', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<Wizard base="/app/sports" onClose={() => {}} />);
    await toPlayers(u, 'Court 1', 'Badminton');
    expect(await screen.findByText('3 classes')).toBeInTheDocument();
    for (const std of [9, 10, 11]) expect(screen.getByRole('region', { name: `Class ${std}` })).toBeInTheDocument();
    // shut means no child rows yet — 4 eligible boys, none of them on the screen
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByText('Aarav Mehta')).toBeNull();
    const c9 = () => within(screen.getByRole('region', { name: 'Class 9' }));
    await u.click(c9().getByRole('button', { name: 'Badminton 0/2' }));
    expect(c9().getByRole('button', { name: 'Badminton 2/2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('checkbox')).toBeNull(); // still shut
    // opening it shows that class and no other
    await u.click(c9().getByRole('button', { name: /^Class 9/ }));
    expect(c9().getByRole('checkbox', { name: /Aarav Mehta in Badminton/ })).toBeChecked();
    expect(screen.queryByText('Nikhil Jain')).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    // and pressing the chip again takes the whole class back out
    await u.click(c9().getByRole('button', { name: 'Badminton 2/2' }));
    expect(c9().getByRole('checkbox', { name: /Aarav Mehta in Badminton/ })).not.toBeChecked();
  });

  it('the cost line counts what was entered and books the days it needs', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<Wizard base="/app/sports" onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Day ends'), { target: { value: '10:00' } }); // one hour on one court
    await toPlayers(u, 'Court 1', 'Badminton');
    await u.click(await screen.findByRole('button', { name: 'All 4 into Badminton' }));
    const cost = () => within(screen.getByRole('region', { name: 'What the meet needs' }));
    expect(cost().getByText('3')).toBeInTheDocument(); // 4 players knock out in 3 matches
    expect(cost().getByText('1 h 15 min')).toBeInTheDocument();
    expect(cost().getByText('2 needed · 1 booked')).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Make it 2 days' }));
    expect(await screen.findByText('It all fits')).toBeInTheDocument();
    expect(cost().getByText('2 needed · 2 booked')).toBeInTheDocument();
  });

  it('a track event says how a field narrows before anybody runs, and sends the funnel it showed', async () => {
    const api = mockApi();
    const u = userEvent.setup();
    renderWithProviders(<Wizard base="/app/sports" onClose={() => {}} />);
    await u.type(screen.getByPlaceholderText('Annual Sports Meet 2026'), 'Meet');
    await u.click(screen.getByRole('button', { name: '+ Track' }));
    await u.click(screen.getByRole('tab', { name: /Sports & events/ }));
    await u.click(await screen.findByRole('button', { name: 'Senior' }));
    await u.click(screen.getByRole('button', { name: 'Girls' })); // Boys only
    await u.click(screen.getByRole('button', { name: '100 m sprint' }));
    // a two-lane track, so four boys cannot all run at once
    await u.click(screen.getByRole('button', { name: 'Edit 100 m sprint Boys' }));
    fireEvent.change(screen.getByLabelText('Lanes'), { target: { value: '2' } });
    await u.click(screen.getByRole('tab', { name: /Players/ }));
    await u.click(await screen.findByRole('button', { name: 'All 4 into 100 m sprint' }));
    // four boys from three classes: each class races its own heat, then they all meet
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Class heats4 athletes · 3 races of 2',
      'Band semi-finals4 athletes · 2 races of 2',
      'Final4 athletes · 1 race of 2',
    ]);
    await u.click(screen.getByRole('button', { name: 'Open qualifying' }));
    expect(within(screen.getByRole('list')).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Qualifying heats4 athletes · 2 races of 2',
      'Semi-finals4 athletes · 2 races of 2',
      'Final4 athletes · 1 race of 2',
    ]);
    await u.click(screen.getByRole('tab', { name: /Review/ }));
    await u.click(screen.getByRole('button', { name: 'Create tournament' }));
    await waitFor(() => expect(api.post).toHaveBeenCalled());
    const body = api.post.mock.calls[0][1] as { events: Record<string, unknown>[] };
    expect(body.events[0]).toMatchObject({ sportKey: 'ath-100m', stageShape: 'OPEN_QUAL', advancePerClass: 2, finalists: 6, lanes: 2 });
  });
});
