import { render, within } from '@testing-library/react-native';
import Sports from '../(tabs)/home/sports';
import { api } from '@/lib/api';
import { clearCache } from '@/lib/query';

jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

const ME = {
  role: 'STUDENT',
  house: { id: 'h1', name: 'Raffles Red', color: '#c00' },
  records: { records: [], attempts: [] },
  tournaments: [{
    id: 't1', name: 'Annual Athletic Meet', startsOn: '2026-09-18', endsOn: '2026-09-20', status: 'LIVE', dayStartMin: 480,
    sideNames: { 's:me': 'Saanvi', 's:aditi': 'Aditi Rao' },
    events: [
      { eventId: 'e-100', tournamentId: 't1', sportName: 'Athletics', kind: 'MEASURED', scoring: { type: 'MARK', label: 'Time', unit: 's', lowerIsBetter: true, precision: 2 }, groupLabel: 'Senior', category: 'Girls', structure: 'HEATS', side: 's:me',
        matches: [], heats: [{ id: 'h-1', kind: 'HEAT', idx: 1, venue: 'Track', atMin: 1440 + 580, done: false, lane: 4, mark: null, rank: null }] },
      { eventId: 'e-bad', tournamentId: 't1', sportName: 'Badminton', kind: 'MATCH', scoring: { type: 'GAMES', label: 'Games', bestOf: 3, to: 21, winBy: 2 }, groupLabel: 'Senior', category: 'Girls', structure: 'KNOCKOUT', side: 's:me',
        matches: [
          { id: 'm-qf', stage: 'KO', groupLabel: 'Final', roundName: 'Quarter-final', aSide: 's:me', bSide: 's:aditi', scoreA: [21], scoreB: [17], winner: 's:me', bye: false, walkover: false, venue: 'Court 2', atMin: 600 },
          { id: 'm-sf', stage: 'KO', groupLabel: 'Final', roundName: 'Semi-final', aSide: 's:me', bSide: null, scoreA: [], scoreB: [], winner: null, bye: false, walkover: false, venue: null, atMin: null },
        ], heats: [] },
    ],
  }],
};

beforeEach(() => {
  clearCache();
  (api.request as jest.Mock).mockReset();
});

describe('Sports', () => {
  it('leads with the next fixture — day, time, venue and lane — and groups events by sport', async () => {
    (api.request as jest.Mock).mockResolvedValue(ME);
    const { findByTestId, getByText, getAllByText } = render(<Sports />);
    const hero = await findByTestId('sports-next');
    // 1440 + 580 → day 2 of a meet starting Fri 18 Sep → Sat 19 Sep, 09:40.
    // The hero and the event row both carry it.
    expect(within(hero).getByText(/Sat 19 Sep, 09:40 · Track/)).toBeTruthy();
    expect(getAllByText(/Sat 19 Sep, 09:40 · Track/).length).toBe(2);
    expect(getByText('LANE 4')).toBeTruthy();
    expect(getByText('Athletics')).toBeTruthy();
    expect(getByText('Badminton')).toBeTruthy();
    expect(getByText('Won')).toBeTruthy();
    expect(getByText(/Quarter-final v Aditi Rao 21-17/)).toBeTruthy();
    expect(getByText('Raffles Red')).toBeTruthy();
  });
});
