import { useState } from 'react';
import { View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { FamilyTabBar, type FamilyTabBarProps } from '../FamilyTabBar';
import { FamilyToolsDrawer } from '../FamilyToolsDrawer';
import { VISIBLE_TABS } from '@/lib/family-nav';

// FamilyToolsDrawer (used by the integration harness) pulls in these.
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

function makeProps(overrides: Partial<FamilyTabBarProps> = {}): FamilyTabBarProps {
  return {
    state: {
      index: 0,
      routes: [
        { key: 'home-1', name: 'home' },
        { key: 'attendance-1', name: 'attendance' },
        { key: 'results-1', name: 'results' },
        { key: 'profile-1', name: 'profile' },
      ],
    },
    navigation: {
      navigate: jest.fn(),
      emit: jest.fn(() => ({ defaultPrevented: false })),
    },
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
    descriptors: {},
    toolsOpen: false,
    onToolsPress: jest.fn(),
    ...overrides,
  } as unknown as FamilyTabBarProps;
}

it('renders the four core tabs and the central tools chevron', () => {
  const { getByText, getByTestId } = render(<FamilyTabBar {...makeProps()} />);
  for (const { title } of VISIBLE_TABS) {
    expect(getByText(title)).toBeTruthy();
  }
  expect(VISIBLE_TABS).toHaveLength(4);
  expect(getByTestId('tools-fab')).toBeTruthy();
});

it('shows Profile in the bar and NOT Notices (Notices moved to the drawer)', () => {
  // The old stock tab bar showed a "Notices" tab whose label wrapped onto two
  // lines; Profile replaced it and Notices became a drawer tile.
  const { getByTestId, queryByTestId } = render(<FamilyTabBar {...makeProps()} />);
  expect(getByTestId('tab-profile')).toBeTruthy();
  expect(queryByTestId('tab-notices')).toBeNull();
  expect(queryByTestId('tab-more')).toBeNull();
});

it('tapping the chevron FAB fires onToolsPress', () => {
  const onToolsPress = jest.fn();
  const { getByTestId } = render(<FamilyTabBar {...makeProps({ onToolsPress })} />);
  fireEvent.press(getByTestId('tools-fab'));
  expect(onToolsPress).toHaveBeenCalledTimes(1);
});

it('tapping an unfocused tab navigates to it', () => {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const { getByTestId } = render(
    <FamilyTabBar {...makeProps({ navigation: { navigate, emit } as never })} />,
  );
  fireEvent.press(getByTestId('tab-attendance'));
  expect(navigate).toHaveBeenCalledWith('attendance');
});

it('does not re-navigate to the already-focused tab', () => {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const { getByTestId } = render(
    <FamilyTabBar {...makeProps({ navigation: { navigate, emit } as never })} />,
  );
  fireEvent.press(getByTestId('tab-home')); // index 0 is focused
  expect(navigate).not.toHaveBeenCalled();
});

/**
 * Integration: mirrors the `_layout.tsx` wiring — the FAB toggles a shared
 * `open` state that the FamilyToolsDrawer reads. Proves that pressing the
 * chevron actually brings the sheet up (the pitch's core interaction), not
 * just that a callback fired.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <FamilyTabBar {...makeProps({ toolsOpen: open, onToolsPress: () => setOpen((o) => !o) })} />
      <FamilyToolsDrawer open={open} onClose={() => setOpen(false)} />
    </View>
  );
}

it('pressing the chevron opens the drawer sheet', async () => {
  const { getByTestId, queryByTestId, findByTestId } = render(<Harness />);
  expect(queryByTestId('tools-sheet')).toBeNull();

  fireEvent.press(getByTestId('tools-fab'));

  expect(await findByTestId('tools-sheet')).toBeTruthy();
});
