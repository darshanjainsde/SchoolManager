import { useState } from 'react';
import { View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { StaffTabBar, type StaffTabBarProps } from '../StaffTabBar';
import { ToolsDrawer } from '../ToolsDrawer';
import { VISIBLE_TABS } from '@/lib/staff-nav';

// ToolsDrawer (used by the integration harness) pulls in these.
jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

function makeProps(overrides: Partial<StaffTabBarProps> = {}): StaffTabBarProps {
  return {
    state: {
      index: 0,
      routes: [
        { key: 'today-1', name: 'today' },
        { key: 'attendance-1', name: 'attendance' },
        { key: 'timetable-1', name: 'timetable' },
        { key: 'post-1', name: 'post' },
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
  } as unknown as StaffTabBarProps;
}

it('renders the four core tabs and the central tools chevron', () => {
  const { getByText, getByTestId } = render(<StaffTabBar {...makeProps()} />);
  for (const { title } of VISIBLE_TABS) {
    expect(getByText(title)).toBeTruthy();
  }
  expect(VISIBLE_TABS).toHaveLength(4);
  expect(getByTestId('tools-fab')).toBeTruthy();
});

it('tapping the chevron FAB fires onToolsPress', () => {
  const onToolsPress = jest.fn();
  const { getByTestId } = render(<StaffTabBar {...makeProps({ onToolsPress })} />);
  fireEvent.press(getByTestId('tools-fab'));
  expect(onToolsPress).toHaveBeenCalledTimes(1);
});

it('tapping an unfocused tab navigates to it', () => {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const { getByTestId } = render(
    <StaffTabBar {...makeProps({ navigation: { navigate, emit } as never })} />,
  );
  fireEvent.press(getByTestId('tab-attendance'));
  expect(navigate).toHaveBeenCalledWith('attendance');
});

it('does not re-navigate to the already-focused tab', () => {
  const navigate = jest.fn();
  const emit = jest.fn(() => ({ defaultPrevented: false }));
  const { getByTestId } = render(
    <StaffTabBar {...makeProps({ navigation: { navigate, emit } as never })} />,
  );
  fireEvent.press(getByTestId('tab-today')); // index 0 is focused
  expect(navigate).not.toHaveBeenCalled();
});

/**
 * Integration: mirrors the `_layout.tsx` wiring — the FAB toggles a shared
 * `open` state that the ToolsDrawer reads. Proves that pressing the chevron
 * actually brings the sheet up (the pitch's core interaction), not just that
 * a callback fired.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <StaffTabBar {...makeProps({ toolsOpen: open, onToolsPress: () => setOpen((o) => !o) })} />
      <ToolsDrawer open={open} onClose={() => setOpen(false)} />
    </View>
  );
}

it('pressing the chevron opens the drawer sheet', async () => {
  const { getByTestId, queryByTestId, findByTestId } = render(<Harness />);
  expect(queryByTestId('tools-sheet')).toBeNull();

  fireEvent.press(getByTestId('tools-fab'));

  expect(await findByTestId('tools-sheet')).toBeTruthy();
});
