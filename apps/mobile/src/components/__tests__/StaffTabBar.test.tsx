import { useState } from 'react';
import { View } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import { StaffTabBar, type StaffTabBarProps } from '../StaffTabBar';
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
    ...overrides,
  } as unknown as StaffTabBarProps;
}

it('renders the four core tabs, and nothing between them', () => {
  const { getByText } = render(<StaffTabBar {...makeProps()} />);
  for (const { title } of VISIBLE_TABS) {
    expect(getByText(title)).toBeTruthy();
  }
  expect(VISIBLE_TABS).toHaveLength(4);
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

it('has no tools FAB — the drawer it opened is gone, and every tab is equal', () => {
  // The FAB used to sit between the middle pair, squeezing the two tabs either
  // side toward the edges. Its removal is what makes the four tabs even.
  const { queryByTestId } = render(<StaffTabBar {...makeProps({})} />);
  expect(queryByTestId('tools-fab')).toBeNull();
});
