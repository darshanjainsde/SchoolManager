import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';
import { api } from '@/lib/api';
import { clearCache, FRESH_MS, markAllStale, resetResumeForTests, useQuery } from '@/lib/query';

/**
 * THE APP PICKS UP WHAT THE WEB CHANGED. The server is the only truth; an app
 * that is already open must ask it again when it comes back from the
 * background (React Navigation fires no focus then) and when a push says
 * something changed. Before 2026-10-15 neither happened: a teacher reopening
 * the app saw the morning's coverage until they switched tabs.
 */
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(), deleteItemAsync: jest.fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | void) => {
    const React = jest.requireActual('react');
    React.useEffect(effect, []);
  },
}));
jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return { ...actual, api: { ...actual.api, request: jest.fn() } };
});

let onChange: ((s: AppStateStatus) => void) | null = null;
let answer = 'first';
beforeEach(() => {
  jest.clearAllMocks();
  clearCache();
  resetResumeForTests();
  onChange = null;
  answer = 'first';
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: AppStateStatus) => void) => {
    onChange = fn;
    return { remove: () => undefined };
  }) as never);
  (api.request as jest.Mock).mockImplementation(async () => answer);
});

function Shows() {
  const q = useQuery<string>('/manage/leave/coverage');
  return <Text testID="v">{q.data ?? 'nothing'}</Text>;
}
const asks = () => (api.request as jest.Mock).mock.calls.length;
const away = () => act(() => { onChange!('background'); });
const back = () => act(() => { onChange!('active'); });

describe('an open app picks up changes made elsewhere', () => {
  it('back from the background after FRESH_MS: asks again, and shows the new answer without blanking first', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    render(<Shows />);
    expect((await screen.findByText('first'))).toBeTruthy();
    expect(asks()).toBe(1);
    answer = 'changed on the web';
    away();
    now.mockReturnValue(1_000_000 + FRESH_MS + 1);
    back();
    // The old answer stays on screen while the new one is on its way.
    expect(screen.getByTestId('v').props.children).toBe('first');
    await waitFor(() => expect(screen.getByTestId('v').props.children).toBe('changed on the web'));
    expect(asks()).toBe(2);
    now.mockRestore();
  });

  it('back within FRESH_MS: no new request — a glance at another app is not a reason to refetch', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(2_000_000);
    render(<Shows />);
    await screen.findByText('first');
    away();
    now.mockReturnValue(2_000_000 + 5_000);
    back();
    expect(asks()).toBe(1);
    now.mockRestore();
  });

  it('a push (markAllStale) makes everything on screen ask again at once, fresh or not', async () => {
    render(<Shows />);
    await screen.findByText('first');
    answer = 'a cover was given';
    act(() => markAllStale());
    await waitFor(() => expect(screen.getByTestId('v').props.children).toBe('a cover was given'));
    expect(asks()).toBe(2);
  });

  it('only a return from the background counts: active → active asks nothing', async () => {
    render(<Shows />);
    await screen.findByText('first');
    back();
    expect(asks()).toBe(1);
  });
});
