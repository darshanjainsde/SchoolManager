import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { ToolsDrawer } from '../ToolsDrawer';
import { MORE_ITEMS } from '@/lib/staff-nav';
import { session } from '@/lib/session';

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (k: string) => store[k] ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => { store[k] = v; }),
    deleteItemAsync: jest.fn(async (k: string) => { delete store[k]; }),
  };
});

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
}));

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(async () => {
  mockPush.mockReset();
  mockReplace.mockReset();
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  await session.set({
    accessToken: 'at', refreshToken: 'rt', role: 'TEACHER',
    schoolHost: 'raffles.sckools.com', displayName: 'A Teacher',
  });
});

it('renders the sheet with every MORE_ITEMS tool in the grid when open', () => {
  const { getByTestId, getByText } = render(<ToolsDrawer open onClose={jest.fn()} />);
  expect(getByTestId('tools-sheet')).toBeTruthy();
  for (const item of MORE_ITEMS) {
    expect(getByText(item.label)).toBeTruthy();
  }
});

it('renders nothing while closed (no overlay to intercept touches)', () => {
  const { queryByTestId } = render(<ToolsDrawer open={false} onClose={jest.fn()} />);
  expect(queryByTestId('tools-sheet')).toBeNull();
  expect(queryByTestId('tools-scrim')).toBeNull();
});

it('shows a live badge on tools that carry a count', () => {
  const { getByTestId, queryByTestId } = render(<ToolsDrawer open onClose={jest.fn()} />);
  // Pitch: Messages "3", Requests "2".
  expect(getByTestId('tool-badge-Messages')).toBeTruthy();
  expect(getByTestId('tool-badge-Requests')).toBeTruthy();
  // Assignments has no count → no badge.
  expect(queryByTestId('tool-badge-Assignments')).toBeNull();
});

it('tapping a tool navigates to its route and closes the drawer', () => {
  const onClose = jest.fn();
  const { getByTestId } = render(<ToolsDrawer open onClose={onClose} />);

  fireEvent.press(getByTestId('tool-Tests & Results'));

  expect(mockPush).toHaveBeenCalledWith('/(staff)/tests');
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('tapping the scrim closes the drawer', () => {
  const onClose = jest.fn();
  const { getByTestId } = render(<ToolsDrawer open onClose={onClose} />);

  // The scrim is a sibling of the sheet, which is `accessibilityViewIsModal`
  // — that marks the scrim accessibility-hidden, so it must be queried with
  // includeHiddenElements. It's still rendered and tappable at runtime (VO
  // just can't focus it behind the modal, which is the intended behaviour).
  fireEvent.press(getByTestId('tools-scrim', { includeHiddenElements: true }));

  expect(onClose).toHaveBeenCalledTimes(1);
});

it('Log out revokes the token, clears the session and routes to connect', async () => {
  const onClose = jest.fn();
  const { getByTestId } = render(<ToolsDrawer open onClose={onClose} />);

  fireEvent.press(getByTestId('tools-logout'));

  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
  const [url, init] = mockFetch.mock.calls[0];
  expect(url).toContain('/auth/logout');
  expect(JSON.parse(init.body)).toEqual({ refreshToken: 'rt' });

  await waitFor(async () => {
    expect(await session.get()).toBeNull();
  });
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/connect');
});

/**
 * Prove-by-deletion target (carried over from the old more.test.tsx): a
 * lost/offline device must still sign out locally even if the server can't
 * be reached — this is what `api.logout`'s `.catch(() => undefined)` exists
 * for. Remove that swallow and this fails.
 */
it('still clears the session and navigates when the logout POST fails (offline)', async () => {
  mockFetch.mockRejectedValue(new TypeError('Network request failed'));
  const { getByTestId } = render(<ToolsDrawer open onClose={jest.fn()} />);

  fireEvent.press(getByTestId('tools-logout'));

  await waitFor(async () => {
    expect(await session.get()).toBeNull();
  });
  expect(mockReplace).toHaveBeenCalledWith('/(auth)/connect');
});
