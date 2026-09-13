import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, type ApiStub } from '@/test/render';
import { useApi } from '@/lib/use-api';
import { useHost } from '@/components/use-host';
import TournamentView from './tournament-view';
import type { EventDetail, MatchRow, TournamentDetail } from './ui';

vi.mock('@/lib/use-api', () => ({ useApi: vi.fn() }));
vi.mock('@/components/use-host', () => ({ useHost: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => '/app/sports' }));

const match = (over: Partial<MatchRow>): MatchRow => ({
  id: 'm', stage: 'CLASS', groupLabel: 'Class 9', roundIdx: 0, roundName: 'Final', pos: 0, aSide: 's:a', bSide: 's:b',
  scoreA: [], scoreB: [], winner: null, bye: false, walkover: false, venueId: 'v1', atMin: 600, version: 1, savedAt: null, ...over,
});
const event = (over: Partial<EventDetail>): EventDetail => ({
  id: 'e1', sportKey: 'badminton', sportName: 'Badminton', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Games', bestOf: 3, to: 21, winBy: 2, cap: 30 },
  teamSize: 1, groupKey: 'sen', groupLabel: 'Senior', category: 'Boys', structure: 'CLASS', teamBasis: 'SECTIONS', stageShape: 'CLASS_QUAL',
  advancePerClass: 2, finalists: 6, dayIdx: null, slotMin: 25, lanes: 6, venueIds: ['v1'], order: 0, entries: [], matches: [], heats: [], ...over,
});
/** One court, one day, and a badminton draw that does not finish on it. */
const detail = (over: Partial<TournamentDetail> = {}): TournamentDetail => ({
  id: 't1', name: 'Annual Sports Meet', startsOn: '2026-09-15', endsOn: '2026-09-15', grouping: 'BANDS',
  dayStartMin: 540, dayEndMin: 600, restMin: 15, status: 'DRAFT', published: false, version: 1,
  venues: [{ id: 'v1', name: 'Court 1', order: 0 }],
  events: [
    event({ matches: [match({ id: 'm1', atMin: 540 }), match({ id: 'm2', atMin: 565 }), match({ id: 'spill', atMin: 1440 + 540 })] }),
    event({ id: 'e2', sportKey: 'chess', sportName: 'Chess', slotMin: 30, matches: [match({ id: 'm3', atMin: 1440 + 600 })] }),
  ],
  sideNames: { 's:a': 'Aarav', 's:b': 'Bela' },
  bands: [],
  ...over,
});

function mockApi(t: TournamentDetail = detail()) {
  const api = {
    get: vi.fn((url: string) => url === '/sports/me' ? Promise.resolve({ perms: ['CREATE', 'ENTER', 'PUBLISH'], isAdmin: true }) : Promise.resolve(t)),
    post: vi.fn().mockImplementation(() => Promise.resolve(detail({ endsOn: '2026-09-16' }))),
    patch: vi.fn().mockImplementation(() => Promise.resolve(detail({ endsOn: '2026-09-16' }))),
    put: vi.fn(), del: vi.fn().mockResolvedValue(detail()),
  };
  vi.mocked(useApi).mockReturnValue(api as unknown as ApiStub as never);
  return api;
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(useHost).mockReturnValue('raffles.test.sckools.com'); });

describe('Tournament view — the schedule a teacher reads', () => {
  it('opens on the schedule, grouped by sport then by class, with counts on the outside', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    // shut by default: the sports are all visible, none of their slots are
    const badminton = await screen.findByRole('region', { name: 'Badminton · Senior Boys' });
    expect(within(badminton).getByText(/3 matches · Court 1/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Chess · Senior Boys' })).toBeInTheDocument();
    expect(screen.queryByText('9 A v 9 B')).toBeNull();
    // sport → class → the slots themselves
    await u.click(within(badminton).getByRole('button', { name: /Badminton · Senior Boys/ }));
    await u.click(within(badminton).getByRole('button', { name: /Class 9/ }));
    expect(within(badminton).getAllByRole('listitem')).toHaveLength(3);
    expect(within(badminton).getAllByText('Aarav v Bela')).toHaveLength(3);
  });

  it('names an event that has no times yet instead of dropping it', async () => {
    mockApi(detail({ events: [event({ matches: [match({ id: 'm1', atMin: 540 })] }), event({ id: 'e2', sportName: 'Chess', matches: [] })] }));
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    expect(await screen.findByText(/1 event not timetabled yet/)).toBeInTheDocument();
  });
});

describe('Tournament view — days, at any number of them', () => {
  it('a short meet gets chips, one per day, with what is on each', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await u.click(await screen.findByRole('tab', { name: 'Timetable' }));
    expect(screen.getByRole('button', { name: 'Tue 15 Sep 2' })).toBeInTheDocument();
    const spilled = screen.getByRole('button', { name: 'Wed 16 Sep 2' });
    expect(spilled).toHaveAttribute('data-beyond', 'true');
    expect(screen.queryByLabelText('Day of the meet')).toBeNull();
  });

  it('a meet whose plan spilled over fifty days gets a stepper and a list, never fifty chips', async () => {
    // one court, a day that holds an hour, and enough matches to run for weeks
    const many = Array.from({ length: 60 }, (_, i) => match({ id: `m${i}`, atMin: i * 1440 + 540 }));
    mockApi(detail({ events: [event({ matches: many })] }));
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await u.click(await screen.findByRole('tab', { name: 'Timetable' }));
    const select = screen.getByLabelText('Day of the meet');
    expect(within(select).getAllByRole('option')).toHaveLength(60);
    expect(screen.getByText('Day 1 of 60')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /15 Sep 1/ })).toBeNull(); // no chip wall
    // the steppers walk a day at a time
    expect(screen.getByRole('button', { name: 'Previous day' })).toBeDisabled();
    await u.click(screen.getByRole('button', { name: 'Next day' }));
    expect(screen.getByText('Day 2 of 60')).toBeInTheDocument();
    expect(screen.getByText(/16 Sep · 1 slot · not booked/)).toBeInTheDocument();
    // and the overrun is stated once, not stamped on every day
    expect(screen.getByText('The plan runs to 60 days and the meet is booked for 1')).toBeInTheDocument();
    expect(screen.queryAllByText('⚠')).toHaveLength(0);
  });
});

describe('Tournament view — the day as a timetable', () => {
  it('gives a column only to the venues that hold something, and names the rest', async () => {
    // a second court the meet owns but nothing is booked on today
    mockApi(detail({ venues: [{ id: 'v1', name: 'Court 1', order: 0 }, { id: 'v2', name: 'Court 2', order: 1 }] }));
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await u.click(await screen.findByRole('tab', { name: 'Timetable' }));
    const grid = () => within(screen.getByRole('group', { name: 'Timetable grid' }));
    expect(grid().getByText('Court 1')).toBeInTheDocument();
    expect(grid().queryByText('Court 2')).toBeNull();
    expect(screen.getByText(/Court 2 ha(s|ve) nothing on this day/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Show all 2 venues' }));
    expect(grid().getByText('Court 2')).toBeInTheDocument();
  });

  it('sizes every block by its own minutes, and stacks them down the day', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await u.click(await screen.findByRole('tab', { name: 'Timetable' }));
    const first = screen.getByTitle(/09:00 · 25 min · Badminton Final/);
    // 25-minute slots scale at 1.1 px a minute: 27px tall, starting at the top of the day
    expect(first).toHaveStyle({ top: '0px', height: '26px' });
    expect(screen.getByTitle(/09:25 · 25 min/)).toHaveStyle({ top: '28px' });
  });
});

describe('Tournament view — days & courts', () => {
  const openPlan = async (u: ReturnType<typeof userEvent.setup>) => u.click(await screen.findByRole('tab', { name: /Days & courts/ }));

  it('reads how full each court is on each day, and which events run when', async () => {
    mockApi();
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await openPlan(u);
    // day one: two badminton matches, 50 minutes of the 60 the day holds
    expect(screen.getByTitle('2 slots, 50 minutes of 60')).toBeInTheDocument();
    expect(screen.getByTitle('2 slots, 55 minutes of 60')).toBeInTheDocument(); // day two: the spill and the chess
    expect(within(screen.getByRole('region', { name: 'Each day of the meet' })).getAllByText(/not booked/)).toHaveLength(1);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Badminton · Senior Boys')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Chess · Senior Boys')).toBeInTheDocument();
  });

  it('books the extra day the plan needs, and takes the re-laid plan back from the API', async () => {
    const api = mockApi();
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await openPlan(u);
    await u.click(screen.getByRole('button', { name: 'Book 2 days' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/sports/tournaments/t1', { endsOn: '2026-09-16' }));
    // the payload the API returned is what the page now shows — no second fetch
    await waitFor(() => expect(screen.queryByText(/not booked/)).toBeNull());
    expect(api.get).toHaveBeenCalledTimes(2); // /sports/me and the tournament, once each
  });

  it('adds a court and holds an event to a day', async () => {
    const api = mockApi();
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await openPlan(u);
    await u.type(screen.getByPlaceholderText('Court 3'), 'Court 2');
    await u.click(screen.getByRole('button', { name: 'Add venue' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/sports/tournaments/t1/venues', { name: 'Court 2' }));
    fireEvent.change(screen.getByLabelText('Day for Chess · Senior Boys'), { target: { value: '0' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/sports/tournaments/t1/events/e2/day', { dayIdx: 0 }));
    fireEvent.change(screen.getByLabelText('Day for Chess · Senior Boys'), { target: { value: '' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/sports/tournaments/t1/events/e2/day', { dayIdx: null }));
  });

  it('a live meet keeps its hours but may still gain a day or a court', async () => {
    mockApi(detail({ status: 'LIVE', published: true }));
    const u = userEvent.setup();
    renderWithProviders(<TournamentView base="/app/sports" id="t1" />);
    await openPlan(u);
    expect(screen.getByLabelText('Day starts')).toBeDisabled();
    expect(screen.getByLabelText('Day ends')).toBeDisabled();
    expect(screen.getByLabelText('Last day')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add venue' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Court 1' })).toBeNull(); // the last court never goes
    expect(screen.getByText(/the hours and the rest gap are fixed/)).toBeInTheDocument();
  });
});
