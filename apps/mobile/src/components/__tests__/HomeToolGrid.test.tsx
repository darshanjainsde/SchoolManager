import { fireEvent, render, screen } from '@testing-library/react-native';
import { HomeToolGrid, type HomeTool } from '../HomeToolGrid';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

function tools(over: Partial<HomeTool>[] = []): HomeTool[] {
  const base: HomeTool[] = [
    { label: 'Registers', icon: 'take', route: '/(staff)/attendance', tone: 'amber' },
    { label: 'Messages', icon: 'messages', route: '/(staff)/messages' },
    { label: 'Diary', icon: 'diary', route: '/(staff)/diary' },
    { label: 'Holidays', icon: 'holidays', route: '/(staff)/holidays', tone: 'green' },
  ];
  return base.map((t, i) => ({ ...t, ...(over[i] ?? {}) }));
}

describe('the home tile grid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders one tile per tool and navigates where it says', () => {
    render(<HomeToolGrid tools={tools()} />);
    fireEvent.press(screen.getByTestId('hometool-Diary'));
    expect(mockPush).toHaveBeenCalledWith('/(staff)/diary');
  });

  it('fills exactly the tile that is live, and leaves the rest outlined', () => {
    // The whole design rests on this. Two filled tiles is the old drawer's
    // fault — every tile shouting — reintroduced.
    render(<HomeToolGrid tools={tools([{ live: true }])} />);
    expect(screen.getByTestId('hometool-live-Registers')).toBeTruthy();
    expect(screen.queryByTestId('hometool-live-Messages')).toBeNull();
    expect(screen.queryByTestId('hometool-live-Diary')).toBeNull();
  });

  it('shows nothing at all when the day is clean', () => {
    // A grid with no live tile is the normal case, not an error state.
    render(<HomeToolGrid tools={tools()} />);
    for (const label of ['Registers', 'Messages', 'Diary', 'Holidays']) {
      expect(screen.queryByTestId(`hometool-live-${label}`)).toBeNull();
    }
  });

  it('counts what is waiting, and hides a zero rather than drawing a "0"', () => {
    render(<HomeToolGrid tools={tools([{ badge: 2 }, { badge: 0 }])} />);
    expect(screen.getByTestId('hometool-badge-Registers')).toBeTruthy();
    expect(screen.queryByTestId('hometool-badge-Messages')).toBeNull();
  });

  it('caps a large count at 9+ so the badge never widens past its tile', () => {
    render(<HomeToolGrid tools={tools([{ badge: 43 }])} />);
    expect(screen.getByText('9+')).toBeTruthy();
  });

  it('says how many are waiting out loud, since a red dot is silent', () => {
    render(<HomeToolGrid tools={tools([{ badge: 3 }])} />);
    expect(screen.getByLabelText('Registers, 3 waiting')).toBeTruthy();
  });

  it('reads a plain label when nothing is waiting', () => {
    render(<HomeToolGrid tools={tools()} />);
    expect(screen.getByLabelText('Diary')).toBeTruthy();
  });
});
