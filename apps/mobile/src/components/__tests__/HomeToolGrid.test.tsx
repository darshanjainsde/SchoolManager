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

describe('toolColumns — never one tile alone on a row (re-audit 2026-10-08)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { toolColumns } = require('../HomeToolGrid') as { toolColumns: (n: number) => number };
  it.each([[1, 4], [4, 4], [5, 3], [6, 4], [7, 4], [8, 4], [9, 3], [12, 4]])('%i tiles → %i columns', (n, cols) => {
    expect(toolColumns(n)).toBe(cols);
    const lastRow = n % cols;
    if (n > cols) expect(lastRow).not.toBe(1);
  });
});

describe('tile state (direction C, 16 Oct 2026)', () => {
  it('Holidays wears the date; Syllabus wears its taught-so-far ring; a count beats both', () => {
    render(<HomeToolGrid tools={[
      { label: 'Holidays', icon: 'holidays', route: '/h', date: '16' },
      { label: 'Syllabus', icon: 'syllabus', route: '/s', arc: 51 },
      { label: 'Diary', icon: 'diary', route: '/d', badge: 2, date: '16', arc: 10 },
    ]} />);
    expect(screen.getByTestId('hometool-date-Holidays')).toHaveTextContent('16');
    expect(screen.getByTestId('hometool-arc-Syllabus')).toBeTruthy();
    expect(screen.getByLabelText('51% so far')).toBeTruthy();
    expect(screen.getByTestId('hometool-badge-Diary')).toBeTruthy();
    expect(screen.queryByTestId('hometool-date-Diary')).toBeNull();
    expect(screen.queryByTestId('hometool-arc-Diary')).toBeNull();
  });

  it('a tile may run its own onPress instead of a route, and keep a desk test id', () => {
    const go = jest.fn();
    render(<HomeToolGrid tools={[{ label: 'Register', icon: 'take', onPress: go, testID: 'hero-act-register', badge: 4 }]} />);
    fireEvent.press(screen.getByTestId('hero-act-register'));
    expect(go).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Register, 4 waiting')).toBeTruthy();
  });
});
